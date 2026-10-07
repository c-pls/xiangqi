/**
 * IRoomStorage Interface Contract
 * Allows RoomManager to swap in-memory storage for Redis / Key-Value storage
 * without rewriting business logic.
 */
class IRoomStorage {
    async get(roomId) { throw new Error('Not implemented'); }
    async getByCode(code) { throw new Error('Not implemented'); }
    async set(roomId, room) { throw new Error('Not implemented'); }
    async delete(roomId) { throw new Error('Not implemented'); }
    async listAll() { throw new Error('Not implemented'); }
    async count() { throw new Error('Not implemented'); }
}

module.exports = IRoomStorage;
