/**
 * Xiangqi Online Multiplayer Controller
 * Manages WebSocket networking, session persistence, room lifecycle, lobby UI,
 * in-game sidebar, chat, and server-authoritative move dispatch.
 */

class XiangqiMultiplayer {
    constructor() {
        this.ws = null;
        this.userId = null;
        this.username = localStorage.getItem('xiangqi_username') || '';
        this.sessionToken = localStorage.getItem('xiangqi_sessionToken') || '';
        this.isAdmin = localStorage.getItem('xiangqi_isAdmin') === 'true';
        this.currentRoom = null;
        this.yourSide = null; // 'red' | 'black' | 'spectator'
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.isReconnecting = false;
        this.autoJoinCode = null;

        // Check URL for ?room=ABC123
        const urlParams = new URLSearchParams(window.location.search);
        const roomParam = urlParams.get('room');
        if (roomParam) {
            this.autoJoinCode = roomParam.trim().toUpperCase();
        }

        // DOM elements
        this.screenUsername = document.getElementById('screenUsername');
        this.screenLobby = document.getElementById('screenLobby');
        this.screenWaiting = document.getElementById('screenWaiting');
        this.modalCreateRoom = document.getElementById('modalCreateRoom');
        this.modalDrawOffer = document.getElementById('modalDrawOffer');
        this.reconnectOverlay = document.getElementById('mpReconnectOverlay');

        // Sidebar elements
        this.chatContainer = document.getElementById('mpChatContainer');
        this.chatMessages = document.getElementById('mpChatMessages');
        this.chatInput = document.getElementById('mpChatInput');
        this.btnChatSend = document.getElementById('mpBtnChatSend');
        this.btnResign = document.getElementById('mpBtnResign');
        this.btnOfferDraw = document.getElementById('mpBtnOfferDraw');
        this.btnLeave = document.getElementById('mpBtnLeave');
        this.statusDotRed = document.getElementById('mpStatusDotRed');
        this.statusDotBlack = document.getElementById('mpStatusDotBlack');

        this.init();
    }

    applyAdminPermissions() {
        const vfxMenu = document.getElementById('vfxShowcaseMenu');
        const themeSelect = document.getElementById('themeSelect');
        if (vfxMenu) {
            vfxMenu.style.display = this.isAdmin ? 'block' : 'none';
        }
        if (themeSelect) {
            themeSelect.style.display = this.isAdmin ? 'inline-block' : 'none';
        }
    }

    init() {
        this.applyAdminPermissions();
        this.setupDOMEvents();
        this.connect();

        // Check if username exists in localStorage
        if (this.username) {
            const input = document.getElementById('mpUsernameInput');
            if (input) input.value = this.username;
            const passGroup = document.getElementById('mpPasswordGroup');
            if (passGroup) passGroup.style.display = (this.username.toLowerCase() === 'admin') ? 'block' : 'none';
        }
    }

    // =========================================================================
    // WebSocket Networking & Lifecycle
    // =========================================================================

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host || 'localhost:8080';
        const wsUrl = `${protocol}//${host}/ws`;

        try {
            this.ws = new WebSocket(wsUrl);
        } catch (err) {
            console.error('[Multiplayer] Connection failed:', err);
            this.scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            console.log('[Multiplayer] Connected to game server');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            if (this.reconnectOverlay) this.reconnectOverlay.classList.remove('show');

            // Send handshake if username is already known
            if (this.username) {
                this.send({
                    type: 'hello',
                    username: this.username,
                    sessionToken: this.sessionToken || undefined
                });
            } else {
                this.showScreen('username');
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (err) {
                console.error('[Multiplayer] Failed to parse message:', err);
            }
        };

        this.ws.onclose = (event) => {
            console.warn('[Multiplayer] Socket closed:', event.code, event.reason);
            this.isConnected = false;
            if (this.currentRoom && this.currentRoom.status === 'playing') {
                if (this.reconnectOverlay) this.reconnectOverlay.classList.add('show');
            }
            this.scheduleReconnect();
        };

        this.ws.onerror = (err) => {
            console.error('[Multiplayer] WebSocket error:', err);
        };
    }

    scheduleReconnect() {
        if (this.reconnectTimer) return;
        this.reconnectAttempts++;
        // Exponential backoff with jitter (max 10s)
        const delay = Math.min(10000, Math.pow(1.5, this.reconnectAttempts) * 1000 + Math.random() * 500);
        console.log(`[Multiplayer] Reconnecting in ${(delay / 1000).toFixed(1)}s...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    send(data) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        try {
            this.ws.send(JSON.stringify(data));
            return true;
        } catch (err) {
            console.error('[Multiplayer] Send error:', err);
            return false;
        }
    }

    // =========================================================================
    // Protocol Inbound Message Dispatcher
    // =========================================================================

    handleMessage(msg) {
        switch (msg.type) {
            case 'welcome':
                this.userId = msg.userId;
                this.username = msg.username;
                this.sessionToken = msg.sessionToken;
                localStorage.setItem('xiangqi_username', msg.username);
                localStorage.setItem('xiangqi_sessionToken', msg.sessionToken);

                // Update lobby username tag
                const profileTag = document.getElementById('mpUserProfileName');
                if (profileTag) profileTag.textContent = msg.username;

                // If URL requested a specific room, join directly
                if (this.autoJoinCode) {
                    const code = this.autoJoinCode;
                    this.autoJoinCode = null; // Clear so we don't repeat
                    this.send({ type: 'joinRoom', code });
                } else if (msg.activeRoomCode) {
                    // Auto-rejoin active playing match from the server session
                    // (e.g. page reload mid-match)
                    this.send({ type: 'joinRoom', code: msg.activeRoomCode });
                } else if (this.currentRoom && this.currentRoom.code && this.currentRoom.status === 'playing') {
                    // Auto-rejoin active room upon reconnecting
                    this.send({ type: 'joinRoom', code: this.currentRoom.code });
                } else if (!this.currentRoom) {
                    this.showScreen('lobby');
                }
                break;

            case 'roomList':
                this.renderRoomList(msg.rooms);
                break;

            case 'roomJoined':
                this.onRoomJoined(msg);
                break;

            case 'opponentJoined':
                this.onOpponentJoined(msg.opponent);
                break;

            case 'gameStarted':
                this.onGameStarted(msg);
                break;

            case 'moveApplied':
                this.onMoveApplied(msg);
                break;

            case 'moveRejected':
                this.onMoveRejected(msg.reason);
                break;

            case 'gameOver':
                this.onGameOver(msg);
                break;

            case 'drawOffered':
                this.onDrawOffered(msg);
                break;

            case 'opponentDisconnected':
                this.onOpponentDisconnected(msg.graceSeconds, msg.side);
                break;

            case 'opponentReconnected':
                this.onOpponentReconnected(msg.side);
                break;

            case 'chat':
                this.appendChatMessage(msg.from, msg.text, msg.time);
                break;

            case 'error':
                this.onError(msg.code, msg.message);
                break;

            case 'pong':
                break;

            default:
                console.warn('[Multiplayer] Unhandled message type:', msg.type);
        }
    }

    // =========================================================================
    // Room & Gameplay Events
    // =========================================================================

    onRoomJoined(data) {
        this.currentRoom = data;
        this.yourSide = data.yourSide;

        // Configure window.app for online multiplayer
        if (window.app) {
            window.app.resetForRematch(data.board, data.turn);
            window.app.multiplayerMode = true;
            window.app.playerSide = data.yourSide;
            // Switch side for Black player so Black is lower!
            window.app.setFlipped(data.yourSide === 'black');
            if (data.history && Array.isArray(data.history)) {
                window.app.game.history = data.history.map(h => ({
                    notationZh: h.notationZh,
                    notationEn: h.notationEn,
                    move: h.move,
                    inCheck: h.inCheck
                }));
            }
            window.app.clocks = { ...data.clocks };
            window.app.timeMode = data.timeMode;
            window.app.updateClockDisplays();
            if (data.status === 'playing' && data.timeMode !== 'unlimited') {
                window.app.startClock();
            } else {
                window.app.stopClock();
            }
            window.app.render();

            // Set up multiplayer move interceptor
            window.app.onMultiplayerMoveIntent = (move) => {
                this.send({
                    type: 'move',
                    from: move.from,
                    to: move.to
                });
            };
        }

        // Update player card names & side tags
        this.updateHUDPlayerCards(data);

        // Update room status
        if (data.status === 'waiting') {
            document.getElementById('mpWaitingCode').textContent = data.code;
            this.showScreen('waiting');
        } else {
            this.hideAllScreens();
            this.showGameSidebar(true);
        }

        // 'random': no side assigned yet — the draw happens when the
        // opponent joins (server pushes a fresh roomJoined then).
        const sideLabel = data.yourSide === 'random'
            ? 'RANDOM (side drawn when your opponent joins)'
            : data.yourSide.toUpperCase();
        this.appendSystemChat(`Joined room "${data.name}" (${data.code}) as ${sideLabel}`);
    }

    onOpponentJoined(opponent) {
        this.appendSystemChat(`${opponent.username} entered the room as ${opponent.side.toUpperCase()}`);
    }

    onGameStarted(data) {
        this.hideAllScreens();
        this.showGameSidebar(true);

        if (this.currentRoom) {
            this.currentRoom.status = 'playing';
            this.currentRoom.redPlayer = { username: data.redPlayer, connected: true };
            this.currentRoom.blackPlayer = { username: data.blackPlayer, connected: true };
        }

        // Update names in HUD
        const redNameEl = document.querySelector('#cardRed .player-name');
        const blackNameEl = document.querySelector('#cardBlack .player-name');
        const isRedMe = this.yourSide === 'red';
        const isBlackMe = this.yourSide === 'black';
        if (redNameEl) redNameEl.textContent = `${data.redPlayer} ${isRedMe ? '(You · 帥)' : '(帥)'}`;
        if (blackNameEl) blackNameEl.textContent = `${data.blackPlayer} ${isBlackMe ? '(You · 將)' : '(將)'}`;

        this.updateStatusDot('red', true);
        this.updateStatusDot('black', true);

        if (window.app) {
            // Fresh match / rematch start: clear all dark filters, vignettes & restore instant responsiveness
            const targetBoard = (data.board && Array.isArray(data.board) && data.board.length === 10)
                ? data.board
                : (window.app.game && Array.isArray(window.app.game.board) && window.app.game.board.length === 10)
                    ? window.app.game.board
                    : null;
            window.app.resetForRematch(targetBoard, data.turn || 'red');
            window.app.multiplayerMode = true;
            window.app.playerSide = this.yourSide;
            window.app.setFlipped(this.yourSide === 'black');
            if (data.clocks) {
                window.app.clocks = { ...data.clocks };
                window.app.updateClockDisplays();
            }
            const timeMode = (this.currentRoom && this.currentRoom.timeMode) || window.app.timeMode;
            if (timeMode !== 'unlimited') {
                window.app.startClock();
            }
            window.app.render();
        }

        this.appendSystemChat(`The match has begun! Red moves first.`);
    }

    onMoveApplied(moveData) {
        if (!window.app) return;

        // Synchronize clocks
        window.app.clocks = { ...moveData.clocks };
        window.app.updateClockDisplays();
        const timeMode = (this.currentRoom && this.currentRoom.timeMode) || window.app.timeMode;
        if (timeMode !== 'unlimited') {
            window.app.startClock();
        }

        // Apply move through client app animation system
        const move = {
            from: moveData.from,
            to: moveData.to,
            piece: moveData.piece,
            captured: moveData.captured,
            isCheck: moveData.isCheck,
            isCheckmate: moveData.isCheckmate,
            checkingPiece: moveData.checkingPiece || null
        };

        // Authoritatively execute move (orchestrates bespoke piece VFX, audio, check alerts, river cross)
        window.app.executeMove(move);
    }

    onMoveRejected(reason) {
        this.showToast(`Move rejected: ${reason}`, 'error');
        if (window.app) {
            window.app.selectedSquare = null;
            window.app.legalMovesForSelected = [];
            window.app.render();
        }
    }

    onGameOver(data) {
        if (this.currentRoom) {
            this.currentRoom.status = 'ended';
        }

        if (window.app) {
            window.app.stopClock();
            window.app.game.gameOver = true;
            window.app.game.winner = data.winnerSide;
            window.app.game.winReason = data.reason;
            const isMate = data.reason === 'checkmate' || data.reason === 'general_captured';
            if (isMate && window.GameBus && window.effectsManager) {
                // The mating move (via moveApplied -> executeMove) already
                // fired the bus 'checkmate' event, so the cinematic finale is
                // playing and the effects manager will show the modal when it
                // ends. Never pop the modal over a running finale.
                // Fallback: if no finale is running shortly (e.g. the move was
                // still queued, or the event never fired), show the modal so
                // the player is never stranded without the terminal state.
                setTimeout(() => {
                    try {
                        const mgr = window.effectsManager;
                        if (mgr && (mgr._mateInFlight || mgr._mateModalShown || mgr._mateModalPending)) return;
                        if (window.app) window.app.showGameOverModal();
                    } catch (e) {}
                }, 2500);
            } else {
                window.app.showGameOverModal();
            }
        }

        // Update Game Over modal buttons for online multiplayer
        const modalBtnRestart = document.getElementById('modalBtnRestart');
        if (modalBtnRestart) {
            modalBtnRestart.textContent = 'Rematch (Swap Sides) / 再戰一局';
            modalBtnRestart.onclick = () => {
                const modal = document.getElementById('gameOverModal');
                if (modal) modal.classList.remove('open');
                this.send({ type: 'rematch' });
            };
        }

        const modalBtnReplay = document.getElementById('modalBtnReplay');
        if (modalBtnReplay) {
            modalBtnReplay.textContent = 'Back to Lobby / 返回大廳';
            modalBtnReplay.onclick = () => {
                const modal = document.getElementById('gameOverModal');
                if (modal) modal.classList.remove('open');
                this.leaveRoom();
            };
        }

        const reasonZh = data.reason === 'checkmate' ? '絕殺無解！'
                       : data.reason === 'resignation' ? '對方認輸！'
                       : data.reason === 'timeout' ? '超時判負！'
                       : data.reason === 'opponent_disconnect' ? '對方斷線超時，判定棄權！'
                       : data.reason === 'repetition_draw' ? '三次重複局面，判和！'
                       : data.reason === 'draw_agreement' ? '雙方協議和棋！'
                       : '棋局結束';

        this.appendSystemChat(`Game Over: ${reasonZh}`);
    }

    onDrawOffered(data) {
        const modal = document.getElementById('modalDrawOffer');
        const desc = document.getElementById('mpDrawOfferDesc');
        if (desc) desc.textContent = `${data.fromUsername} (${data.fromSide.toUpperCase()}) offered a draw. Accept?`;
        if (modal) modal.classList.add('open');
    }

    onOpponentDisconnected(graceSeconds, side) {
        clearInterval(this.disconnectCountdownInterval);
        let remaining = graceSeconds;
        this.updateStatusDot(side, false, `Reconnecting (${remaining}s)`);

        const tagEl = side === 'red'
            ? document.querySelector('#cardRed .player-turn-tag')
            : document.querySelector('#cardBlack .player-turn-tag');

        if (tagEl) {
            tagEl.dataset.originalText = tagEl.textContent;
            tagEl.textContent = `Reconnecting (${remaining}s)...`;
            tagEl.style.color = '#f59e0b';
        }

        this.disconnectCountdownInterval = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(this.disconnectCountdownInterval);
                if (tagEl) {
                    tagEl.textContent = 'Forfeited';
                    tagEl.style.color = '#ef4444';
                }
            } else {
                this.updateStatusDot(side, false, `Reconnecting (${remaining}s)`);
                if (tagEl) tagEl.textContent = `Reconnecting (${remaining}s)...`;
            }
        }, 1000);

        this.appendSystemChat(`Opponent disconnected! Seat held for ${graceSeconds}s...`);
    }

    onOpponentReconnected(side) {
        clearInterval(this.disconnectCountdownInterval);
        this.updateStatusDot(side, true);

        const tagEl = side === 'red'
            ? document.querySelector('#cardRed .player-turn-tag')
            : document.querySelector('#cardBlack .player-turn-tag');

        if (tagEl) {
            tagEl.textContent = tagEl.dataset.originalText || 'Online';
            tagEl.style.color = '';
        }

        this.appendSystemChat(`Opponent reconnected! Game resumed.`);
        if (this.reconnectOverlay) this.reconnectOverlay.classList.remove('show');
    }

    onError(code, message) {
        console.error(`[Multiplayer Error ${code}]`, message);
        if (code === 'AUTH_FAILED') {
            const errEl = document.getElementById('mpUsernameError');
            if (errEl) errEl.textContent = message;
            this.showScreen('username');
        } else {
            this.showToast(message, 'error');
        }
    }

    // =========================================================================
    // UI Screen Management
    // =========================================================================

    showScreen(screenName) {
        this.hideAllScreens();
        if (screenName === 'username' && this.screenUsername) {
            this.screenUsername.classList.add('open');
            const input = document.getElementById('mpUsernameInput');
            if (input) setTimeout(() => input.focus(), 100);
        } else if (screenName === 'lobby' && this.screenLobby) {
            this.screenLobby.classList.add('open');
            this.send({ type: 'listRooms' });
        } else if (screenName === 'waiting' && this.screenWaiting) {
            this.screenWaiting.classList.add('open');
        }
    }

    hideAllScreens() {
        if (this.screenUsername) this.screenUsername.classList.remove('open');
        if (this.screenLobby) this.screenLobby.classList.remove('open');
        if (this.screenWaiting) this.screenWaiting.classList.remove('open');
        if (this.modalCreateRoom) this.modalCreateRoom.classList.remove('open');
        if (this.modalDrawOffer) this.modalDrawOffer.classList.remove('open');
    }

    renderRoomList(rooms) {
        const listContainer = document.getElementById('mpRoomList');
        if (!listContainer) return;

        if (!rooms || rooms.length === 0) {
            listContainer.innerHTML = `
                <div class="mp-empty-rooms">
                    <div style="font-size: 2rem; margin-bottom: 8px;">🏯</div>
                    <div>No active rooms found.</div>
                    <div style="font-size: 0.85rem; color: #94a3b8; margin-top: 4px;">Click "Create Room" above to start a new match!</div>
                </div>
            `;
            return;
        }

        let html = '';
        for (const room of rooms) {
            const isWaiting = room.status === 'waiting';
            const isPlaying = room.status === 'playing';
            const statusBadge = isWaiting
                ? `<span class="mp-badge mp-badge-waiting">🟢 Waiting</span>`
                : `<span class="mp-badge mp-badge-playing">⚔️ In Progress</span>`;

            const buttonText = isWaiting ? 'Join / 加入' : 'Spectate / 觀戰';
            const buttonClass = isWaiting ? 'btn btn-primary' : 'btn';

            html += `
                <div class="mp-room-card">
                    <div class="mp-room-info">
                        <div class="mp-room-title">${room.name}</div>
                        <div class="mp-room-meta">
                            <span>Host: <strong>${room.hostUsername}</strong></span>
                            <span>Code: <code class="mp-code-tag">${room.code}</code></span>
                            <span>Clock: ${room.timeMode}</span>
                            ${room.spectatorsCount > 0 ? `<span>👁️ ${room.spectatorsCount}</span>` : ''}
                        </div>
                    </div>
                    <div class="mp-room-actions">
                        ${statusBadge}
                        <button class="${buttonClass} mp-btn-join" data-code="${room.code}">${buttonText}</button>
                    </div>
                </div>
            `;
        }

        listContainer.innerHTML = html;

        // Attach join button listeners
        const joinButtons = listContainer.querySelectorAll('.mp-btn-join');
        joinButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const code = e.currentTarget.dataset.code;
                this.send({ type: 'joinRoom', code });
            });
        });
    }

    updateHUDPlayerCards(data) {
        const redNameEl = document.querySelector('#cardRed .player-name');
        const blackNameEl = document.querySelector('#cardBlack .player-name');

        if (data.redPlayer && redNameEl) {
            const isMe = this.yourSide === 'red';
            redNameEl.textContent = `${data.redPlayer.username} ${isMe ? '(You · 帥)' : '(帥)'}`;
            this.updateStatusDot('red', data.redPlayer.connected);
        }
        if (data.blackPlayer && blackNameEl) {
            const isMe = this.yourSide === 'black';
            blackNameEl.textContent = `${data.blackPlayer.username} ${isMe ? '(You · 將)' : '(將)'}`;
            this.updateStatusDot('black', data.blackPlayer.connected);
        }
    }

    updateStatusDot(side, isConnected, customText = null) {
        const dot = side === 'red' ? this.statusDotRed : this.statusDotBlack;
        if (!dot) return;
        dot.className = `mp-status-dot ${isConnected ? 'online' : 'offline'}`;
        dot.title = customText || (isConnected ? 'Online' : 'Disconnected');
    }

    showGameSidebar(show) {
        const sidebar = document.getElementById('mpSidebarControls');
        if (sidebar) {
            sidebar.style.display = show ? 'flex' : 'none';
        }
        // In multiplayer, hide local offline-only buttons (New Game & Undo)
        const btnNewGame = document.getElementById('btnNewGame');
        const btnUndo = document.getElementById('btnUndo');
        if (btnNewGame) btnNewGame.style.display = show ? 'none' : 'block';
        if (btnUndo) btnUndo.style.display = show ? 'none' : 'block';
    }

    leaveRoom() {
        if (this.currentRoom) {
            this.send({ type: 'leaveRoom' });
            this.currentRoom = null;
            this.yourSide = null;
        }
        this.showGameSidebar(false);
        if (window.app) {
            window.app.multiplayerMode = false;
            window.app.playerSide = null;
            window.app.setFlipped(false);
            window.app.resetGame();
        }
        this.showScreen('lobby');
    }

    // =========================================================================
    // In-game Chat
    // =========================================================================

    sendChat() {
        if (!this.chatInput) return;
        const text = this.chatInput.value.trim();
        if (!text) return;
        this.send({ type: 'chat', text });
        this.chatInput.value = '';
    }

    appendChatMessage(from, text, time) {
        if (!this.chatMessages) return;
        const div = document.createElement('div');
        div.className = 'mp-chat-bubble';
        const isSelf = from === this.username;
        if (isSelf) div.classList.add('self');

        const timeStr = time ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        div.innerHTML = `
            <div class="mp-chat-meta">
                <span class="mp-chat-sender">${this.escapeHTML(from)}</span>
                <span class="mp-chat-time">${timeStr}</span>
            </div>
            <div class="mp-chat-text">${this.escapeHTML(text)}</div>
        `;

        this.chatMessages.appendChild(div);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    appendSystemChat(text) {
        if (!this.chatMessages) return;
        const div = document.createElement('div');
        div.className = 'mp-chat-bubble system';
        div.innerHTML = `<span class="mp-chat-system-text">${this.escapeHTML(text)}</span>`;
        this.chatMessages.appendChild(div);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    escapeHTML(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    showToast(message, type = 'info') {
        let toast = document.getElementById('mpToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'mpToast';
            toast.className = 'mp-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.className = `mp-toast show ${type}`;
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // =========================================================================
    // DOM Event Listeners Setup
    // =========================================================================

    setupDOMEvents() {
        // Username submission & admin password check
        const btnJoinArena = document.getElementById('btnJoinArena');
        const usernameInput = document.getElementById('mpUsernameInput');
        const passwordInput = document.getElementById('mpPasswordInput');
        const passwordGroup = document.getElementById('mpPasswordGroup');

        const checkAdminUsername = () => {
            const val = (usernameInput && usernameInput.value ? usernameInput.value : '').trim().toLowerCase();
            if (passwordGroup) {
                passwordGroup.style.display = (val === 'admin') ? 'block' : 'none';
            }
        };

        if (usernameInput) {
            usernameInput.addEventListener('input', checkAdminUsername);
            usernameInput.addEventListener('change', checkAdminUsername);
        }

        const submitUsername = () => {
            const err = document.getElementById('mpUsernameError');
            if (err) err.textContent = '';
            const name = usernameInput ? usernameInput.value.trim() : '';
            if (name.length < 2 || name.length > 20) {
                if (err) err.textContent = 'Name must be between 2 and 20 characters';
                return;
            }
            if (name.toLowerCase() === 'admin') {
                const pass = passwordInput ? passwordInput.value : '';
                if (pass !== '36') {
                    if (err) err.textContent = 'Incorrect password for admin (密碼錯誤)';
                    if (passwordInput) passwordInput.focus();
                    return;
                }
                this.isAdmin = true;
                localStorage.setItem('xiangqi_isAdmin', 'true');
                // One admin login unlocks everything: also open the VFX
                // config + debug panel gate (same admin account).
                try {
                    if (window.AdminGate && typeof window.AdminGate.unlock === 'function') {
                        window.AdminGate.unlock(name, pass);
                    }
                } catch (e) {}
            } else {
                this.isAdmin = false;
                localStorage.removeItem('xiangqi_isAdmin');
                try {
                    if (window.AdminGate && typeof window.AdminGate.lock === 'function') {
                        window.AdminGate.lock();
                    }
                } catch (e2) {}
            }
            this.applyAdminPermissions();
            this.username = name;
            this.send({
                type: 'hello',
                username: name,
                sessionToken: this.sessionToken || undefined
            });
        };

        if (btnJoinArena) btnJoinArena.addEventListener('click', submitUsername);
        if (usernameInput) {
            usernameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    if (usernameInput.value.trim().toLowerCase() === 'admin' && passwordInput && !passwordInput.value) {
                        passwordInput.focus();
                    } else {
                        submitUsername();
                    }
                }
            });
        }
        if (passwordInput) {
            passwordInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submitUsername();
            });
        }

        // Switch user button
        const btnSwitchUser = document.getElementById('mpBtnSwitchUser');
        if (btnSwitchUser) {
            btnSwitchUser.addEventListener('click', () => {
                if (passwordInput) passwordInput.value = '';
                this.showScreen('username');
                checkAdminUsername();
            });
        }

        // Open Create Room Modal
        const btnOpenCreate = document.getElementById('mpBtnOpenCreate');
        if (btnOpenCreate) {
            btnOpenCreate.addEventListener('click', () => {
                if (this.modalCreateRoom) this.modalCreateRoom.classList.add('open');
            });
        }

        // Close Create Room Modal
        const btnCloseCreate = document.getElementById('mpBtnCloseCreate');
        if (btnCloseCreate) {
            btnCloseCreate.addEventListener('click', () => {
                if (this.modalCreateRoom) this.modalCreateRoom.classList.remove('open');
            });
        }

        // Submit Create Room
        const btnSubmitCreate = document.getElementById('mpBtnSubmitCreate');
        if (btnSubmitCreate) {
            btnSubmitCreate.addEventListener('click', () => {
                const nameInput = document.getElementById('mpRoomNameInput');
                const sideSelect = document.getElementById('mpSideSelect');
                const timeSelect = document.getElementById('mpTimeSelect');

                const name = nameInput ? nameInput.value.trim() : '';
                const side = sideSelect ? sideSelect.value : 'random';
                const timeMode = timeSelect ? timeSelect.value : 'unlimited';

                this.send({
                    type: 'createRoom',
                    name: name || undefined,
                    side,
                    timeMode
                });

                if (this.modalCreateRoom) this.modalCreateRoom.classList.remove('open');
            });
        }

        // Join by Code Input & Button
        const joinCodeInput = document.getElementById('mpJoinCodeInput');
        const btnJoinCode = document.getElementById('mpBtnJoinCode');
        const submitJoinCode = () => {
            if (!joinCodeInput) return;
            const code = joinCodeInput.value.trim().toUpperCase();
            if (code.length < 4) {
                this.showToast('Please enter a 6-character room code', 'error');
                return;
            }
            this.send({ type: 'joinRoom', code });
            joinCodeInput.value = '';
        };

        if (btnJoinCode) btnJoinCode.addEventListener('click', submitJoinCode);
        if (joinCodeInput) {
            joinCodeInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submitJoinCode();
            });
            // Auto uppercase & filter ambiguous characters
            joinCodeInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.toUpperCase().replace(/[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g, '');
            });
        }

        // Copy Invitation Link in Waiting Room
        const btnCopyLink = document.getElementById('mpBtnCopyLink');
        if (btnCopyLink) {
            btnCopyLink.addEventListener('click', () => {
                const code = document.getElementById('mpWaitingCode').textContent;
                const link = `${window.location.origin}/?room=${code}`;
                navigator.clipboard.writeText(link).then(() => {
                    this.showToast('Room link copied to clipboard! / 邀請連結已複製', 'success');
                }).catch(() => {
                    prompt('Copy this game link to invite your opponent:', link);
                });
            });
        }

        // Leave Waiting Room
        const btnLeaveWaiting = document.getElementById('mpBtnLeaveWaiting');
        if (btnLeaveWaiting) {
            btnLeaveWaiting.addEventListener('click', () => this.leaveRoom());
        }

        // Sidebar Action Buttons
        if (this.btnResign) {
            this.btnResign.addEventListener('click', () => {
                if (confirm('Are you sure you want to resign this match? / 確定認輸嗎？')) {
                    this.send({ type: 'resign' });
                }
            });
        }

        if (this.btnOfferDraw) {
            this.btnOfferDraw.addEventListener('click', () => {
                if (confirm('Send a draw offer to your opponent? / 向對手請求和棋？')) {
                    this.send({ type: 'offerDraw' });
                    this.showToast('Draw offer sent to opponent', 'info');
                }
            });
        }

        if (this.btnLeave) {
            this.btnLeave.addEventListener('click', () => {
                if (confirm('Leave current match and return to lobby? / 確定退出房間返回大廳？')) {
                    this.leaveRoom();
                }
            });
        }

        // Draw response buttons
        const btnAcceptDraw = document.getElementById('mpBtnAcceptDraw');
        const btnDeclineDraw = document.getElementById('mpBtnDeclineDraw');
        if (btnAcceptDraw) {
            btnAcceptDraw.addEventListener('click', () => {
                this.send({ type: 'respondDraw', accept: true });
                if (this.modalDrawOffer) this.modalDrawOffer.classList.remove('open');
            });
        }
        if (btnDeclineDraw) {
            btnDeclineDraw.addEventListener('click', () => {
                this.send({ type: 'respondDraw', accept: false });
                if (this.modalDrawOffer) this.modalDrawOffer.classList.remove('open');
            });
        }

        // Chat
        if (this.btnChatSend) {
            this.btnChatSend.addEventListener('click', () => this.sendChat());
        }
        if (this.chatInput) {
            this.chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.sendChat();
            });
        }

        // Refresh room list
        const btnRefreshLobby = document.getElementById('mpBtnRefreshLobby');
        if (btnRefreshLobby) {
            btnRefreshLobby.addEventListener('click', () => {
                this.send({ type: 'listRooms' });
            });
        }
    }
}

window.XiangqiMultiplayer = XiangqiMultiplayer;

// Initialize multiplayer after DOM is loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    window.multiplayer = new XiangqiMultiplayer();
} else {
    window.addEventListener('DOMContentLoaded', () => {
        window.multiplayer = new XiangqiMultiplayer();
    });
}
