const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert');
const Room = require('../src/rooms/room');

// 'random' rooms: nobody is seated at creation. Both players are drawn into
// red/black the moment the room fills (second player joins) — there is no
// provisional side and nothing flips (user request, 2026-10-06).

function makeConn() {
    return { sent: [], send(m) { this.sent.push(m); } };
}

function makeUser(id, username, conn) {
    return { userId: id, username, sessionToken: 'tok-' + id, connection: conn || makeConn() };
}

let roomSeq = 0;
function makeRoom(preferredSide) {
    roomSeq++;
    return new Room({
        id: 'room_test_' + roomSeq,
        code: 'ABC123',
        name: 'Side Draw Test',
        hostUser: makeUser('host', 'Host'),
        preferredSide,
        timeMode: 'unlimited'
    });
}

function messagesOfType(conn, type) {
    return conn.sent.filter((m) => m && m.type === type);
}

const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; });

describe('Room random side draw at fill (deferred seating)', () => {
    test('host creates random room: not seated, payload says random', () => {
        const room = makeRoom('random');
        assert.strictEqual(room.red, null);
        assert.strictEqual(room.black, null);
        assert.strictEqual(room.getUserSide('host'), null);
        assert.strictEqual(room.awaitingDraw.length, 1);
        assert.strictEqual(room._sidesDrawn, false);
        const payload = room.getJoinedPayload('host');
        assert.strictEqual(payload.yourSide, 'random');
        assert.strictEqual(payload.status, 'waiting');
    });

    test('draw on fill: both seated, waiting player notified, guest role final', () => {
        Math.random = () => 0.99; // players[0] (host) -> black
        const room = makeRoom('random');
        const hostConn = room.awaitingDraw[0].connection;

        const res = room.join(makeUser('guest', 'Guest'));

        assert.strictEqual(res.role, 'red', 'guest drew red');
        assert.strictEqual(res.isReconnect, false);
        assert.strictEqual(room.getUserSide('host'), 'black');
        assert.strictEqual(room.getUserSide('guest'), 'red');
        assert.strictEqual(room.awaitingDraw.length, 0);
        assert.strictEqual(room._sidesDrawn, true);

        const joined = messagesOfType(hostConn, 'roomJoined');
        assert.strictEqual(joined.length, 1, 'waiting player pushed one fresh payload');
        assert.strictEqual(joined[0].yourSide, 'black');
        assert.strictEqual(joined[0].opponent.username, 'Guest');
        assert.strictEqual(joined[0].opponent.side, 'red');
    });

    test('draw the other way (Math.random -> 0.01): host red, guest black', () => {
        Math.random = () => 0.01; // players[0] (host) -> red
        const room = makeRoom('random');
        const res = room.join(makeUser('guest', 'Guest'));
        assert.strictEqual(res.role, 'black');
        assert.strictEqual(room.getUserSide('host'), 'red');
        assert.strictEqual(room.getUserSide('guest'), 'black');
    });

    test('uniformity: alternating draws split sides evenly', () => {
        let i = 0;
        const seq = [0.99, 0.01]; // host black, host red, ...
        Math.random = () => seq[i++ % seq.length];
        let hostRed = 0;
        for (let n = 0; n < 20; n++) {
            const room = makeRoom('random');
            room.join(makeUser('g' + n, 'Guest' + n));
            if (room.getUserSide('host') === 'red') hostRed++;
        }
        assert.strictEqual(hostRed, 10);
    });

    test('explicit side choice: unchanged behavior, no draw pool', () => {
        const room = makeRoom('red');
        assert.strictEqual(room.getUserSide('host'), 'red');
        assert.strictEqual(room.awaitingDraw.length, 0);
        const hostConn = room.red.connection;

        const res = room.join(makeUser('guest', 'Guest'));
        assert.strictEqual(res.role, 'black');
        assert.strictEqual(messagesOfType(hostConn, 'roomJoined').length, 0,
            'no draw payload for explicit sides');
        const opp = messagesOfType(hostConn, 'opponentJoined');
        assert.strictEqual(opp.length, 1);
        assert.strictEqual(opp[0].opponent.side, 'black');
    });

    test('third join after draw becomes spectator; no re-draw', () => {
        Math.random = () => 0.99;
        const room = makeRoom('random');
        const hostConn = room.awaitingDraw[0].connection;
        room.join(makeUser('guest', 'Guest'));
        assert.strictEqual(messagesOfType(hostConn, 'roomJoined').length, 1);

        const res = room.join(makeUser('spec', 'Spectator'));
        assert.strictEqual(res.role, 'spectator');
        assert.strictEqual(room.getUserSide('host'), 'black');
        assert.strictEqual(room.getUserSide('guest'), 'red');
        assert.strictEqual(messagesOfType(hostConn, 'roomJoined').length, 1,
            'no second draw');
    });

    test('pending host disconnecting leaves the draw pool', () => {
        const room = makeRoom('random');
        assert.strictEqual(room.awaitingDraw.length, 1);
        assert.strictEqual(room.hasLiveParticipants(), true);
        room.handleDisconnect('host');
        assert.strictEqual(room.awaitingDraw.length, 0);
        assert.strictEqual(room.hasLiveParticipants(), false);
    });

    test('pending host reconnecting stays pending (no seat taken)', () => {
        const room = makeRoom('random');
        const conn2 = makeConn();
        const res = room.join({
            userId: 'host', username: 'Host',
            sessionToken: 'tok-host', connection: conn2
        });
        assert.strictEqual(res.isReconnect, true);
        assert.strictEqual(res.role, 'random');
        assert.strictEqual(room.awaitingDraw.length, 1);
        assert.strictEqual(room.awaitingDraw[0].connection, conn2);
        assert.strictEqual(room.red, null);
    });

    test('lobby summary names the pending host', () => {
        const room = makeRoom('random');
        assert.strictEqual(room.getSummary().hostUsername, 'Host');
    });
});
