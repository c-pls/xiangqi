const crypto = require('crypto');
const RateLimiter = require('./rate-limiter');
const config = require('../config');

class Connection {
    constructor(ws, options = {}) {
        this.ws = ws;
        this.id = 'conn_' + crypto.randomBytes(6).toString('hex');
        this.userId = null;
        this.username = null;
        this.sessionToken = null;
        const rate = options.rateLimitPerSec || config.rateLimitPerSec;
        this.rateLimiter = new RateLimiter(rate, rate);
        this.isAlive = true;
        this.currentRoomId = null;
    }

    send(data) {
        if (!this.ws || this.ws.readyState !== 1 /* WebSocket.OPEN */) return false;
        try {
            const payload = typeof data === 'string' ? data : JSON.stringify(data);
            this.ws.send(payload);
            return true;
        } catch (err) {
            console.error('[Connection] send error:', err.message);
            return false;
        }
    }

    sendError(code, message) {
        this.send({ type: 'error', code, message });
    }

    close(code = 1000, reason = 'Normal closure') {
        if (!this.ws) return;
        try {
            this.ws.close(code, reason);
        } catch (e) {}
    }
}

module.exports = Connection;
