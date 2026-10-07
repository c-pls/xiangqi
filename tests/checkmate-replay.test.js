'use strict';
/**
 * tests/checkmate-replay.test.js — QA (W4, Phase 4) mate-replay tests.
 *
 * Uses the REAL js/slowmo.js with a STUBBED window.app
 * ({ game, isAnimating, handleUndo, executeMove }) and asserts:
 *   - window.SlowMo.playMateReplay exists;
 *   - with a stubbed app it runs without throwing: the deferred step
 *     verifies the unmake landed (gameOver === false, history shrank by one),
 *     then begins slow-mo and re-executes the mating move via
 *     app.executeMove({ from, to, piece, captured, isCheckmate: true });
 *   - abort path: when the unmake verification fails (undo refused), the
 *     replay aborts — no executeMove, no slow-mo — without throwing;
 *   - guard rails: no payload -> false; isAnimating -> false.
 *
 * The deferred verification tick uses real setTimeout(0); the suite awaits
 * real short sleeps. Cleanup calls SlowMo.reset() so no wall-clock ramp
 * leaks between tests.
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/checkmate-replay.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const { makeStubs, loadScript } = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const SLOWMO = path.join(ROOT, 'js', 'slowmo.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const __tests = [];
async function test(name, fn) { __tests.push([name, fn]); }

function makeWorld() {
  const stubs = makeStubs();
  let ts = 1;
  stubs.gsap = {
    globalTimeline: {
      timeScale(v) { if (v === undefined) return ts; ts = v; return ts; },
      getChildren: () => [],
    },
  };
  loadScript(stubs, SLOWMO); // document/GameBus absent -> wiring guarded
  const SlowMo = stubs.window.SlowMo;
  assert.ok(SlowMo, 'window.SlowMo defined');
  const executed = [];
  const app = {
    game: { gameOver: true, history: [{ m: 1 }, { m: 2 }, { m: 3 }] },
    isAnimating: false,
    handleUndo() { this.game.history.pop(); this.game.gameOver = false; },
    executeMove(args) { executed.push(args); },
  };
  stubs.window.app = app;
  return { SlowMo, app, executed };
}

function payload() {
  return {
    move: { from: { r: 2, c: 4 }, to: { r: 2, c: 0 }, piece: 'C', captured: null },
    winningPiece: 'C',
    reason: 'checkmate',
  };
}

test('playMateReplay exists on window.SlowMo', () => {
  const w = makeWorld();
  assert.strictEqual(typeof w.SlowMo.playMateReplay, 'function');
});

test('replay runs without throwing: unmake verified, slow-mo begins, move re-executes', async () => {
  const w = makeWorld();
  let ret;
  assert.doesNotThrow(() => { ret = w.SlowMo.playMateReplay(payload()); });
  assert.strictEqual(ret, true, 'replay scheduled');
  // Simulate app.js's own #modalBtnReplay listener (close modal + handleUndo),
  // which runs synchronously on the same click, before our deferred tick.
  w.app.handleUndo();
  await sleep(60);
  assert.strictEqual(w.executed.length, 1, 'executeMove called exactly once');
  const args = w.executed[0];
  assert.deepStrictEqual(args.from, { r: 2, c: 4 });
  assert.deepStrictEqual(args.to, { r: 2, c: 0 });
  assert.strictEqual(args.piece, 'C');
  assert.strictEqual(args.captured, null);
  assert.strictEqual(args.isCheckmate, true, 're-executed as the mating move');
  assert.strictEqual(w.SlowMo.isActive(), true, 'slow-mo began for the replay');
  w.SlowMo.reset(); // cleanup: no ramp leaks into later tests
  assert.strictEqual(w.SlowMo.isActive(), false);
});

test('abort path: unmake verification fails -> no re-execute, no slow-mo, no throw', async () => {
  const w = makeWorld();
  w.app.handleUndo = () => { /* undo refused: game state untouched */ };
  let ret;
  assert.doesNotThrow(() => { ret = w.SlowMo.playMateReplay(payload()); });
  assert.strictEqual(ret, true, 'replay scheduled (verification happens on the tick)');
  await sleep(60);
  assert.strictEqual(w.executed.length, 0, 'executeMove NOT called when unmake failed');
  assert.strictEqual(w.SlowMo.isActive(), false, 'slow-mo NOT started when unmake failed');
});

test('guards: no payload -> false; animating -> false; malformed move -> false', async () => {
  const w = makeWorld();
  assert.strictEqual(w.SlowMo.playMateReplay(null), false, 'null payload refused');
  assert.strictEqual(w.SlowMo.playMateReplay({}), false, 'payload without move refused');
  w.app.isAnimating = true;
  assert.strictEqual(w.SlowMo.playMateReplay(payload()), false, 'refused while animating');
  w.app.isAnimating = false;
  assert.strictEqual(w.SlowMo.playMateReplay({ move: { piece: 'C' } }), false,
    'malformed move (no from/to) refused');
  await sleep(60);
  assert.strictEqual(w.executed.length, 0, 'nothing executed from refused replays');
  assert.strictEqual(w.SlowMo.isActive(), false);
});

(async () => {
  let passed = 0;
  for (const [name, fn] of __tests) {
    try {
      await fn();
      passed++;
      console.log(`ok - ${name}`);
    } catch (err) {
      console.error(`FAIL - ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log(`\ncheckmate replay: ${passed}/${__tests.length} test(s) passed`);
})();
