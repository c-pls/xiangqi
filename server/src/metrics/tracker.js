class MetricsTracker {
    constructor() {
        this.moveTimestamps = []; // timestamps in ms of recent moves
        this.activeConnectionsCount = 0;
        this.roomManager = null;
    }

    setRoomManager(manager) {
        this.roomManager = manager;
    }

    recordMove() {
        this.moveTimestamps.push(Date.now());
        this.pruneMoveTimestamps();
    }

    pruneMoveTimestamps() {
        const cutoff = Date.now() - 60000;
        while (this.moveTimestamps.length > 0 && this.moveTimestamps[0] < cutoff) {
            this.moveTimestamps.shift();
        }
    }

    getMovesPerMinute() {
        this.pruneMoveTimestamps();
        return this.moveTimestamps.length;
    }

    async getMetrics(activeConnections) {
        const movesPerMin = this.getMovesPerMinute();
        let activeRooms = 0;
        if (this.roomManager) {
            const rooms = await this.roomManager.storage.listAll();
            activeRooms = rooms.filter(r => r.status === 'playing' || r.status === 'waiting').length;
        }

        return [
            '# HELP xiangqi_connected_users Number of currently connected WebSocket users',
            '# TYPE xiangqi_connected_users gauge',
            `xiangqi_connected_users ${activeConnections}`,
            '# HELP xiangqi_active_rooms Number of currently active game rooms',
            '# TYPE xiangqi_active_rooms gauge',
            `xiangqi_active_rooms ${activeRooms}`,
            '# HELP xiangqi_moves_per_minute Rate of chess moves made per minute',
            '# TYPE xiangqi_moves_per_minute gauge',
            `xiangqi_moves_per_minute ${movesPerMin}`
        ].join('\n') + '\n';
    }
}

const defaultMetrics = new MetricsTracker();

module.exports = {
    MetricsTracker,
    defaultMetrics
};
