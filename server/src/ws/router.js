const { ClientMessageSchema } = require('../protocol/schemas');
const { authenticate, sanitizeText } = require('../auth/authenticate');
const { defaultMetrics } = require('../metrics/tracker');
const config = require('../config');

class MessageRouter {
    constructor(roomManager, userConnections = new Map()) {
        this.roomManager = roomManager;
        this.userConnections = userConnections; // userId -> Connection
    }

    async handleMessage(connection, rawMessage) {
        // 1. Message size limit (max 2KB)
        const byteLength = Buffer.byteLength(rawMessage);
        if (byteLength > config.maxPayloadBytes) {
            connection.sendError('PAYLOAD_TOO_LARGE', `Message exceeds max allowed size of ${config.maxPayloadBytes} bytes`);
            return;
        }

        // 2. Rate limit (10 msg/sec)
        if (!connection.rateLimiter.tryConsume()) {
            connection.sendError('RATE_LIMITED', 'Too many messages sent. Please slow down.');
            return;
        }

        // 3. JSON parsing
        let parsed;
        try {
            parsed = JSON.parse(rawMessage);
        } catch (err) {
            connection.sendError('MALFORMED_JSON', 'Invalid JSON syntax');
            return;
        }

        // 4. Schema validation with Zod
        const result = ClientMessageSchema.safeParse(parsed);
        if (!result.success) {
            const firstError = result.error.errors[0]?.message || 'Invalid message schema';
            connection.sendError('INVALID_SCHEMA', firstError);
            return;
        }

        const msg = result.data;

        // 5. Dispatch message
        try {
            switch (msg.type) {
                case 'ping':
                    connection.send({ type: 'pong' });
                    break;

                case 'hello':
                    await this.handleHello(connection, msg);
                    break;

                case 'listRooms':
                    await this.handleListRooms(connection);
                    break;

                case 'createRoom':
                    await this.handleCreateRoom(connection, msg);
                    break;

                case 'joinRoom':
                    await this.handleJoinRoom(connection, msg);
                    break;

                case 'leaveRoom':
                    await this.handleLeaveRoom(connection);
                    break;

                case 'move':
                    await this.handleMove(connection, msg);
                    break;

                case 'resign':
                    await this.handleResign(connection);
                    break;

                case 'offerDraw':
                    await this.handleOfferDraw(connection);
                    break;

                case 'respondDraw':
                    await this.handleRespondDraw(connection, msg);
                    break;

                case 'rematch':
                    await this.handleRematch(connection);
                    break;

                case 'chat':
                    await this.handleChat(connection, msg);
                    break;

                default:
                    connection.sendError('UNKNOWN_MESSAGE', 'Unrecognized message type');
            }
        } catch (err) {
            console.error('[Router] Error processing message:', err);
            connection.sendError('INTERNAL_ERROR', 'Internal server error processing message');
        }
    }

    async handleHello(connection, msg) {
        const authResult = await authenticate(msg.username, msg.sessionToken);
        if (!authResult.success) {
            connection.sendError('AUTH_FAILED', authResult.error);
            return;
        }

        const user = authResult.user;

        // If user already has an active connection, replace it with the new one
        const existingConn = this.userConnections.get(user.userId);
        if (existingConn && existingConn.id !== connection.id) {
            existingConn.sendError('SESSION_REPLACED', 'Your session was opened in another window or tab');
            existingConn.close(4001, 'Replaced by newer connection');
        }

        connection.userId = user.userId;
        connection.username = user.username;
        connection.sessionToken = user.sessionToken;
        this.userConnections.set(user.userId, connection);

        // If the user still has a live playing room (e.g. page reload
        // mid-match), tell the client so it can auto-rejoin on welcome.
        let activeRoomCode = null;
        if (this.roomManager && this.roomManager.userCurrentRoom &&
            this.roomManager.userCurrentRoom.has(user.userId)) {
            const activeRoomId = this.roomManager.userCurrentRoom.get(user.userId);
            const activeRoom = await this.roomManager.getRoom(activeRoomId);
            if (activeRoom && activeRoom.status === 'playing') {
                activeRoomCode = activeRoom.code;
            }
        }

        connection.send({
            type: 'welcome',
            userId: user.userId,
            username: user.username,
            sessionToken: user.sessionToken,
            activeRoomCode
        });

        // Automatically subscribe to live lobby updates
        this.roomManager.subscribeLobby(connection);
        const rooms = await this.roomManager.listRooms();
        connection.send({
            type: 'roomList',
            rooms
        });
    }

    async handleListRooms(connection) {
        this.roomManager.subscribeLobby(connection);
        const rooms = await this.roomManager.listRooms();
        connection.send({
            type: 'roomList',
            rooms
        });
    }

    async handleCreateRoom(connection, msg) {
        if (!connection.userId) {
            connection.sendError('UNAUTHENTICATED', 'Must complete handshake (hello) before creating room');
            return;
        }

        const user = {
            userId: connection.userId,
            username: connection.username,
            sessionToken: connection.sessionToken,
            connection
        };

        const res = await this.roomManager.createRoom(user, {
            name: msg.name ? sanitizeText(msg.name) : undefined,
            side: msg.side,
            timeMode: msg.timeMode
        });

        if (!res.success) {
            connection.sendError('CREATE_FAILED', res.reason);
            return;
        }

        connection.currentRoomId = res.room.id;
        this.roomManager.unsubscribeLobby(connection);
        connection.send(res.room.getJoinedPayload(connection.userId));
    }

    async handleJoinRoom(connection, msg) {
        if (!connection.userId) {
            connection.sendError('UNAUTHENTICATED', 'Must complete handshake (hello) before joining room');
            return;
        }

        const user = {
            userId: connection.userId,
            username: connection.username,
            sessionToken: connection.sessionToken,
            connection
        };

        const res = await this.roomManager.joinRoom(user, msg.code);
        if (!res.success) {
            connection.sendError('JOIN_FAILED', res.reason);
            return;
        }

        connection.currentRoomId = res.room.id;
        this.roomManager.unsubscribeLobby(connection);
        connection.send(res.room.getJoinedPayload(connection.userId));
        res.room.checkGameStart();
    }

    async handleLeaveRoom(connection) {
        if (!connection.currentRoomId || !connection.userId) return;
        const roomId = connection.currentRoomId;
        connection.currentRoomId = null;

        await this.roomManager.leaveRoom({ userId: connection.userId }, roomId);
        this.roomManager.subscribeLobby(connection);
        await this.handleListRooms(connection);
    }

    async handleMove(connection, msg) {
        if (!connection.currentRoomId || !connection.userId) {
            connection.sendError('NOT_IN_ROOM', 'Cannot make a move when not in a game room');
            return;
        }

        const room = await this.roomManager.getRoom(connection.currentRoomId);
        if (!room) {
            connection.sendError('ROOM_NOT_FOUND', 'Room no longer exists');
            return;
        }

        const result = room.applyMove(connection.userId, msg.from, msg.to);
        if (!result.success) {
            connection.send({
                type: 'moveRejected',
                reason: result.reason
            });
        } else {
            defaultMetrics.recordMove();
        }
    }

    async handleResign(connection) {
        if (!connection.currentRoomId || !connection.userId) return;
        const room = await this.roomManager.getRoom(connection.currentRoomId);
        if (room) room.resign(connection.userId);
    }

    async handleOfferDraw(connection) {
        if (!connection.currentRoomId || !connection.userId) return;
        const room = await this.roomManager.getRoom(connection.currentRoomId);
        if (room) room.offerDraw(connection.userId);
    }

    async handleRespondDraw(connection, msg) {
        if (!connection.currentRoomId || !connection.userId) return;
        const room = await this.roomManager.getRoom(connection.currentRoomId);
        if (room) room.respondDraw(connection.userId, msg.accept);
    }

    async handleRematch(connection) {
        if (!connection.currentRoomId || !connection.userId) return;
        const room = await this.roomManager.getRoom(connection.currentRoomId);
        if (room) room.requestRematch(connection.userId);
    }

    async handleChat(connection, msg) {
        if (!connection.currentRoomId || !connection.userId) return;
        const room = await this.roomManager.getRoom(connection.currentRoomId);
        if (room) {
            const clean = sanitizeText(msg.text);
            room.sendChat({ username: connection.username }, clean);
        }
    }

    async handleDisconnect(connection) {
        this.roomManager.unsubscribeLobby(connection);

        if (connection.userId && this.userConnections.get(connection.userId) === connection) {
            this.userConnections.delete(connection.userId);
        }

        if (connection.currentRoomId && connection.userId) {
            const room = await this.roomManager.getRoom(connection.currentRoomId);
            if (room) {
                room.handleDisconnect(connection.userId);
            }
        }
    }
}

module.exports = MessageRouter;
