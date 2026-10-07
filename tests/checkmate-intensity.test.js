'use strict';
/**
 * tests/checkmate-intensity.test.js — QA (W4, Phase 4) intensity-gating tests.
 *
 * Loads the REAL js/event-bus.js + REAL js/effects-config.js + REAL
 * js/effects-bridge.js with STUBBED engines (CheckmateVFX, SlowMo,
 * audioManager, app.showGameOverModal). Drives 'checkmate' through the REAL
 * GameBus at each intensity and asserts the manager-owned gating:
 *   - off:  modal immediately, zero CheckmateVFX / SlowMo / audio calls,
 *           no timers scheduled.
 *   - low:  only freezeFlash + dimBoard + paintJueSha (+ dim restoreBoard) +
 *           modal; NO SlowMo.begin, NO audioManager.play, NO per-piece finale.
 *   - full: ordered global beats (freezeFlash -> SlowMo.begin -> pushIn ->
 *           dimBoard) -> config-driven per-piece finale (incl. audio-only
 *           beats) -> closing beats (SlowMo.end, restoreBoard) -> modal,
 *           exactly once.
 *
 * The manager's checkmate timers are captured at the instance level
 * (mgr._later), so the suite is fully deterministic — no wall-clock waits.
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/checkmate-intensity.test.js
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
];

const __tests = [];
async function test(name, fn) { __tests.push([name, fn]); }

function makeWorld() {
  const stubs = makeStubs();
  const vfxCalls = [];    // { name, args }
  const slowmoCalls = []; // [name, opts]
  const audioCalls = [];  // key
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
  assert.ok(mgr, 'window.effectsManager constructed');
  // Capture the manager's checkmate timers at the instance level so the
  // sequence runs deterministically (global timers stay real).
  const queue = [];
  mgr._later = (ms, fn) => { queue.push({ ms, fn }); return queue.length; };
  mgr._clearMateTimers = () => { queue.length = 0; };
  const drive = () => {
    while (queue.length) {
      queue.sort((a, b) => a.ms - b.ms);
      queue.shift().fn();
    }
  };
  return {
    mgr,
    bus: stubs.window.GameBus,
    vfxCalls, slowmoCalls, audioCalls, queue, drive,
    vfxNames: () => vfxCalls.map((c) => c.name),
    modalCalls: () => modalCalls,
  };
}

function mateEvent(pieceKey) {
  return {
    move: { piece: pieceKey, from: { r: 1, c: 2 }, to: { r: 1, c: 5 }, captured: null },
    pieceKey,
    winningPiece: pieceKey,
    losingGeneralCell: { r: 9, c: 4 },
    winnerSide: 'red',
    reason: 'checkmate',
  };
}

test('off: modal immediately, zero engine/audio calls, no timers', () => {
  const w = makeWorld();
  w.mgr.setIntensity('off');
  w.bus.emit('checkmate', mateEvent('C'));
  assert.strictEqual(w.modalCalls(), 1, 'modal shown synchronously at off');
  assert.deepStrictEqual(w.vfxNames(), [], 'zero CheckmateVFX calls at off');
  assert.deepStrictEqual(w.slowmoCalls, [], 'zero SlowMo calls at off');
  assert.deepStrictEqual(w.audioCalls, [], 'zero audioManager.play calls at off');
  assert.strictEqual(w.queue.length, 0, 'no timers scheduled at off');
  w.drive();
  assert.strictEqual(w.modalCalls(), 1, 'modal still exactly once after drain');
});

test('low: freezeFlash+dimBoard+paintJueSha+modal only; no slow-mo, no audio', () => {
  const w = makeWorld();
  w.mgr.setIntensity('low');
  w.bus.emit('checkmate', mateEvent('C'));
  // Low path: freezeFlash + dimBoard are synchronous; paintJueSha @700ms,
  // restoreBoard + modal @1600ms.
  assert.deepStrictEqual(w.vfxNames(), ['freezeFlash', 'dimBoard'],
    'synchronous low beats are freezeFlash, dimBoard');
  assert.strictEqual(w.modalCalls(), 0, 'no modal before the low timeline drains');
  w.drive();
  assert.deepStrictEqual(w.vfxNames(),
    ['freezeFlash', 'dimBoard', 'paintJueSha', 'restoreBoard'],
    'full low sequence is freezeFlash, dimBoard, paintJueSha, restoreBoard');
  assert.strictEqual(w.modalCalls(), 1, 'modal exactly once at low');
  assert.ok(!w.slowmoCalls.some(([n]) => n === 'begin'), 'SlowMo.begin never called at low');
  assert.deepStrictEqual(w.slowmoCalls, [], 'zero SlowMo calls at low');
  assert.deepStrictEqual(w.audioCalls, [], 'zero manager audio at low');
  assert.ok(!w.vfxNames().includes('cannonPalaceExplosion'),
    'no per-piece spectacle at low');
});

test('full: ordered global beats -> per-piece finale -> closing beats -> modal once', () => {
  const w = makeWorld();
  w.mgr.setIntensity('full');
  w.bus.emit('checkmate', mateEvent('C'));

  // Global beats, synchronous part: freezeFlash, SlowMo.begin, pushIn.
  assert.deepStrictEqual(w.vfxNames(), ['freezeFlash', 'pushIn'],
    'sync global beats: freezeFlash then pushIn');
  assert.strictEqual(w.slowmoCalls.length, 1, 'one SlowMo call synchronously');
  assert.strictEqual(w.slowmoCalls[0][0], 'begin', 'the call is begin');
  assert.deepStrictEqual(w.slowmoCalls[0][1], { minScale: 0.25, downMs: 600 },
    'begin opts are exactly {minScale:0.25, downMs:600}');
  assert.strictEqual(w.modalCalls(), 0, 'no modal before the finale drains');

  w.drive();

  const names = w.vfxNames();
  const expectedVfx = [
    'freezeFlash', 'pushIn',
    'dimBoard',                       // t=500 global beat
    'cannonPalaceExplosion',          // t=900 config t=0
    // t=1600 is an audio-only beat (cannon_impact): no visual
    'cannonFireworks',                // t=2300
    'crownFall', 'flagLower', 'palaceCrumble',
    'paintJueSha', 'celebrate',
    'restoreBoard',                   // closing beat in _endMateFull
  ];
  assert.deepStrictEqual(names, expectedVfx, 'full ordered visual sequence');

  const expectedAudio = [
    'cannon_fire',    // t=900
    'cannon_impact',  // t=1600 audio-only beat
    'debris_scatter', // t=2300
    'debris_scatter', // t=4000 palaceCrumble
    'epic_gong',      // t=4600 paintJueSha
    'checkmate',      // t=5600 celebrate
  ];
  assert.deepStrictEqual(w.audioCalls, expectedAudio, 'full ordered audio sequence');

  // Closing beats: SlowMo.end (not begin again), modal exactly once.
  assert.deepStrictEqual(w.slowmoCalls.map(([n]) => n), ['begin', 'end'],
    'SlowMo call order is begin then end');
  assert.deepStrictEqual(w.slowmoCalls[1][1], { upMs: 800 },
    'end opts are exactly {upMs:800}');
  assert.strictEqual(w.modalCalls(), 1, 'modal shown exactly once');
  w.drive();
  assert.strictEqual(w.modalCalls(), 1, 'modal still exactly once after re-drain');
});

test('full: second checkmate starts a fresh run (modal once per run)', () => {
  const w = makeWorld();
  w.mgr.setIntensity('full');
  w.bus.emit('checkmate', mateEvent('C'));
  w.drive();
  assert.strictEqual(w.modalCalls(), 1);
  w.bus.emit('checkmate', mateEvent('R'));
  w.drive();
  assert.strictEqual(w.modalCalls(), 2, 'second run shows the modal a second time');
  assert.ok(w.vfxNames().includes('chariotGateSmash'), 'second run ran the R finale');
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
  console.log(`\ncheckmate intensity gating: ${passed}/${__tests.length} test(s) passed`);
})();
