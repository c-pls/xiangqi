const http = require('http');
const fs = require('fs');
const path = require('path');
const { defaultMetrics } = require('./metrics/tracker');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg'
};

function createHttpHandler({ staticDir, getActiveConnectionsCount, onPreStop }) {
    return async function handleHttpRequest(req, res) {
        try {
            let hostHeader = req.headers.host || 'localhost';
            let url;
            try {
                url = new URL(req.url, `http://${hostHeader}`);
            } catch (e) {
                url = new URL(req.url, 'http://localhost');
            }
            const pathname = url.pathname;

            // 1. Health check probe
            if (pathname === '/healthz') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
                return;
            }

            // 2. Prometheus metrics probe
            if (pathname === '/metrics') {
                const count = getActiveConnectionsCount ? getActiveConnectionsCount() : 0;
                const metricsText = await defaultMetrics.getMetrics(count);
                res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
                res.end(metricsText);
                return;
            }

            // 2b. Kubernetes preStop hook endpoint
            if (pathname === '/pre-stop') {
                if (onPreStop) {
                    try { onPreStop(); } catch (e) {}
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'pre_stop_notified' }));
                return;
            }

            // 3. Static file serving
            let targetFile = pathname === '/' ? '/index.html' : pathname;
            // Prevent path traversal
            const safePath = path.normalize(targetFile).replace(/^(\.\.[\/\\])+/, '');
            const fullPath = path.join(staticDir, safePath);

            // Security check: ensure resolved path is within staticDir
            if (!fullPath.startsWith(staticDir)) {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                res.end('403 Forbidden');
                return;
            }

            fs.stat(fullPath, (err, stats) => {
                if (err || !stats.isFile()) {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('404 Not Found');
                    return;
                }

                const ext = path.extname(fullPath).toLowerCase();
                const contentType = MIME_TYPES[ext] || 'application/octet-stream';

                res.writeHead(200, {
                    'Content-Type': contentType,
                    'Content-Length': stats.size,
                    'Cache-Control': 'no-cache'
                });

                const stream = fs.createReadStream(fullPath);
                stream.on('error', (streamErr) => {
                    console.error('[HTTP Stream Error]', streamErr);
                    if (!res.headersSent) {
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                    }
                    res.end('Internal Server Error');
                });
                stream.pipe(res);
            });
        } catch (err) {
            console.error('[HTTP Server Error]', err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
            }
            res.end('Internal Server Error: ' + err.message);
        }
    };
}

module.exports = {
    createHttpHandler,
    MIME_TYPES
};
