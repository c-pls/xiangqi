const { XiangqiGame, RED, BLACK } = require('../rules/xiangqi-rules');
const config = require('../config');

const MODE_SECONDS = {
    'unlimited': 0,
    '3min': 180,
    '5min': 300,
    '10min': 600
};

class Room {
    constructor({ id, code, name, hostUser, preferredSide = 'random', timeMode = 'unlimited' }) {
        this.id = id;
        this.code = code;
        this.name = name || `Room ${code}`;
        this.hostUserId = hostUser.userId;
        this.preferredSide = preferredSide;
        // 'random' rooms: the host is NOT seated at creation. Both players
        // are drawn into red/black when the room fills (see join()/_drawSides),
        // so no side is known — or shown — before the opponent arrives. There
        // is no provisional side and therefore nothing to flip.
        this._sidesDrawn = false;
        this.awaitingDraw = []; // seat data (no side yet) for 'random' rooms
        this.timeMode = timeMode;
        this.status = 'waiting'; // 'waiting' | 'playing' | 'ended'
        this.createdAt = Date.now();
        this.lastActive = Date.now();

        this.game = new XiangqiGame();
        this.red = null; // { userId, username, sessionToken, connection, disconnectedAt }
        this.black = null;
        this.spectators = new Map(); // userId -> { userId, username, connection }

        // Time control & clock ticker
        const initialSeconds = MODE_SECONDS[this.timeMode] || 0;
        this.clocks = { red: initialSeconds, black: initialSeconds };
        this.clockInterval = null;

        // Disconnect grace timers
        this.disconnectTimers = new Map(); // userId -> NodeJS.Timeout

        // In-game negotiation states
        this.pendingDrawOfferFrom = null; // 'red' | 'black' | null
        this.rematchRequests = new Set(); // Set of userIds

        // Assign host seat (deferred for 'random' — see the constructor note).
        if (preferredSide === 'random') {
            this.awaitingDraw.push(this._makeSeatData(hostUser));
        } else {
            this.assignHostSeat(hostUser, preferredSide);
        }
    }

    _makeSeatData(user) {
        return {
            userId: user.userId,
            username: user.username,
            sessionToken: user.sessionToken,
            connection: user.connection,
            disconnectedAt: null
        };
    }

    assignHostSeat(hostUser, preferredSide) {
        // Explicit side choice only; 'random' rooms never seat at creation.
        const seatData = this._makeSeatData(hostUser);

        if (preferredSide === 'red') {
            this.red = seatData;
        } else {
            this.black = seatData;
        }
    }

    join(user) {
        this.lastActive = Date.now();

        // 1. Check if user is reconnecting to an existing seat
        if (this.red && this.red.userId === user.userId) {
            this.reconnectPlayer('red', user.connection);
            return { role: 'red', isReconnect: true };
        }
        if (this.black && this.black.userId === user.userId) {
            this.reconnectPlayer('black', user.connection);
            return { role: 'black', isReconnect: true };
        }
        // 1b. Reconnecting as a pending-draw player (random room, draw not
        // yet happened): refresh the connection, stay pending.
        const pending = this.awaitingDraw.find((p) => p.userId === user.userId);
        if (pending) {
            pending.connection = user.connection;
            pending.disconnectedAt = null;
            return { role: 'random', isReconnect: true };
        }

        // 2. 'random' rooms: collect players; both sides are drawn the moment
        // the room fills (see _drawSides). Until then nobody has a side.
        if (this.preferredSide === 'random' && !this._sidesDrawn && this.status === 'waiting') {
            if (this.awaitingDraw.length < 2) {
                this.awaitingDraw.push(this._makeSeatData(user));
            }
            if (this.awaitingDraw.length >= 2) {
                this._drawSides();
                // Push the final sides to the player who was already waiting
                // (the joiner receives their payload from the router next).
                for (const seat of [this.red, this.black]) {
                    if (seat && seat.userId !== user.userId && seat.connection) {
                        try { seat.connection.send(this.getJoinedPayload(seat.userId)); } catch (e) {}
                    }
                }
                return { role: this.getUserSide(user.userId), isReconnect: false };
            }
            return { role: 'random', isReconnect: false };
        }

        // 3. Explicit sides (or post-draw): first open seat gets the player
        const seatData = this._makeSeatData(user);

        if (!this.red) {
            this.red = seatData;
            if (this.black) {
                this.broadcast({
                    type: 'opponentJoined',
                    opponent: { username: user.username, side: 'red' }
                }, user.userId);
            }
            return { role: 'red', isReconnect: false };
        } else if (!this.black) {
            this.black = seatData;
            if (this.red) {
                this.broadcast({
                    type: 'opponentJoined',
                    opponent: { username: user.username, side: 'black' }
                }, user.userId);
            }
            return { role: 'black', isReconnect: false };
        }

        // 3. Otherwise join as spectator
        this.spectators.set(user.userId, {
            userId: user.userId,
            username: user.username,
            connection: user.connection
        });
        return { role: 'spectator', isReconnect: false };
    }

    // Draw both players into red/black once, when the room fills. Uniform:
    // each pending player ends up red with probability 1/2. Called only
    // when awaitingDraw holds 2 players.
    _drawSides() {
        const players = this.awaitingDraw.slice(0, 2);
        this.awaitingDraw = [];
        this._sidesDrawn = true;
        if (Math.random() < 0.5) {
            this.red = players[0];
            this.black = players[1];
        } else {
            this.red = players[1];
            this.black = players[0];
        }
    }

    checkGameStart() {
        if (this.red && this.black && this.status === 'waiting') {
            this.status = 'playing';
            this.startClock();
            this.broadcast({
                type: 'gameStarted',
                redPlayer: this.red.username,
                blackPlayer: this.black.username,
                turn: RED,
                clocks: { ...this.clocks },
                board: this.game.cloneBoard()
            });
        }
    }

    startClock() {
        if (this.timeMode === 'unlimited') return;
        clearInterval(this.clockInterval);
        this.clockInterval = setInterval(() => {
            if (this.status !== 'playing') {
                clearInterval(this.clockInterval);
                return;
            }
            const currentTurn = this.game.turn;
            if (this.clocks[currentTurn] > 0) {
                this.clocks[currentTurn]--;
                if (this.clocks[currentTurn] <= 0) {
                    this.handleTimeout(currentTurn);
                }
            }
        }, 1000);
        this.clockInterval.unref();
    }

    handleTimeout(losingTurn) {
        clearInterval(this.clockInterval);
        this.status = 'ended';
        const winnerSide = losingTurn === RED ? BLACK : RED;
        this.game.gameOver = true;
        this.game.winner = winnerSide;
        this.game.winReason = 'timeout';

        this.broadcast({
            type: 'gameOver',
            result: 'win',
            winnerSide,
            reason: 'timeout'
        });
    }

    handleDisconnect(userId) {
        this.lastActive = Date.now();
        let disconnectedSide = null;

        if (this.red && this.red.userId === userId) {
            disconnectedSide = 'red';
            this.red.disconnectedAt = Date.now();
            this.red.connection = null;
        } else if (this.black && this.black.userId === userId) {
            disconnectedSide = 'black';
            this.black.disconnectedAt = Date.now();
            this.black.connection = null;
        } else {
            // Pending-draw player leaving before the draw: drop them from
            // the pool so the draw waits for a real opponent.
            const pendIdx = this.awaitingDraw.findIndex((p) => p.userId === userId);
            if (pendIdx !== -1) this.awaitingDraw.splice(pendIdx, 1);
            this.spectators.delete(userId);
            return;
        }

        // If game is active, start 60s forfeit countdown
        if (this.status === 'playing') {
            const graceSeconds = config.reconnectGraceSeconds;
            this.broadcast({
                type: 'opponentDisconnected',
                side: disconnectedSide,
                graceSeconds
            });

            const timer = setTimeout(() => {
                this.handleForfeitOnDisconnect(disconnectedSide);
            }, graceSeconds * 1000);
            timer.unref();

            this.disconnectTimers.set(userId, timer);
        }
    }

    reconnectPlayer(side, newConnection) {
        const player = side === 'red' ? this.red : this.black;
        player.connection = newConnection;
        player.disconnectedAt = null;

        // Cancel grace timer if running
        const existingTimer = this.disconnectTimers.get(player.userId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.disconnectTimers.delete(player.userId);
        }

        this.broadcast({
            type: 'opponentReconnected',
            side
        }, player.userId);
    }

    handleForfeitOnDisconnect(disconnectedSide) {
        if (this.status !== 'playing') return;
        clearInterval(this.clockInterval);
        this.status = 'ended';
        const winnerSide = disconnectedSide === 'red' ? BLACK : RED;
        this.game.gameOver = true;
        this.game.winner = winnerSide;
        this.game.winReason = 'opponent_disconnect';

        this.broadcast({
            type: 'gameOver',
            result: 'win',
            winnerSide,
            reason: 'opponent_disconnect'
        });
    }

    applyMove(userId, from, to) {
        this.lastActive = Date.now();
        if (this.status !== 'playing' || this.game.gameOver) {
            return { success: false, reason: 'Game is not in active playing state' };
        }

        const userSide = this.getUserSide(userId);
        if (!userSide) {
            return { success: false, reason: 'Spectators cannot make moves' };
        }

        if (userSide !== this.game.turn) {
            return { success: false, reason: 'Not your turn' };
        }

        const movingPiece = this.game.board[from.r][from.c];
        if (!movingPiece || this.game.getPieceColor(movingPiece) !== userSide) {
            return { success: false, reason: 'No valid piece belonging to you at source square' };
        }

        const moveResult = this.game.makeMove({ from, to });
        if (!moveResult || !moveResult.success) {
            return { success: false, reason: 'Illegal move per Xiangqi rules' };
        }

        // Clear any pending draw offer on successful move
        this.pendingDrawOfferFrom = null;

        // Check if move ended game
        if (moveResult.gameOver) {
            this.status = 'ended';
            clearInterval(this.clockInterval);
        }

        const moveNumber = this.game.history.length;
        const checkingPiece = moveResult.inCheck && this.game.getCheckingPieces
            ? (this.game.getCheckingPieces(this.game.turn)[0] || null)
            : null;

        const broadcastPayload = {
            type: 'moveApplied',
            from,
            to,
            piece: movingPiece,
            captured: moveResult.captured || null,
            isCheck: moveResult.inCheck,
            checkingPiece: checkingPiece ? { r: checkingPiece.r, c: checkingPiece.c, piece: checkingPiece.piece } : null,
            isCheckmate: moveResult.gameOver && moveResult.winReason === 'checkmate',
            newTurn: this.game.turn,
            moveNumber,
            clocks: { ...this.clocks },
            notationZh: moveResult.notationZh,
            notationEn: moveResult.notationEn
        };

        this.broadcast(broadcastPayload);

        if (moveResult.gameOver) {
            this.broadcast({
                type: 'gameOver',
                result: moveResult.winner ? 'win' : 'draw',
                winnerSide: moveResult.winner || null,
                reason: moveResult.winReason,
                winningPiece: movingPiece
            });
        }

        return { success: true };
    }

    resign(userId) {
        this.lastActive = Date.now();
        if (this.status !== 'playing') return { success: false, reason: 'Game is not playing' };
        const side = this.getUserSide(userId);
        if (!side) return { success: false, reason: 'Only players can resign' };

        clearInterval(this.clockInterval);
        this.status = 'ended';
        const winnerSide = side === 'red' ? BLACK : RED;
        this.game.gameOver = true;
        this.game.winner = winnerSide;
        this.game.winReason = 'resignation';

        this.broadcast({
            type: 'gameOver',
            result: 'win',
            winnerSide,
            reason: 'resignation'
        });
        return { success: true };
    }

    offerDraw(userId) {
        this.lastActive = Date.now();
        if (this.status !== 'playing') return { success: false, reason: 'Game is not playing' };
        const side = this.getUserSide(userId);
        if (!side) return { success: false, reason: 'Only players can offer draw' };

        this.pendingDrawOfferFrom = side;
        const opponent = side === 'red' ? this.black : this.red;
        if (opponent && opponent.connection) {
            opponent.connection.send({
                type: 'drawOffered',
                fromSide: side,
                fromUsername: side === 'red' ? this.red.username : this.black.username
            });
        }
        return { success: true };
    }

    respondDraw(userId, accept) {
        this.lastActive = Date.now();
        if (this.status !== 'playing' || !this.pendingDrawOfferFrom) {
            return { success: false, reason: 'No pending draw offer' };
        }
        const side = this.getUserSide(userId);
        if (side === this.pendingDrawOfferFrom) {
            return { success: false, reason: 'Cannot respond to your own draw offer' };
        }

        this.pendingDrawOfferFrom = null;

        if (accept) {
            clearInterval(this.clockInterval);
            this.status = 'ended';
            this.game.gameOver = true;
            this.game.winner = null;
            this.game.winReason = 'draw_agreement';

            this.broadcast({
                type: 'gameOver',
                result: 'draw',
                winnerSide: null,
                reason: 'draw_agreement'
            });
        } else {
            this.broadcast({
                type: 'chat',
                from: 'System',
                text: `${side === 'red' ? 'Red' : 'Black'} declined the draw offer.`,
                time: Date.now()
            });
        }
        return { success: true };
    }

    requestRematch(userId) {
        this.lastActive = Date.now();
        if (this.status !== 'ended') return { success: false, reason: 'Game has not ended yet' };
        const side = this.getUserSide(userId);
        if (!side) return { success: false, reason: 'Only players can request rematch' };

        this.rematchRequests.add(userId);

        // Check if both players have requested rematch
        const redId = this.red ? this.red.userId : null;
        const blackId = this.black ? this.black.userId : null;

        if (redId && blackId && this.rematchRequests.has(redId) && this.rematchRequests.has(blackId)) {
            // Swap sides for rematch!
            const oldRed = this.red;
            const oldBlack = this.black;
            this.red = oldBlack;
            this.black = oldRed;

            // Reset game and clocks
            this.game = new XiangqiGame();
            const s = MODE_SECONDS[this.timeMode] || 0;
            this.clocks = { red: s, black: s };
            this.status = 'playing';
            this.rematchRequests.clear();
            this.pendingDrawOfferFrom = null;
            this.startClock();

            // Notify both players of swapped sides & restart
            if (this.red && this.red.connection) {
                this.red.connection.send(this.getJoinedPayload(this.red.userId));
            }
            if (this.black && this.black.connection) {
                this.black.connection.send(this.getJoinedPayload(this.black.userId));
            }
            for (const spectator of this.spectators.values()) {
                if (spectator.connection) {
                    spectator.connection.send(this.getJoinedPayload(spectator.userId));
                }
            }

            this.broadcast({
                type: 'gameStarted',
                redPlayer: this.red.username,
                blackPlayer: this.black.username,
                turn: RED,
                clocks: { ...this.clocks },
                board: this.game.cloneBoard()
            });
            return { success: true, restarted: true };
        } else {
            const username = side === 'red' ? this.red.username : this.black.username;
            this.broadcast({
                type: 'chat',
                from: 'System',
                text: `${username} requested a rematch. Waiting for opponent...`,
                time: Date.now()
            });
            return { success: true, restarted: false };
        }
    }

    sendChat(fromUser, text) {
        this.lastActive = Date.now();
        this.broadcast({
            type: 'chat',
            from: fromUser.username,
            text,
            time: Date.now()
        });
    }

    // True when anyone with a stake in the room (seated, pending-draw, or
    // spectating) currently holds a live connection. Used by the manager's
    // empty-room cleanup so a 'random' room with a waiting host is not
    // reaped before the draw.
    hasLiveParticipants() {
        const live = (p) => !!(p && p.connection);
        return live(this.red) || live(this.black) ||
            this.awaitingDraw.some(live) || this.spectators.size > 0;
    }

    getUserSide(userId) {
        if (this.red && this.red.userId === userId) return 'red';
        if (this.black && this.black.userId === userId) return 'black';
        return null;
    }

    getJoinedPayload(userId) {
        let yourSide = this.getUserSide(userId);
        if (!yourSide && this.awaitingDraw.some((p) => p.userId === userId)) {
            yourSide = 'random'; // waiting for the side draw
        }
        yourSide = yourSide || 'spectator';
        const opponent = yourSide === 'red' ? (this.black ? { username: this.black.username, side: 'black' } : null)
                       : yourSide === 'black' ? (this.red ? { username: this.red.username, side: 'red' } : null)
                       : null;

        return {
            type: 'roomJoined',
            roomId: this.id,
            code: this.code,
            name: this.name,
            yourSide,
            opponent,
            redPlayer: this.red ? { username: this.red.username, connected: !!this.red.connection } : null,
            blackPlayer: this.black ? { username: this.black.username, connected: !!this.black.connection } : null,
            board: this.game.cloneBoard(),
            turn: this.game.turn,
            history: this.game.history.map(h => ({
                notationZh: h.notationZh,
                notationEn: h.notationEn,
                move: h.move,
                inCheck: h.inCheck
            })),
            clocks: { ...this.clocks },
            status: this.status,
            timeMode: this.timeMode
        };
    }

    getSummary() {
        return {
            roomId: this.id,
            code: this.code,
            name: this.name,
            hostUsername: this.red ? this.red.username : (this.black ? this.black.username : (this.awaitingDraw[0] ? this.awaitingDraw[0].username : 'Unknown')),
            status: this.status,
            spectatorsCount: this.spectators.size,
            redOccupied: !!this.red,
            blackOccupied: !!this.black,
            timeMode: this.timeMode
        };
    }

    broadcast(message, excludeUserId = null) {
        const sendSafe = (conn, uid) => {
            if (conn && (!excludeUserId || uid !== excludeUserId)) {
                conn.send(message);
            }
        };

        if (this.red) sendSafe(this.red.connection, this.red.userId);
        if (this.black) sendSafe(this.black.connection, this.black.userId);
        for (const [sId, s] of this.spectators.entries()) {
            sendSafe(s.connection, sId);
        }
    }

    destroy() {
        clearInterval(this.clockInterval);
        for (const timer of this.disconnectTimers.values()) {
            clearTimeout(timer);
        }
        this.disconnectTimers.clear();
    }
}

module.exports = Room;
