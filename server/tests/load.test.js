const { describe, test } = require('node:test');
const assert = require('node:assert');
const { WebSocket } = require('ws');
const { createServer } = require('../src/index');

function createClient(port) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messageQueue = [];
    const waiters = [];

    const ready = () => new Promise((resolve, reject) => {
        if (ws.readyState === WebSocket.OPEN) return resolve();
        ws.once('open', resolve);
        ws.once('error', reject);
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString('utf-8'));
        const wIdx = waiters.findIndex(w => w.type === msg.type);
        if (wIdx !== -1) {
            const waiter = waiters.splice(wIdx, 1)[0];
            waiter.callback(msg);
        } else {
            messageQueue.push(msg);
        }
    });

    const waitFor = (type, timeoutMs = 15000) => {
        return new Promise((resolve, reject) => {
            const idx = messageQueue.findIndex(m => m.type === type);
            if (idx !== -1) {
                return resolve(messageQueue.splice(idx, 1)[0]);
            }
            const timer = setTimeout(() => {
                const wIdx = waiters.findIndex(w => w.type === type);
                if (wIdx !== -1) waiters.splice(wIdx, 1);
                const queuedTypes = messageQueue.map(m => m.type).join(', ');
                reject(new Error(`Timeout waiting for "${type}" after ${timeoutMs}ms. Queued messages: [${queuedTypes}]`));
            }, timeoutMs);

            waiters.push({
                type,
                callback: (msg) => {
                    clearTimeout(timer);
                    resolve(msg);
                }
            });
        });
    };

    const send = (obj) => {
        ws.send(JSON.stringify(obj));
    };

    const close = () => {
        try { ws.terminate(); } catch (e) {}
    };

    return { ws, ready, waitFor, send, close };
}

describe('Xiangqi Single-Replica Load Verification', () => {
    test('50 concurrent rooms with 100 WebSocket clients playing simultaneously', { timeout: 35000 }, async () => {
        const { server, close, roomManager } = createServer({
            rateLimitPerSec: 500
        });

        await new Promise((resolve) => server.listen(0, resolve));
        const port = server.address().port;

        const NUM_ROOMS = 50;
        const clients = [];
        const startTime = Date.now();
        const initialMem = process.memoryUsage().heapUsed;

        try {
            const roomPromises = [];

            for (let i = 0; i < NUM_ROOMS; i++) {
                const roomIndex = i;
                const task = async () => {
                    const host = createClient(port);
                    const guest = createClient(port);
                    clients.push(host, guest);

                    await Promise.all([host.ready(), guest.ready()]);

                    // Handshakes
                    host.send({ type: 'hello', username: `HostUser_${roomIndex}` });
                    await host.waitFor('welcome');

                    guest.send({ type: 'hello', username: `GuestUser_${roomIndex}` });
                    await guest.waitFor('welcome');

                    // Host creates room with side Red
                    host.send({ type: 'createRoom', name: `PerfRoom_${roomIndex}`, side: 'red' });
                    const joined = await host.waitFor('roomJoined');
                    const code = joined.code;

                    // Guest joins room
                    guest.send({ type: 'joinRoom', code });
                    await Promise.all([
                        guest.waitFor('gameStarted'),
                        host.waitFor('gameStarted')
                    ]);

                    // Move 1: Red Cannon [7, 1] -> [7, 4]
                    host.send({ type: 'move', from: [7, 1], to: [7, 4] });
                    const [redMoveHost, redMoveGuest] = await Promise.all([
                        host.waitFor('moveApplied'),
                        guest.waitFor('moveApplied')
                    ]);

                    assert.strictEqual(redMoveHost.moveNumber, 1);
                    assert.strictEqual(redMoveGuest.moveNumber, 1);

                    // Move 2: Black Horse [0, 1] -> [2, 2]
                    guest.send({ type: 'move', from: [0, 1], to: [2, 2] });
                    const [blackMoveHost, blackMoveGuest] = await Promise.all([
                        host.waitFor('moveApplied'),
                        guest.waitFor('moveApplied')
                    ]);

                    assert.strictEqual(blackMoveHost.moveNumber, 2);
                    assert.strictEqual(blackMoveGuest.moveNumber, 2);

                    return { roomIndex, success: true };
                };

                roomPromises.push(task());
            }

            const results = await Promise.all(roomPromises);
            const durationSec = (Date.now() - startTime) / 1000;
            const finalMem = process.memoryUsage().heapUsed;
            const memDeltaMb = Math.round((finalMem - initialMem) / 1024 / 1024 * 100) / 100;

            console.log(`\n========================================`);
            console.log(`✓ 50 Rooms Load Test Succeeded!`);
            console.log(`✓ Concurrent Rooms: ${results.length}`);
            console.log(`✓ Concurrent WebSocket Clients: ${clients.length}`);
            console.log(`✓ Total Moves Processed: ${NUM_ROOMS * 2}`);
            console.log(`✓ Total Duration: ${durationSec.toFixed(2)}s (${(NUM_ROOMS / durationSec).toFixed(1)} rooms/s)`);
            console.log(`✓ Memory Overhead: ${memDeltaMb} MB`);
            console.log(`========================================\n`);

            assert.strictEqual(results.length, NUM_ROOMS);
            assert.strictEqual(roomManager.storage.rooms.size, NUM_ROOMS);
        } finally {
            for (const c of clients) {
                c.close();
            }
            await close();
        }
    });
});
