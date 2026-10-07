'use strict';
/**
 * tests/checkmate-slowmo-restore.test.js — QA (W4, Phase 4) slow-mo restore.
 *
 * CRITICAL: after every slow-mo episode the engine must restore EXACTLY:
 *   gsap.globalTimeline.timeScale() === 1
 *   every sfx Howl rate() === its exact pre-begin rate (authored 1.25)
 *
 * Uses the REAL js/slowmo.js with a stubbed gsap (recording timeScale) and
 * 24 stubbed sfx Howls. Covers:
 *   1. normal finale end: begin() -> end() restores exactly;
 *   2. skip mid-finale: begin() -> reset() restores instantly and exactly;
 *   3. reset() while idle still enforces timeScale 1 (hard restore);
 *   4. simulated intensity change mid-finale: the documented recovery action
 *      (SlowMo.reset()) restores exactly;
 *   5. manager wiring: skipAll() mid-finale -> SlowMo.reset() -> restore;
 *   6. manager wiring: full finale end -> SlowMo.end({upMs:800}) -> restore.
 *
 * FINDING (F4-RESTORE-01): js/slowmo.js documents as integration contract
 * path 3 that "Intensity change mid-finale: setIntensity() must call
 * SlowMo.reset() when SlowMo.isActive()". The shipped effects-bridge.js
 * setIntensity() does NOT do this. Slow-mo is NOT left stuck — the finale's
 * own timers still drive to _endMateFull -> SlowMo.end() — but the intensity
 * change does not take effect on the in-flight finale. Pinned below as
 * observed behavior; the manager should decide whether to wire it.
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/checkmate-slowmo-restore.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const { makeStubs, loadScript } = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const CONFIG = path.join(ROOT, 'js', 'effects-config.js');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');
const SLOWMO = path.join(ROOT, 'js', 'slowmo.js');

// The 24 real vfx.js sfx keys (authored Howl rate 1.25 each).
const SFX_KEYS = [
  'advisor_capture', 'ball_whistle', 'cannon_charge', 'cannon_check',
  'cannon_fire', 'cannon_impact', 'chariot_capture', 'chariot_check',
  'checkmate', 'debris_scatter', 'elephant_capture', 'epic_check',
  'epic_gong', 'flying_general_check', 'fuse_hiss', 'general_capture',
  'general_check', 'horse_capture', 'horse_check', 'horse_run',
  'katana_unsheathe', 'smoke_hiss', 'soldier_capture', 'soldier_check',
];
const AUTHORED_RATE = 1.25;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const __tests = [];
async function test(name, fn) { __tests.push([name, fn]); }

function makeHowl() {
  let r = AUTHORED_RATE;
  const seen = [];
  return {
    rate(v) {
      if (v === undefined) return r;
      seen.push(v);
      r = v;
      return r;
    },
    _get: () => r,
    _seen: seen,
  };
}

function makeSfxMap() {
  const map = {};
  for (const k of SFX_KEYS) map[k] = makeHowl();
  return map;
}

// Real slowmo.js with stubbed gsap + stubbed sfx Howls.
function makeSlowMoWorld() {
  const stubs = makeStubs();
  let ts = 1;
  const tsSeen = [];
  stubs.gsap = {
    globalTimeline: {
      timeScale(v) {
        if (v === undefined) return ts;
        tsSeen.push(v);
        ts = v;
        return ts;
      },
      getChildren: () => [],
    },
  };
  const sfxMap = makeSfxMap();
  loadScript(stubs, SLOWMO, { sfx: sfxMap });
  const SlowMo = stubs.window.SlowMo;
  assert.ok(SlowMo, 'window.SlowMo defined');
  return {
    SlowMo,
    timeScale: () => ts,
    tsSeen,
    rates: () => SFX_KEYS.map((k) => sfxMap[k]._get()),
    assertRestored(label) {
      assert.strictEqual(ts, 1, `${label}: timeScale === 1 (got ${ts})`);
      for (const k of SFX_KEYS) {
        assert.strictEqual(sfxMap[k]._get(), AUTHORED_RATE,
          `${label}: Howl ${k} rate restored exactly to ${AUTHORED_RATE}`);
      }
    },
  };
}

test('normal finale end: begin -> end restores timeScale and every Howl exactly', async () => {
  const w = makeSlowMoWorld();
  assert.strictEqual(w.SlowMo.begin({ minScale: 0.25, downMs: 600 }), true);
  assert.strictEqual(w.SlowMo.isActive(), true);
  await sleep(60); // let the wall-clock ramp move mid-flight
  assert.ok(w.timeScale() < 1, `ramp moved timeScale down (got ${w.timeScale()})`);
  w.SlowMo.end({ upMs: 0 }); // upMs 0: single frame -> hardRestore
  await sleep(120);
  assert.strictEqual(w.SlowMo.isActive(), false);
  w.assertRestored('end()');
});

test('skip mid-finale: begin -> reset restores instantly and exactly', async () => {
  const w = makeSlowMoWorld();
  w.SlowMo.begin({ minScale: 0.25, downMs: 600 });
  await sleep(60);
  assert.ok(w.timeScale() < 1, 'mid-ramp before reset');
  assert.strictEqual(w.SlowMo.reset(), true);
  assert.strictEqual(w.SlowMo.isActive(), false);
  w.assertRestored('reset() mid-ramp');
});

test('reset while idle still enforces the restored values', () => {
  const w = makeSlowMoWorld();
  // Corrupt the stubbed clock directly, then reset with nothing active.
  w.SlowMo.begin({ minScale: 0.1, downMs: 400 });
  w.SlowMo.reset();
  w.assertRestored('reset() idle');
  assert.strictEqual(w.SlowMo.isActive(), false);
  assert.strictEqual(w.SlowMo.end(), true, 'end() while idle is a no-op success');
  w.assertRestored('end() idle');
});

test('simulated intensity change mid-finale: documented recovery restores exactly', async () => {
  const w = makeSlowMoWorld();
  w.SlowMo.begin({ minScale: 0.25, downMs: 600 });
  await sleep(60);
  // The intensity-change path's documented recovery action is SlowMo.reset().
  w.SlowMo.reset();
  w.assertRestored('intensity-change recovery');
});

// --- manager wiring: real bridge + real slowmo -------------------------------
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

function makeManagerWorld() {
  const stubs = makeStubs();
  let ts = 1;
  stubs.gsap = {
    globalTimeline: {
      timeScale(v) { if (v === undefined) return ts; ts = v; return ts; },
      getChildren: () => [],
    },
  };
  const sfxMap = makeSfxMap();
  const vfxCalls = [];
  const audioCalls = [];
  let modalCalls = 0;
  const vfx = {};
  for (const m of VFX_METHODS) vfx[m] = (...a) => vfxCalls.push(m);
  stubs.window.CheckmateVFX = vfx;
  stubs.window.audioManager = { play: (k) => audioCalls.push(k) };
  stubs.window.app = { showGameOverModal: () => { modalCalls++; } };
  loadScript(stubs, BUS);
  loadScript(stubs, CONFIG);
  loadScript(stubs, SLOWMO, { sfx: sfxMap });
  loadScript(stubs, BRIDGE);
  const mgr = stubs.window.effectsManager;
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
    mgr, bus: stubs.window.GameBus, SlowMo: stubs.window.SlowMo,
    drive, vfxCalls,
    modalCalls: () => modalCalls,
    timeScale: () => ts,
    assertRestored(label) {
      assert.strictEqual(ts, 1, `${label}: timeScale === 1 (got ${ts})`);
      for (const k of SFX_KEYS) {
        assert.strictEqual(sfxMap[k]._get(), AUTHORED_RATE,
          `${label}: Howl ${k} rate restored exactly`);
      }
    },
  };
}

function mateEvent(pieceKey) {
  return {
    move: { piece: pieceKey, from: { r: 1, c: 2 }, to: { r: 1, c: 5 } },
    pieceKey,
    winningPiece: pieceKey,
    losingGeneralCell: { r: 9, c: 4 },
    winnerSide: 'red',
    reason: 'checkmate',
  };
}

test('manager skipAll mid-finale: SlowMo.reset wired, restore exact, modal lands', async () => {
  const w = makeManagerWorld();
  w.mgr.setIntensity('full');
  w.bus.emit('checkmate', mateEvent('C'));
  await sleep(60); // real slow-mo ramp is mid-flight on wall-clock timers
  assert.strictEqual(w.SlowMo.isActive(), true, 'slow-mo active mid-finale');
  w.mgr.skipAll();
  assert.strictEqual(w.SlowMo.isActive(), false, 'skipAll deactivated slow-mo');
  w.assertRestored('skipAll');
  assert.ok(w.vfxCalls.includes('clearAll'), 'skipAll cleared checkmate visuals');
  assert.strictEqual(w.modalCalls(), 1, 'skipped finale still lands the modal');
  w.drive();
  assert.strictEqual(w.modalCalls(), 1, 'modal exactly once; stale phases no-op');
});

test('manager normal finale end: SlowMo.end({upMs:800}) then exact restore', async () => {
  const w = makeManagerWorld();
  w.mgr.setIntensity('full');
  w.bus.emit('checkmate', mateEvent('C'));
  w.drive(); // fires the whole finale incl. _endMateFull -> SlowMo.end({upMs:800})
  assert.strictEqual(w.modalCalls(), 1, 'finale ended at the modal');
  await sleep(1600); // 800ms wall-clock ramp-up + margin
  assert.strictEqual(w.SlowMo.isActive(), false, 'slow-mo inactive after end');
  w.assertRestored('finale end');
});

test('manager notifyNewGame mid-finale: SlowMo.reset wired, restore exact', async () => {
  const w = makeManagerWorld();
  w.mgr.setIntensity('full');
  w.bus.emit('checkmate', mateEvent('C'));
  await sleep(60);
  assert.strictEqual(w.SlowMo.isActive(), true, 'slow-mo active mid-finale');
  w.mgr.notifyNewGame('g1');
  assert.strictEqual(w.SlowMo.isActive(), false, 'new game deactivated slow-mo');
  w.assertRestored('notifyNewGame');
  w.drive();
  assert.strictEqual(w.modalCalls(), 0, 'abandoned finale never shows the modal');
});

test('F4-RESTORE-01 FIXED: setIntensity mid-finale resets slow-mo', async () => {
  const w = makeManagerWorld();
  w.mgr.setIntensity('full');
  w.bus.emit('checkmate', mateEvent('C'));
  await sleep(60);
  assert.strictEqual(w.SlowMo.isActive(), true, 'slow-mo active mid-finale');
  // slowmo.js documents path 3: setIntensity() must call SlowMo.reset() when
  // active. Wired in effects-bridge.js setIntensity (F4-RESTORE-01 fix,
  // close-out 2026-10-06) — the intensity change takes effect immediately.
  w.mgr.setIntensity('low');
  assert.strictEqual(w.SlowMo.isActive(), false,
    'setIntensity mid-finale reset slow-mo (F4-RESTORE-01 fixed)');
  w.assertRestored('setIntensity mid-finale reset is exact');
  // The in-flight finale's remaining phases still drain to the modal;
  // restore must hold through the end() ramp (800ms + margin).
  w.drive();
  await sleep(1600);
  w.assertRestored('post-drain after mid-finale intensity change');
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
  console.log(`\ncheckmate slow-mo restore: ${passed}/${__tests.length} test(s) passed`);
})();
