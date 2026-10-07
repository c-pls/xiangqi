const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const config = require('./config');
const { createHttpHandler } = require('./http-server');
const RoomManager = require('./rooms/room-manager');
const MessageRouter = require('./ws/router');
const Connection = require('./ws/connection');
const { defaultMetrics } = require('./metrics/tracker');

function createServer(customConfig = {}) {
    const cfg = { ...config, ...customConfig };
    const staticDir = path.resolve(__dirname, '../../');
    const roomManager = new RoomManager();
    defaultMetrics.setRoomManager(roomManager);

    const activeConnections = new Map(); // conn.id -> Connection
    const userConnections = new Map(); // userId -> Connection
    const router = new MessageRouter(roomManager, userConnections);

    const httpHandler = createHttpHandler({
        staticDir,
        getActiveConnectionsCount: () => activeConnections.size,
        onPreStop: () => notifyShutdown()
    });

    const server = http.createServer(httpHandler);
    const wss = new WebSocketServer({ noServer: true });

    // Origin verification on HTTP upgrade
    server.on('upgrade', (req, socket, head) => {
        const origin = req.headers.origin;
        if (cfg.allowedOrigins.length > 0 && !cfg.allowedOrigins.includes('*')) {
            if (!origin || !cfg.allowedOrigins.includes(origin)) {
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                socket.destroy();
                return;
            }
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    });

    // Connection lifecycle
    wss.on('connection', (ws, req) => {
        if (ws._socket && ws._socket.setNoDelay) {
            ws._socket.setNoDelay(true);
        }
        const conn = new Connection(ws, { rateLimitPerSec: cfg.rateLimitPerSec });
        activeConnections.set(conn.id, conn);

        ws.on('pong', () => {
            conn.isAlive = true;
        });

        ws.on('message', async (data) => {
            const raw = data.toString('utf-8');
            await router.handleMessage(conn, raw);
        });

        ws.on('close', async () => {
            activeConnections.delete(conn.id);
            await router.handleDisconnect(conn);
        });

        ws.on('error', (err) => {
            console.error('[WebSocket Error]', err.message);
        });
    });

    // 25-second Heartbeat interval
    const heartbeatInterval = setInterval(() => {
        for (const conn of activeConnections.values()) {
            if (!conn.isAlive) {
                conn.close(1001, 'Heartbeat timeout');
                activeConnections.delete(conn.id);
                continue;
            }
            conn.isAlive = false;
            try {
                conn.ws.ping();
            } catch (e) {}
        }
    }, cfg.heartbeatIntervalMs);
    heartbeatInterval.unref();

    function notifyShutdown() {
        for (const conn of activeConnections.values()) {
            conn.send({
                type: 'error',
                code: 'SERVER_RESTART',
                message: 'Server is undergoing scheduled restart. Reconnecting shortly...'
            });
            conn.close(1012, 'Service Restart');
        }
    }

    function close() {
        clearInterval(heartbeatInterval);
        roomManager.destroy();
        notifyShutdown();
        for (const client of wss.clients) {
            try { client.terminate(); } catch (e) {}
        }
        return new Promise((resolve) => {
            if (server.closeAllConnections) {
                try { server.closeAllConnections(); } catch (e) {}
            }
            if (server.closeIdleConnections) {
                try { server.closeIdleConnections(); } catch (e) {}
            }
            let serverClosed = false;
            let wssClosed = false;
            let resolved = false;

            const check = () => {
                if (!resolved && (serverClosed && wssClosed)) {
                    resolved = true;
                    resolve();
                }
            };

            wss.close(() => {
                wssClosed = true;
                check();
            });

            server.close(() => {
                serverClosed = true;
                check();
            });

            const safety = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    resolve();
                }
            }, 800);
            safety.unref();
        });
    }

    return {
        server,
        wss,
        roomManager,
        activeConnections,
        userConnections,
        router,
        close
    };
}

if (require.main === module) {
    const { server, close } = createServer();
    server.listen(config.port, () => {
        console.log(`\n==================================================`);
        console.log(`⚔️  Xiangqi Server is running!`);
        console.log(`👉 Open in browser: http://localhost:${config.port}`);
        console.log(`   (or http://127.0.0.1:${config.port})`);
        console.log(`⚠️  Note: Do NOT use 0.0.0.0 in browser URL bar (modern browsers block 0.0.0.0)`);
        console.log(`📊 Health check:    http://localhost:${config.port}/healthz`);
        console.log(`📈 Metrics probe:   http://localhost:${config.port}/metrics`);
        console.log(`==================================================\n`);
    });

    const shutdown = async () => {
        console.log('[Xiangqi Server] Shutting down gracefully...');
        await close();
        process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

module.exports = { createServer };
