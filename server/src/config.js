const config = {
    port: parseInt(process.env.PORT || '8080', 10),
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()),
    reconnectGraceSeconds: parseInt(process.env.RECONNECT_GRACE_SECONDS || '60', 10),
    turnTimerSeconds: parseInt(process.env.TURN_TIMER_SECONDS || '0', 10),
    roomCleanupTimeoutMs: parseInt(process.env.ROOM_CLEANUP_TIMEOUT_MS || String(10 * 60 * 1000), 10),
    heartbeatIntervalMs: 25000,
    rateLimitPerSec: 10,
    maxPayloadBytes: 2048,
    logLevel: process.env.LOG_LEVEL || 'info'
};

module.exports = config;
