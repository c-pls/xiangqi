'use strict';
/**
 * tests/check-double.test.js — QA (W4-final) double-check stacking tests for
 * Phase 3 (js/effects-bridge.js `_onCheck`).
 *
 * Contract under test:
 *   - 2+ checkingPieces  -> CheckVFX.setDoubleCheck(true) + heartbeat 'high'.
 *   - 1 checkingPiece    -> CheckVFX.setDoubleCheck(false) + heartbeat 'normal'.
 *   - checkingPieces wins over the legacy numeric checkCount hint.
 *
 * Loads the REAL js/event-bus.js + js/effects-config.js +
 * js/effects-bridge.js with stubbed CheckVFX / audioManager / app, then
 * drives 'check' events through the real bus at Full intensity.
 *
 * KNOWN DEVIATION (QA FINDING-03): the single-check path never calls
 * audioManager.setHeartbeatIntensity('normal') — 'high' is set at
 * effects-bridge.js:471-472 but nothing ever resets it, and
 * audio-manager.js stopHeartbeat() does not reset hbLevel either. After any
 * double-check, every later check heartbeat latches at 'high'. The
 * 'single check => heartbeat normal' assertion below pins this; it FAILS
 * until the manager resets the level on single checks.
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/check-double.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const CONFIG = path.join(ROOT, 'js', 'effects-config.js');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');

function setup() {
  const stubs = harness.makeStubs();
  harness.loadScript(stubs, BUS);
  harness.loadScript(stubs, CONFIG);

  const vfxCalls = [];
  stubs.window.CheckVFX = {
    setDoubleCheck(on) { vfxCalls.push({ method: 'setDoubleCheck', on }); },
    clearAll() { vfxCalls.push({ method: 'clearAll' }); },
  };

  const audioCalls = [];
  stubs.window.audioManager = {
    play() {},
    startHeartbeat() { audioCalls.push({ method: 'startHeartbeat' }); },
    stopHeartbeat() { audioCalls.push({ method: 'stopHeartbeat' }); },
    setHeartbeatIntensity(lvl) { audioCalls.push({ method: 'setHeartbeatIntensity', lvl }); },
  };

  stubs.window.app = { triggerCheckBanner() {} };

  harness.loadScript(stubs, BRIDGE);
  const manager = stubs.window.effectsManager;
  assert.ok(manager, 'real EffectsManager loaded');
  manager.setIntensity('full');
  return { manager, vfxCalls, audioCalls, GameBus: stubs.window.GameBus };
}

function checkEvent(pieceKey, opts) {
  opts = opts || {};
  const n = opts.nCheckers == null ? 1 : opts.nCheckers;
  const checkers = [];
  for (let i = 0; i < n; i++) checkers.push({ r: 2 + i, c: 4, piece: pieceKey });
  const ev = {
    move: { from: { r: 5, c: 4 }, to: { r: 2, c: 4 }, piece: pieceKey },
    pieceKey,
    checkingPos: { r: 2, c: 4 },
    generalCell: { r: 0, c: 4 },
    from: { r: 5, c: 4 },
    to: { r: 2, c: 4 },
    side: 'black',
  };
  if (!opts.omitCheckingPieces) ev.checkingPieces = checkers;
  if (opts.checkCount != null) ev.checkCount = opts.checkCount;
  return ev;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // --- double check: 2 checkingPieces -> setDoubleCheck(true) + high --------
  {
    const s = setup();
    s.GameBus.emit('check', checkEvent('R', { nCheckers: 2 }));
    await sleep(50);
    assert.ok(
      s.vfxCalls.some((c) => c.method === 'setDoubleCheck' && c.on === true),
      'double check must call CheckVFX.setDoubleCheck(true)'
    );
    assert.ok(
      s.audioCalls.some((c) => c.method === 'setHeartbeatIntensity' && c.lvl === 'high'),
      "double check must call audioManager.setHeartbeatIntensity('high')"
    );
    console.log('ok - 2+ checkingPieces -> setDoubleCheck(true) + heartbeat high');
  }

  // --- 3 checkingPieces also stacks ------------------------------------------
  {
    const s = setup();
    s.GameBus.emit('check', checkEvent('C', { nCheckers: 3 }));
    await sleep(50);
    assert.ok(
      s.vfxCalls.some((c) => c.method === 'setDoubleCheck' && c.on === true),
      '3 checkingPieces must call CheckVFX.setDoubleCheck(true)'
    );
    console.log('ok - 3 checkingPieces -> setDoubleCheck(true)');
  }

  // --- legacy checkCount hint works when checkingPieces is absent -------------
  {
    const s = setup();
    s.GameBus.emit('check', checkEvent('H', { omitCheckingPieces: true, checkCount: 2 }));
    await sleep(50);
    assert.ok(
      s.vfxCalls.some((c) => c.method === 'setDoubleCheck' && c.on === true),
      'checkCount: 2 (no checkingPieces) must call CheckVFX.setDoubleCheck(true)'
    );
    console.log('ok - checkCount:2 fallback -> setDoubleCheck(true)');
  }

  // --- checkingPieces wins over checkCount ------------------------------------
  {
    const s = setup();
    s.GameBus.emit('check', checkEvent('P', { nCheckers: 1, checkCount: 4 }));
    await sleep(50);
    assert.ok(
      s.vfxCalls.some((c) => c.method === 'setDoubleCheck' && c.on === false),
      'checkingPieces (1) must win over checkCount (4): setDoubleCheck(false)'
    );
    assert.ok(
      !s.vfxCalls.some((c) => c.method === 'setDoubleCheck' && c.on === true),
      'checkingPieces (1) must win over checkCount (4): never setDoubleCheck(true)'
    );
    console.log('ok - checkingPieces (1) takes precedence over checkCount (4)');
  }

  // --- single check: setDoubleCheck(false) + heartbeat back to normal ---------
  {
    const s = setup();
    s.GameBus.emit('check', checkEvent('C', { nCheckers: 1 }));
    await sleep(50);
    assert.ok(
      s.vfxCalls.some((c) => c.method === 'setDoubleCheck' && c.on === false),
      'single check must call CheckVFX.setDoubleCheck(false)'
    );
    // FINDING-03: the manager never resets the heartbeat level to 'normal'.
    assert.ok(
      s.audioCalls.some((c) => c.method === 'setHeartbeatIntensity' && c.lvl === 'normal'),
      'FINDING-03: single check must call ' +
      "audioManager.setHeartbeatIntensity('normal') — without it the 'high' level " +
      'latches after any double-check (set at effects-bridge.js:471-472, never reset; ' +
      'audio-manager.js stopHeartbeat() does not reset hbLevel either)'
    );
    console.log('ok - single check -> setDoubleCheck(false) + heartbeat normal');
  }

  console.log('\ncheck-double stacking tests: ALL PASSED');
})().catch((err) => {
  console.error('check-double stacking tests FAILED:');
  console.error(err);
  process.exit(1);
});
