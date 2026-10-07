const crypto = require('crypto');
const Room = require('./room');
const { generateRoomCode, normalizeRoomCode } = require('./code-generator');
const MemoryRoomStorage = require('../storage/memory-storage');
const config = require('../config');

class RoomManager {
    constructor(storage = new MemoryRoomStorage()) {
        this.storage = storage;
        this.userHostedRooms = new Map(); // userId -> roomId
        this.userCurrentRoom = new Map(); // userId -> roomId
        this.lobbySubscribers = new Set(); // Set of connections subscribed to roomList updates

        // Periodic cleanup of abandoned rooms
        this.cleanupInterval = setInterval(() => this.cleanupAbandonedRooms(), 60000);
        this.cleanupInterval.unref();
    }

    subscribeLobby(connection) {
        this.lobbySubscribers.add(connection);
    }

    unsubscribeLobby(connection) {
        this.lobbySubscribers.delete(connection);
    }

    broadcastLobbyUpdate(roomList = null) {
        const payload = {
            type: 'roomList',
            rooms: roomList || this.listRoomsSync()
        };
        for (const conn of this.lobbySubscribers) {
            conn.send(payload);
        }
    }

    listRoomsSync() {
        if (this.storage instanceof MemoryRoomStorage) {
            return Array.from(this.storage.rooms.values()).map(r => r.getSummary());
        }
        return [];
    }

    async listRooms() {
        const all = await this.storage.listAll();
        return all.map(r => r.getSummary());
    }

    async createRoom(hostUser, { name, side = 'random', timeMode = 'unlimited' }) {
        // Enforce max 1 room per user
        const existingRoomId = this.userHostedRooms.get(hostUser.userId);
        if (existingRoomId) {
            const existingRoom = await this.storage.get(existingRoomId);
            if (existingRoom && existingRoom.status !== 'ended') {
                return { success: false, reason: 'You already have an active room hosted' };
            }
        }

        // Generate unique 6-character room code
        let code;
        let attempts = 0;
        do {
            code = generateRoomCode();
            attempts++;
            const existing = await this.storage.getByCode(code);
            if (!existing) break;
        } while (attempts < 10);

        const roomId = 'room_' + crypto.randomBytes(8).toString('hex');
        const room = new Room({
            id: roomId,
            code,
            name,
            hostUser,
            preferredSide: side,
            timeMode
        });

        await this.storage.set(roomId, room);
        this.userHostedRooms.set(hostUser.userId, roomId);
        this.userCurrentRoom.set(hostUser.userId, roomId);

        // Notify lobby of new room
        const roomList = await this.listRooms();
        this.broadcastLobbyUpdate(roomList);

        return { success: true, room };
    }

    async joinRoom(user, codeOrId) {
        let room = await this.storage.get(codeOrId);
        if (!room) {
            const normalized = normalizeRoomCode(codeOrId);
            room = await this.storage.getByCode(normalized);
        }

        if (!room) {
            return { success: false, reason: 'Room not found. Check the code and try again.' };
        }

        // Prevent joining own room twice on the same session
        const currentRoomId = this.userCurrentRoom.get(user.userId);
        if (currentRoomId && currentRoomId !== room.id) {
            await this.leaveRoom(user, currentRoomId);
        }

        const joinResult = room.join(user);
        this.userCurrentRoom.set(user.userId, room.id);

        // Update lobby
        const roomList = await this.listRooms();
        this.broadcastLobbyUpdate(roomList);

        return { success: true, room, role: joinResult.role, isReconnect: joinResult.isReconnect };
    }

    async leaveRoom(user, roomId) {
        const room = await this.storage.get(roomId);
        if (!room) return;

        room.handleDisconnect(user.userId);
        this.userCurrentRoom.delete(user.userId);

        if (this.userHostedRooms.get(user.userId) === roomId) {
            this.userHostedRooms.delete(user.userId);
        }

        // Check if room is completely empty
        if (!room.hasLiveParticipants()) {
            room.destroy();
            await this.storage.delete(roomId);
        }

        const roomList = await this.listRooms();
        this.broadcastLobbyUpdate(roomList);
    }

    async getRoom(roomId) {
        return this.storage.get(roomId);
    }

    async cleanupAbandonedRooms() {
        const now = Date.now();
        const timeout = config.roomCleanupTimeoutMs;
        const allRooms = await this.storage.listAll();

        for (const room of allRooms) {
            const isInactive = (now - room.lastActive) > timeout;
            const hasConnected = room.hasLiveParticipants();

            if (isInactive || (!hasConnected && (now - room.createdAt) > 60000)) {
                room.destroy();
                await this.storage.delete(room.id);
                if (room.red) this.userCurrentRoom.delete(room.red.userId);
                if (room.black) this.userCurrentRoom.delete(room.black.userId);
                this.userHostedRooms.delete(room.hostUserId);
            }
        }
    }

    destroy() {
        clearInterval(this.cleanupInterval);
        if (this.storage && this.storage.rooms) {
            for (const room of this.storage.rooms.values()) {
                try { room.destroy(); } catch (e) {}
            }
        }
    }
}

module.exports = RoomManager;
