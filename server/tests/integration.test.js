const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const { WebSocket } = require('ws');
const http = require('http');
const { createServer } = require('../src/index');

function createClientHelper(url) {
    const ws = new WebSocket(url);
    const messages = [];
    const waiters = [];

    ws.on('error', (err) => {
        console.error('[ClientHelper WS Error]', err.message);
    });

    const ready = () => new Promise((resolve, reject) => {
        if (ws.readyState === WebSocket.OPEN) return resolve();
        ws.once('open', resolve);
        ws.once('error', reject);
    });

    ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString('utf-8'));
        const wIdx = waiters.findIndex(w => !w.type || w.type === parsed.type);
        if (wIdx !== -1) {
            const waiter = waiters.splice(wIdx, 1)[0];
            waiter.callback(parsed);
        } else {
            messages.push(parsed);
        }
    });

    const waitForMessageType = (type, timeout = 3000) => {
        return new Promise((resolve, reject) => {
            const idx = messages.findIndex(m => m.type === type);
            if (idx !== -1) {
                return resolve(messages.splice(idx, 1)[0]);
            }
            const timer = setTimeout(() => {
                const wIdx = waiters.findIndex(w => w.type === type);
                if (wIdx !== -1) waiters.splice(wIdx, 1);
                reject(new Error(`Timeout waiting for message type "${type}" after ${timeout}ms`));
            }, timeout);

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

    return {
        ws,
        ready,
        send,
        waitForMessageType,
        close
    };
}

describe('Xiangqi WebSocket Server Integration', () => {
    let app;
    let port;
    let wsUrl;
    let client1;
    let client2;
    let roomCode;
    let token1;
    let token2;

    before(async () => {
        app = createServer({ port: 0 });
        await new Promise((resolve) => {
            app.server.listen(0, '127.0.0.1', () => {
                port = app.server.address().port;
                wsUrl = `ws://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        if (client1) client1.close();
        if (client2) client2.close();
        if (app) await app.close();
    });

    test('1. Client 1 handshakes and creates room', async () => {
        client1 = createClientHelper(wsUrl);
        await client1.ready();

        client1.send({ type: 'hello', username: 'GeneralGuan' });
        const welcome = await client1.waitForMessageType('welcome');
        assert.strictEqual(welcome.username, 'GeneralGuan');
        assert.ok(welcome.sessionToken);
        assert.strictEqual(welcome.activeRoomCode, null,
            'fresh user has no active room to rejoin');
        token1 = welcome.sessionToken;

        // Drain initial roomList
        await client1.waitForMessageType('roomList');

        // Create room as Red
        client1.send({ type: 'createRoom', name: 'Battle of Red Cliffs', side: 'red', timeMode: '5min' });
        const joined = await client1.waitForMessageType('roomJoined');
        assert.strictEqual(joined.yourSide, 'red');
        assert.strictEqual(joined.status, 'waiting');
        assert.ok(joined.code);
        roomCode = joined.code;
    });

    test('2. Client 2 handshakes and joins room by code', async () => {
        client2 = createClientHelper(wsUrl);
        await client2.ready();

        client2.send({ type: 'hello', username: 'StrategistZhuge' });
        const welcome = await client2.waitForMessageType('welcome');
        assert.strictEqual(welcome.username, 'StrategistZhuge');
        token2 = welcome.sessionToken;

        await client2.waitForMessageType('roomList');

        // Join room
        client2.send({ type: 'joinRoom', code: roomCode });
        const joined2 = await client2.waitForMessageType('roomJoined');
        assert.strictEqual(joined2.yourSide, 'black');

        // Client 1 receives opponentJoined and gameStarted
        const oppJoined = await client1.waitForMessageType('opponentJoined');
        assert.strictEqual(oppJoined.opponent.username, 'StrategistZhuge');

        const gameStarted = await client1.waitForMessageType('gameStarted');
        assert.strictEqual(gameStarted.turn, 'red');
    });

    test('3. Illegal moves are rejected', async () => {
        // Client 2 tries to move out of turn
        client2.send({
            type: 'move',
            from: { r: 3, c: 4 },
            to: { r: 4, c: 4 }
        });
        const rejectedTurn = await client2.waitForMessageType('moveRejected');
        assert.strictEqual(rejectedTurn.reason, 'Not your turn');

        // Client 1 tries an illegal piece move (chariot leaping through pieces)
        client1.send({
            type: 'move',
            from: { r: 9, c: 0 },
            to: { r: 5, c: 0 }
        });
        const rejectedMove = await client1.waitForMessageType('moveRejected');
        assert.strictEqual(rejectedMove.reason, 'Illegal move per Xiangqi rules');
    });

    test('4. Legal moves are executed and broadcast', async () => {
        // Red soldier moves forward: (6,4) -> (5,4)
        client1.send({
            type: 'move',
            from: { r: 6, c: 4 },
            to: { r: 5, c: 4 }
        });

        const applied1 = await client1.waitForMessageType('moveApplied');
        const applied2 = await client2.waitForMessageType('moveApplied');

        assert.strictEqual(applied1.piece, 'P');
        assert.strictEqual(applied1.newTurn, 'black');
        assert.strictEqual(applied1.moveNumber, 1);
        assert.strictEqual(applied2.piece, 'P');
    });

    test('5. Disconnect and Reconnect with sessionToken', async () => {
        // Client 2 abruptly disconnects
        await client2.close();

        // Client 1 receives opponent disconnected notice with grace timer
        const oppDisc = await client1.waitForMessageType('opponentDisconnected');
        assert.strictEqual(oppDisc.graceSeconds, 60);

        // Client 2 reconnects using sessionToken
        client2 = createClientHelper(wsUrl);
        await client2.ready();

        client2.send({ type: 'hello', username: 'StrategistZhuge', sessionToken: token2 });
        const welcome = await client2.waitForMessageType('welcome');
        assert.strictEqual(welcome.sessionToken, token2);
        assert.strictEqual(welcome.activeRoomCode, roomCode,
            'welcome carries activeRoomCode so the client can auto-rejoin the live match');

        await client2.waitForMessageType('roomList');

        // Rejoin room
        client2.send({ type: 'joinRoom', code: roomCode });
        const reconnectedRoom = await client2.waitForMessageType('roomJoined');
        assert.strictEqual(reconnectedRoom.yourSide, 'black');
        assert.strictEqual(reconnectedRoom.history.length, 1);

        // Client 1 receives opponentReconnected
        const oppReconn = await client1.waitForMessageType('opponentReconnected');
        assert.strictEqual(oppReconn.side, 'black');
    });

    test('6. In-game chat broadcast', async () => {
        client2.send({ type: 'chat', text: 'Well played!' });
        const chat1 = await client1.waitForMessageType('chat');
        const chat2 = await client2.waitForMessageType('chat');

        assert.strictEqual(chat1.text, 'Well played!');
        assert.strictEqual(chat1.from, 'StrategistZhuge');
        assert.strictEqual(chat2.text, 'Well played!');
    });

    test('7. Draw offer and decline', async () => {
        client1.send({ type: 'offerDraw' });
        const drawOffer = await client2.waitForMessageType('drawOffered');
        assert.strictEqual(drawOffer.fromSide, 'red');

        // Decline
        client2.send({ type: 'respondDraw', accept: false });
        const chatDecline = await client1.waitForMessageType('chat');
        assert.ok(chatDecline.text.includes('declined'));
    });

    test('8. Resignation ends the game', async () => {
        client2.send({ type: 'resign' });
        const gameOver1 = await client1.waitForMessageType('gameOver');
        const gameOver2 = await client2.waitForMessageType('gameOver');

        assert.strictEqual(gameOver1.result, 'win');
        assert.strictEqual(gameOver1.winnerSide, 'red');
        assert.strictEqual(gameOver1.reason, 'resignation');
        assert.strictEqual(gameOver2.winnerSide, 'red');
    });

    test('9. Rematch swaps sides and restarts game', async () => {
        client1.send({ type: 'rematch' });
        client2.send({ type: 'rematch' });

        // Both clients receive new roomJoined with swapped sides
        const restart1 = await client1.waitForMessageType('roomJoined');
        const restart2 = await client2.waitForMessageType('roomJoined');

        // Client 1 was red, now black! Client 2 was black, now red!
        assert.strictEqual(restart1.yourSide, 'black');
        assert.strictEqual(restart2.yourSide, 'red');

        const started = await client1.waitForMessageType('gameStarted');
        assert.strictEqual(started.turn, 'red');
    });

    test('10. Health and Prometheus metrics endpoints', async () => {
        const fetchText = (path) => new Promise((resolve) => {
            http.get(`http://127.0.0.1:${port}${path}`, { headers: { Connection: 'close' } }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, body: data }));
            });
        });

        const health = await fetchText('/healthz');
        assert.strictEqual(health.status, 200);
        assert.ok(health.body.includes('"status":"ok"'));

        const metrics = await fetchText('/metrics');
        assert.strictEqual(metrics.status, 200);
        assert.ok(metrics.body.includes('xiangqi_connected_users 2'));
        assert.ok(metrics.body.includes('xiangqi_active_rooms 1'));
        assert.ok(metrics.body.includes('xiangqi_moves_per_minute 1'));
    });
});
