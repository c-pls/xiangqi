'use strict';
/**
 * tests/check-announcer.test.js — QA (W4-final) announcer non-interference
 * tests for Phase 3 check cinematics.
 *
 * Contract under test: 'check' events must never trigger the Phase 2
 * announcer. EffectsManager._onCheck makes no Announcer calls; the announcer
 * stays capture-scoped (announceForCapture on 'capture' only).
 *
 * Loads the REAL js/event-bus.js + js/announcer.js + js/effects-config.js +
 * js/effects-bridge.js with stubbed CheckVFX / audioManager / app. The real
 * Announcer.announceForCapture is wrapped in a spy so the test proves both
 * directions:
 *   1. a 'check' event (any intensity, single or double) never calls it and
 *      creates no announcement popups, and
 *   2. (control) a 'capture' event still calls it exactly once — the spy is
 *      live and the announcer path is intact.
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/check-announcer.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const ANNOUNCER = path.join(ROOT, 'js', 'announcer.js');
const CONFIG = path.join(ROOT, 'js', 'effects-config.js');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const stubs = harness.makeStubs();
  harness.loadScript(stubs, BUS);
  harness.loadScript(stubs, ANNOUNCER);
  assert.ok(stubs.window.Announcer, 'real Announcer loaded');
  harness.loadScript(stubs, CONFIG);

  // Spy that calls through to the real announcer.
  const announceCalls = [];
  const real = stubs.window.Announcer.announceForCapture;
  assert.strictEqual(typeof real, 'function', 'Announcer.announceForCapture exists');
  stubs.window.Announcer.announceForCapture = function (args) {
    announceCalls.push(args);
    return real.call(stubs.window.Announcer, args);
  };

  stubs.window.CheckVFX = new Proxy({}, {
    get: (t, m) => (...args) => {},
  });
  stubs.window.audioManager = {
    play() {}, startHeartbeat() {}, stopHeartbeat() {}, setHeartbeatIntensity() {},
  };
  stubs.window.app = { triggerCheckBanner() {} };

  harness.loadScript(stubs, BRIDGE);
  const manager = stubs.window.effectsManager;
  assert.ok(manager, 'real EffectsManager loaded');
  return { manager, announceCalls, GameBus: stubs.window.GameBus };
}

function checkEvent(pieceKey, nCheckers) {
  const checkers = [];
  for (let i = 0; i < nCheckers; i++) checkers.push({ r: 2 + i, c: 4, piece: pieceKey });
  return {
    move: { from: { r: 5, c: 4 }, to: { r: 2, c: 4 }, piece: pieceKey },
    pieceKey,
    checkingPieces: checkers,
    checkingPos: { r: 2, c: 4 },
    generalCell: { r: 0, c: 4 },
    from: { r: 5, c: 4 },
    to: { r: 2, c: 4 },
    side: 'black',
  };
}

(async () => {
  // --- 1. 'check' never touches the announcer (all intensities) --------------
  for (const intensity of ['full', 'low', 'off']) {
    const s = setup();
    s.manager.setIntensity(intensity);
    s.GameBus.emit('check', checkEvent('C', 1)); // single
    s.GameBus.emit('check', checkEvent('R', 2)); // double
    s.GameBus.emit('check', checkEvent('flyingGeneral', 1));
    await sleep(100);
    assert.strictEqual(
      s.announceCalls.length, 0,
      `intensity '${intensity}': check events must never call Announcer.announceForCapture`
    );
    assert.strictEqual(
      s.manager._popups.length, 0,
      `intensity '${intensity}': check events must create no announcement popups`
    );
    console.log(`ok - intensity '${intensity}': 3 check events, zero announcer calls, zero popups`);
  }

  // --- 2. control: 'capture' still announces (spy is live) --------------------
  {
    const s = setup();
    s.manager.setIntensity('full');
    let commits = 0;
    s.GameBus.emit('capture', {
      attacker: 'C',
      victim: 'p',
      side: 'red',
      from: { r: 1, c: 1 },
      to: { r: 2, c: 1 },
      commit: () => { commits++; },
    });
    await sleep(200);
    assert.strictEqual(
      s.announceCalls.length, 1,
      'control: capture must still call Announcer.announceForCapture exactly once'
    );
    assert.strictEqual(s.announceCalls[0].piece, 'C', 'control: announcement carries the attacker');
    console.log('ok - control: capture still announces (announcer path intact, spy live)');
  }

  console.log('\ncheck-announcer non-interference tests: ALL PASSED');
})().catch((err) => {
  console.error('check-announcer non-interference tests FAILED:');
  console.error(err);
  process.exit(1);
});
