const IRoomStorage = require('./interface');

class MemoryRoomStorage extends IRoomStorage {
    constructor() {
        super();
        this.rooms = new Map(); // roomId -> Room
        this.codeToId = new Map(); // upperCode -> roomId
    }

    async get(roomId) {
        return this.rooms.get(roomId) || null;
    }

    async getByCode(code) {
        if (!code) return null;
        const normalized = code.trim().toUpperCase();
        const id = this.codeToId.get(normalized);
        if (!id) return null;
        return this.rooms.get(id) || null;
    }

    async set(roomId, room) {
        this.rooms.set(roomId, room);
        if (room.code) {
            this.codeToId.set(room.code.toUpperCase(), roomId);
        }
    }

    async delete(roomId) {
        const room = this.rooms.get(roomId);
        if (room && room.code) {
            this.codeToId.delete(room.code.toUpperCase());
        }
        this.rooms.delete(roomId);
    }

    async listAll() {
        return Array.from(this.rooms.values());
    }

    async count() {
        return this.rooms.size;
    }
}

module.exports = MemoryRoomStorage;
