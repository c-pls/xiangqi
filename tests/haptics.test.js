'use strict';
/**
 * tests/haptics.test.js — QA (W4) tests for Phase 5 haptics (W3).
 *
 * W3 adds guarded `navigator.vibrate` haptics to js/effects-bridge.js.
 *
 * PINNED CONTRACT (W3 actual, verified 2026-10-06 against js/effects-bridge.js):
 *  - Haptics fire at 'low' and 'full' intensity, SILENT at 'off' (the call
 *    sites sit after the intensity-'off' early returns).
 *  - Exact patterns: capture -> 40, check -> [30, 60, 30],
 *    checkmate -> [60, 80, 60, 80, 120].
 *  - _haptic(pattern) guards `typeof navigator` / `navigator.vibrate`;
 *    never throws when the API is missing.
 *
 * Covers:
 *  - At 'low'/'full': the three handlers (bus 'capture' / 'check' /
 *    'checkmate', driven through the REAL GameBus -> EffectsManager chain)
 *    call navigator.vibrate synchronously with EXACTLY the documented patterns.
 *  - At 'off': zero vibrate calls (no throw).
 *  - navigator present but vibrate missing / navigator undefined: no throw,
 *    no calls.
 *  - Source-level: the single navigator.vibrate( call site is guarded by
 *    `typeof navigator`.
 *
 * Exit codes: 0 = pass, 1 = fail, 3 = implementation not landed yet.
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/haptics.test.js
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const CONFIG = path.join(ROOT, 'js', 'effects-config.js');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');

function needLanded() {
  for (const [p, what] of [[BUS, 'js/event-bus.js'], [CONFIG, 'js/effects-config.js'], [BRIDGE, 'js/effects-bridge.js']]) {
    if (!fs.existsSync(p)) {
      console.error(`NOT-LANDED: ${what} not present — cannot test haptics yet. (${p})`);
      process.exit(3);
    }
  }
}

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  }
}

// ------------------------------------------------------------------ stubs ---

function makeEngine() {
  const calls = { playCannonCapture: [], playCapture: [] };
  return {
    calls,
    playCannonCapture(...args) { calls.playCannonCapture.push(args); const d = args[4]; if (typeof d === 'function') d(); },
    playCapture(...args) { calls.playCapture.push(args); const d = args[5]; if (typeof d === 'function') d(); },
  };
}

function makeAudio() {
  return { play() {}, startHeartbeat() {}, stopHeartbeat() {}, setHeartbeatIntensity() {} };
}

function recordingVfx(names) {
  const o = { calls: [] };
  for (const n of names) o[n] = (...a) => { o.calls.push([n, ...a]); };
  return o;
}

const CHECK_VFX_METHODS = [
  'trembleGeneral', 'sweatDrops', 'palaceGlow', 'cannonLaserAim', 'chariotLane',
  'horseGhostTrail', 'soldierAim', 'flyingGeneralDuel', 'setDoubleCheck', 'clearAll',
];
const MATE_VFX_METHODS = [
  'freezeFlash', 'pushIn', 'dimBoard', 'restoreBoard', 'cannonPalaceExplosion',
  'cannonFireworks', 'chariotGateSmash', 'chariotCavalrySweep', 'horseMoonLeap',
  'horseLightningStrike', 'soldierSpotlight', 'soldierBow', 'flyingDuelSlash',
  'crownFall', 'flagLower', 'palaceCrumble', 'paintJueSha', 'celebrate', 'clearAll',
];

// navigator variants: (a) with vibrate, (b) without vibrate, (c) undefined.
function loadWorld(navigatorStub) {
  const stubs = harness.makeStubs();
  stubs.window.matchMedia = () => ({ matches: false });
  harness.loadScript(stubs, BUS);
  harness.loadScript(stubs, CONFIG);
  stubs.window.aaaEngine = makeEngine();
  stubs.window.audioManager = makeAudio();
  stubs.window.CheckVFX = recordingVfx(CHECK_VFX_METHODS);
  stubs.window.CheckmateVFX = recordingVfx(MATE_VFX_METHODS);
  stubs.window.SlowMo = {
    isActive: () => false, begin() {}, end() {}, reset() {},
    playVictoryFanfare() {}, playMateReplay() {},
  };
  stubs.window.app = { triggerCheckBanner() {}, showGameOverModal() {} };
  const vibrateCalls = [];
  const opts = {};
  if (navigatorStub !== undefined) {
    opts.navigator = navigatorStub(vibrateCalls);
  }
  harness.loadScript(stubs, BRIDGE, opts);
  const manager = stubs.window.effectsManager;
  assert.ok(manager, 'real EffectsManager loaded');
  // Never run deferred timers: haptics must fire on dispatch, not on phases.
  const queue = [];
  manager._later = (ms, fn) => { queue.push({ ms, fn }); return 0; };
  manager._clearMateTimers = () => { queue.length = 0; };
  return { stubs, manager, vibrateCalls, queue };
}

const withVibrate = (calls) => ({
  vibrate: (pattern) => { calls.push(pattern); return true; },
});
const withoutVibrate = () => ({});

function captureEvent() {
  return { attacker: 'C', from: { r: 5, c: 4 }, to: { r: 2, c: 4 }, targetEl: null, movingPieceEl: null, commit() {} };
}
function checkEvent() {
  return {
    move: { from: { r: 5, c: 4 }, to: { r: 2, c: 4 }, piece: 'C' },
    pieceKey: 'C',
    checkingPieces: [{ r: 2, c: 4, piece: 'C' }],
    checkingPos: { r: 2, c: 4 },
    generalCell: { r: 0, c: 4 },
    from: { r: 5, c: 4 }, to: { r: 2, c: 4 },
    side: 'black',
  };
}
function checkmateEvent() {
  return {
    move: { piece: 'C', from: { r: 0, c: 0 }, to: { r: 0, c: 1 }, captured: null },
    pieceKey: 'C',
    winningPiece: 'C',
    losingGeneralCell: { r: 9, c: 4 },
    winnerSide: 'red',
    reason: 'checkmate',
  };
}

function drive(queue) {
  while (queue.length) {
    queue.sort((a, b) => a.ms - b.ms);
    queue.shift().fn();
  }
}

function fireAll(w) {
  const bus = w.stubs.window.GameBus;
  bus.emit('capture', captureEvent()); drive(w.queue);
  bus.emit('check', checkEvent()); drive(w.queue);
  bus.emit('checkmate', checkmateEvent()); drive(w.queue);
}

// ------------------------------------------------------------------ tests ---

needLanded();

(async () => {
  await test('source: navigator.vibrate call sites are guarded', () => {
    const src = fs.readFileSync(BRIDGE, 'utf8');
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const calls = [...stripped.matchAll(/navigator\.vibrate\s*\(/g)];
    assert.ok(calls.length > 0, 'effects-bridge.js must call navigator.vibrate (W3 haptics)');
    // Every call site must sit inside a function body that guards typeof navigator.
    const fnRe = /(?:function\s+[A-Za-z_$][\w$]*|_?[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
    let m;
    const fns = [];
    while ((m = fnRe.exec(stripped)) !== null) {
      const j = stripped.indexOf('{', m.index);
      let depth = 0, k = j;
      for (; k < stripped.length; k++) {
        if (stripped[k] === '{') depth++;
        else if (stripped[k] === '}') { depth--; if (depth === 0) break; }
      }
      fns.push({ start: m.index, end: k, body: stripped.slice(j, k + 1) });
    }
    for (const c of calls) {
      const holder = fns.find((f) => c.index > f.start && c.index < f.end);
      assert.ok(holder, `navigator.vibrate( at offset ${c.index} is not inside a function`);
      assert.ok(
        /typeof\s+navigator/.test(holder.body),
        `navigator.vibrate( at offset ${c.index} is not guarded by typeof navigator`
      );
    }
    console.log(`    ${calls.length} vibrate call site(s), all guarded`);
  });

  await test('source: haptic call sites sit after the intensity-off early returns', () => {
    const src = fs.readFileSync(BRIDGE, 'utf8');
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const sites = [...stripped.matchAll(/this\._haptic\(([^)]*)\)/g)];
    assert.strictEqual(sites.length, 3, `expected 3 _haptic call sites, got ${sites.length}`);
    const patterns = sites.map((s) => s[1].trim());
    assert.deepStrictEqual(
      patterns,
      ['40', '[30, 60, 30]', '[60, 80, 60, 80, 120]'],
      `pinned patterns mismatch: ${JSON.stringify(patterns)}`
    );
    // Each site must be preceded (in its handler) by an off early-return.
    for (const s of sites) {
      const before = stripped.slice(Math.max(0, s.index - 900), s.index);
      assert.ok(
        /this\.intensity\s*===\s*['"]off['"]/.test(before),
        `_haptic(${s[1].trim()}) must follow an intensity-'off' early return`
      );
    }
    console.log(`    pinned patterns: ${patterns.join(' | ')}`);
  });

  for (const intensity of ['low', 'full']) {
    await test(`patterns fire exactly at '${intensity}' intensity (capture/check/checkmate)`, () => {
      const w = loadWorld(withVibrate);
      w.manager.setIntensity(intensity);
      assert.doesNotThrow(() => fireAll(w), `handlers must not throw at '${intensity}'`);
      assert.deepStrictEqual(
        w.vibrateCalls,
        [40, [30, 60, 30], [60, 80, 60, 80, 120]],
        `vibrate calls at '${intensity}' must be exactly the pinned patterns — got ${JSON.stringify(w.vibrateCalls)}`
      );
      console.log(`    patterns: ${JSON.stringify(w.vibrateCalls)}`);
    });
  }

  await test("haptics are SILENT at 'off' intensity", () => {
    const w = loadWorld(withVibrate);
    w.manager.setIntensity('off');
    assert.doesNotThrow(() => fireAll(w), "handlers must not throw at 'off'");
    assert.strictEqual(
      w.vibrateCalls.length, 0,
      `zero vibrate calls at 'off' — got ${JSON.stringify(w.vibrateCalls)}`
    );
  });

  await test('never throws when navigator.vibrate is missing', () => {
    const w = loadWorld(withoutVibrate);
    w.manager.setIntensity('full');
    assert.doesNotThrow(() => fireAll(w), 'handlers must not throw when navigator.vibrate is missing');
    assert.strictEqual(w.vibrateCalls.length, 0, 'no vibrate calls possible without the API');
  });

  await test('never throws when navigator is undefined', () => {
    const w = loadWorld(undefined); // navigator stays undefined in the sandbox
    w.manager.setIntensity('full');
    assert.doesNotThrow(() => fireAll(w), 'handlers must not throw when navigator is undefined');
  });

  console.log(`\nhaptics tests: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ' — ALL PASSED'}`);
})().catch((err) => {
  console.error('haptics tests FAILED:');
  console.error(err);
  process.exit(1);
});
