'use strict';
/**
 * tests/checkmate-flow.test.js — QA (W4, Phase 4) event-flow smoke tests.
 *
 * Emits 'checkmate' on the REAL GameBus with STUBBED engines (CheckmateVFX,
 * SlowMo, audioManager, app.showGameOverModal) through the REAL
 * effects-bridge, once per winning piece, and asserts the full pipeline:
 *   - the global sequence runs FIRST (freezeFlash -> SlowMo.begin -> pushIn
 *     -> dimBoard), before any per-piece visual;
 *   - the correct per-piece finale runs;
 *   - the closing beats run (SlowMo.end, restoreBoard) and the game-over
 *     modal shows EXACTLY ONCE per run (commit-once / modal-once guard);
 *   - a second emission starts a fresh run (guard resets per run).
 *
 * The manager's checkmate timers are captured at the instance level
 * (mgr._later), so the suite is fully deterministic — no wall-clock waits.
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/checkmate-flow.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const { makeStubs, loadScript } = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const CONFIG = path.join(ROOT, 'js', 'effects-config.js');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');

const VFX_METHODS = [
  'freezeFlash', 'pushIn', 'dimBoard', 'restoreBoard',
  'cannonPalaceExplosion', 'cannonFireworks',
  'chariotGateSmash', 'chariotCavalrySweep',
  'horseMoonLeap', 'horseLightningStrike',
  'soldierSpotlight', 'soldierBow',
  'flyingDuelSlash',
  'crownFall', 'flagLower', 'palaceCrumble',
  'paintJueSha', 'celebrate', 'clearAll',
  'katanaSlash',
];

const __tests = [];
async function test(name, fn) { __tests.push([name, fn]); }

function makeWorld() {
  const stubs = makeStubs();
  const vfxCalls = [];
  const slowmoCalls = [];
  const audioCalls = [];
  let modalCalls = 0;
  const vfx = {};
  for (const m of VFX_METHODS) vfx[m] = (...a) => vfxCalls.push({ name: m, args: a });
  stubs.window.CheckmateVFX = vfx;
  stubs.window.SlowMo = {
    begin: (o) => { slowmoCalls.push(['begin', o]); },
    end: (o) => { slowmoCalls.push(['end', o]); },
    reset: () => { slowmoCalls.push(['reset']); },
    isActive: () => false,
  };
  stubs.window.audioManager = { play: (k) => audioCalls.push(k) };
  stubs.window.app = { showGameOverModal: () => { modalCalls++; } };
  loadScript(stubs, BUS);
  loadScript(stubs, CONFIG);
  loadScript(stubs, BRIDGE);
  const mgr = stubs.window.effectsManager;
  const queue = [];
  mgr._later = (ms, fn) => { queue.push({ ms, fn }); return queue.length; };
  mgr._clearMateTimers = () => { queue.length = 0; };
  return {
    mgr,
    bus: stubs.window.GameBus,
    vfxCalls, slowmoCalls, audioCalls, queue,
    drive() {
      while (queue.length) {
        queue.sort((a, b) => a.ms - b.ms);
        queue.shift().fn();
      }
    },
    vfxNames: () => vfxCalls.map((c) => c.name),
    modalCalls: () => modalCalls,
  };
}

function mateEvent(pieceKey, reason) {
  return {
    move: { piece: pieceKey, from: { r: 0, c: 0 }, to: { r: 0, c: 1 }, captured: null },
    pieceKey,
    winningPiece: pieceKey,
    losingGeneralCell: { r: 9, c: 4 },
    winnerSide: 'red',
    reason: reason || 'checkmate',
  };
}

const PIECES = ['C', 'R', 'H', 'P', 'flyingGeneral'];
const CLOSING = ['crownFall', 'flagLower', 'palaceCrumble', 'paintJueSha', 'celebrate'];

for (const pieceKey of PIECES) {
  test(`flow (${pieceKey}): global sequence first, finale, closing beats, modal once`, () => {
    const w = makeWorld();
    w.mgr.setIntensity('full');
    w.bus.emit('checkmate', mateEvent(pieceKey, pieceKey === 'flyingGeneral' ? 'general_captured' : 'checkmate'));

    // Global sequence, synchronously: freezeFlash, SlowMo.begin, pushIn.
    assert.deepStrictEqual(w.vfxNames(), ['freezeFlash', 'pushIn'],
      'sync prefix is exactly [freezeFlash, pushIn]');
    assert.deepStrictEqual(w.slowmoCalls, [['begin', { minScale: 0.25, downMs: 600 }]],
      'sync SlowMo call is exactly begin({minScale:0.25, downMs:600})');

    w.drive();
    const names = w.vfxNames();

    // Global beats precede every per-piece visual.
    const dimIdx = names.indexOf('dimBoard');
    assert.ok(dimIdx > 1, 'dimBoard (global) fired');
    const firstFinaleIdx = names.findIndex((n) =>
      ['cannonPalaceExplosion', 'chariotGateSmash', 'horseMoonLeap',
       'soldierSpotlight', 'flyingDuelSlash'].includes(n));
    assert.ok(firstFinaleIdx > dimIdx, 'per-piece finale starts after the global beats');

    // Closing beats run in order at the tail (before restoreBoard).
    const tail = names.slice(names.indexOf('crownFall'));
    assert.deepStrictEqual(tail.slice(0, 5), CLOSING, 'closing beats in order');
    assert.strictEqual(tail[5], 'restoreBoard', 'restoreBoard closes the visuals');

    // SlowMo.end exactly once, then the modal exactly once.
    assert.deepStrictEqual(w.slowmoCalls.map(([n]) => n), ['begin', 'end'],
      'SlowMo call order is exactly [begin, end]');
    assert.strictEqual(w.modalCalls(), 1, 'game-over modal shown exactly once');

    // Draining again changes nothing (commit/modal once-guarded).
    w.drive();
    w.bus.emit('checkmate', mateEvent(pieceKey)); // a fresh run is a new commit
    assert.strictEqual(w.modalCalls(), 1, 'no extra modal before the new run drains');
    w.drive();
    assert.strictEqual(w.modalCalls(), 2, 'fresh run commits its own modal exactly once');
  });
}

test('flow: skipAll mid-finale aborts cleanly and lands the modal once', () => {
  const w = makeWorld();
  w.mgr.setIntensity('full');
  w.bus.emit('checkmate', mateEvent('C'));
  w.mgr.skipAll();
  assert.ok(w.vfxCalls.some((c) => c.name === 'clearAll'), 'clearAll called on skip');
  assert.ok(w.slowmoCalls.some(([n]) => n === 'reset'), 'SlowMo.reset called on skip');
  assert.strictEqual(w.modalCalls(), 1, 'skipped finale lands the modal');
  w.drive();
  assert.strictEqual(w.modalCalls(), 1, 'stale phases no-op after skip (modal still once)');
});

test('flow: notifyNewGame mid-finale abandons the run with no modal', () => {
  const w = makeWorld();
  w.mgr.setIntensity('full');
  w.bus.emit('checkmate', mateEvent('R'));
  w.mgr.notifyNewGame('g2');
  assert.ok(w.slowmoCalls.some(([n]) => n === 'reset'), 'SlowMo.reset called on new game');
  w.drive();
  assert.strictEqual(w.modalCalls(), 0, 'abandoned finale never shows the modal');
  assert.deepStrictEqual(w.vfxNames(), ['freezeFlash', 'pushIn', 'clearAll'],
    'only the synchronous global beats fired before abandonment, then clearAll wiped the overlays');
});

test('flow: notifyNewGame after a finished finale clears checkmate overlays', () => {
  const w = makeWorld();
  w.mgr.setIntensity('full');
  w.bus.emit('checkmate', mateEvent('C'));
  w.drive(); // full finale: palaceCrumble paints cracks, banner, modal
  assert.ok(w.vfxNames().includes('palaceCrumble'), 'finale painted the palace cracks');
  w.vfxCalls.length = 0;
  w.mgr.notifyNewGame('g3'); // rematch
  assert.ok(w.vfxNames().includes('clearAll'),
    'rematch wipes finale overlays via CheckmateVFX.clearAll (no stale cracks on the new board)');
});

test('flow: paintJueSha receives the winning side for scroll theming', () => {
  const cases = [
    ['red', 'red'],
    ['black', 'black'],
    [undefined, 'red'], // missing side defaults to red
  ];
  for (const [side, expected] of cases) {
    const w = makeWorld();
    w.mgr.setIntensity('low'); // short path: paintJueSha @700ms
    const ev = mateEvent('R');
    if (side === undefined) delete ev.winnerSide;
    else ev.winnerSide = side;
    w.bus.emit('checkmate', ev);
    w.drive();
    const call = w.vfxCalls.find((c) => c.name === 'paintJueSha');
    assert.ok(call, 'paintJueSha fired');
    assert.deepStrictEqual(call.args, [expected],
      `paintJueSha must receive the winning side ('${expected}')`);
  }
});

test('flow: chariot finale runs the katana slash beat', () => {
  const w = makeWorld();
  w.mgr.setIntensity('full');
  w.bus.emit('checkmate', mateEvent('R'));
  w.drive();
  const names = w.vfxNames();
  const slashIdx = names.indexOf('katanaSlash');
  const gateIdx = names.indexOf('chariotGateSmash');
  const sweepIdx = names.indexOf('chariotCavalrySweep');
  assert.ok(slashIdx > gateIdx, 'katana slash fires after the gate smash');
  assert.ok(sweepIdx > slashIdx, 'cavalry sweep follows the katana slash');
  assert.ok(w.vfxCalls.some((c) => c.name === 'katanaSlash'), 'katanaSlash dispatched');
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
  console.log(`\ncheckmate event flow: ${passed}/${__tests.length} test(s) passed`);
})();
