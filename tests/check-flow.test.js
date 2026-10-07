'use strict';
/**
 * tests/check-flow.test.js — QA (W4-final) event-flow smoke tests for Phase 3
 * check cinematics, one per checking piece: C, R, H, P, flyingGeneral.
 *
 * Drives a bus 'check' event through the REAL chain
 *   GameBus -> EffectsManager -> EFFECTS_CONFIG -> window.CheckVFX
 * at Full intensity and asserts the CheckVFX visual calls fire in the exact
 * config phase order, with the phased sfx keys reaching audioManager.play
 * in the same order.
 *
 * Expected phase orders (from js/effects-config.js):
 *   C: trembleGeneral, cannonLaserAim, sweatDrops, palaceGlow, cannonLaserAim
 *      audio: fuse_hiss, smoke_hiss, ball_whistle
 *   R: trembleGeneral, chariotLane, sweatDrops, palaceGlow, chariotLane
 *      audio: katana_unsheathe, smoke_hiss, fuse_hiss
 *   H: trembleGeneral, horseGhostTrail, sweatDrops, palaceGlow, horseGhostTrail
 *      audio: smoke_hiss
 *   P: trembleGeneral, soldierAim, sweatDrops, palaceGlow, soldierAim
 *      audio: smoke_hiss
 *   flyingGeneral: trembleGeneral, palaceGlow, flyingGeneralDuel, sweatDrops, clearAll
 *      audio: flying_general_check
 *
 * KNOWN DEVIATION (QA FINDING-02): the flyingGeneral config's final phase
 * { t: 1450, visual: 'clearAll' } (effects-config.js:373) is never dispatched:
 * EffectsManager._runCheckVisual has no 'clearAll' case, so it falls through
 * to the default console.warn('unknown check visual') at
 * effects-bridge.js:602. The flyingGeneral phase-order assertion below
 * therefore FAILS on the missing clearAll until the manager routes it (or the
 * config drops the phase).
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/check-flow.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const CONFIG = path.join(ROOT, 'js', 'effects-config.js');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const stubs = harness.makeStubs();
  harness.loadScript(stubs, BUS);
  harness.loadScript(stubs, CONFIG);

  const vfxCalls = [];
  const CheckVFX = {};
  for (const m of [
    'trembleGeneral', 'sweatDrops', 'palaceGlow', 'cannonLaserAim',
    'chariotLane', 'horseGhostTrail', 'soldierAim', 'flyingGeneralDuel',
    'setDoubleCheck', 'clearAll',
  ]) {
    CheckVFX[m] = (...args) => vfxCalls.push({ method: m, args });
  }
  stubs.window.CheckVFX = CheckVFX;

  const audioCalls = [];
  stubs.window.audioManager = {
    play(name) { audioCalls.push(name); },
    startHeartbeat() {},
    stopHeartbeat() {},
    setHeartbeatIntensity() {},
  };

  const bannerCalls = [];
  stubs.window.app = { triggerCheckBanner(t) { bannerCalls.push(t); } };

  harness.loadScript(stubs, BRIDGE);
  const manager = stubs.window.effectsManager;
  assert.ok(manager, 'real EffectsManager loaded');
  manager.setIntensity('full');
  return { manager, vfxCalls, audioCalls, bannerCalls, GameBus: stubs.window.GameBus };
}

// A checking piece giving check to the black general at (0,4).
function checkEvent(pieceKey) {
  const checkerPiece = pieceKey === 'flyingGeneral' ? 'K' : pieceKey;
  return {
    move: {
      from: { r: 5, c: 4 },
      to: { r: 2, c: 4 },
      piece: checkerPiece,
    },
    pieceKey,
    checkingPieces: [{ r: 2, c: 4, piece: checkerPiece }],
    checkingPos: { r: 2, c: 4 },
    generalCell: { r: 0, c: 4 },
    from: { r: 5, c: 4 },
    to: { r: 2, c: 4 },
    side: 'black',
  };
}

const CASES = [
  {
    pieceKey: 'C',
    visuals: ['trembleGeneral', 'cannonLaserAim', 'sweatDrops', 'palaceGlow', 'cannonLaserAim'],
    audio: ['fuse_hiss', 'smoke_hiss', 'ball_whistle'],
    banner: 'C',
  },
  {
    pieceKey: 'R',
    visuals: ['trembleGeneral', 'chariotLane', 'sweatDrops', 'palaceGlow', 'chariotLane'],
    audio: ['katana_unsheathe', 'smoke_hiss', 'fuse_hiss'],
    banner: 'R',
  },
  {
    pieceKey: 'H',
    visuals: ['trembleGeneral', 'horseGhostTrail', 'sweatDrops', 'palaceGlow', 'horseGhostTrail'],
    audio: ['smoke_hiss'],
    banner: 'H',
  },
  {
    pieceKey: 'P',
    visuals: ['trembleGeneral', 'soldierAim', 'sweatDrops', 'palaceGlow', 'soldierAim'],
    audio: ['smoke_hiss'],
    banner: 'P',
  },
  {
    pieceKey: 'flyingGeneral',
    visuals: ['trembleGeneral', 'palaceGlow', 'flyingGeneralDuel', 'sweatDrops', 'clearAll'],
    audio: ['flying_general_check'],
    banner: 'K', // a general giving check banners as 'K'
  },
];

(async () => {
  for (const c of CASES) {
    const s = setup();
    s.GameBus.emit('check', checkEvent(c.pieceKey));
    await sleep(1900); // longest phase t=1450 (flyingGeneral) + settle buffer

    // Banner: manager maps the pieceKey to the app's banner type.
    assert.deepStrictEqual(
      s.bannerCalls, [c.banner],
      `${c.pieceKey}: triggerCheckBanner('${c.banner}') exactly once`
    );

    // Preamble: a fresh check clears stale visuals, then resets double-check.
    assert.strictEqual(s.vfxCalls[0].method, 'clearAll', `${c.pieceKey}: preamble clearAll first`);
    assert.deepStrictEqual(
      [s.vfxCalls[1].method, s.vfxCalls[1].args[0]],
      ['setDoubleCheck', false],
      `${c.pieceKey}: preamble setDoubleCheck(false)`
    );

    // The config-driven phase sequence, in order (after the 2-call preamble).
    const seq = s.vfxCalls.slice(2).map((v) => v.method);
    assert.deepStrictEqual(
      seq, c.visuals,
      `${c.pieceKey}: CheckVFX visuals must fire in config phase order`
    );

    // Phased audio keys reach audioManager.play in the same order.
    assert.deepStrictEqual(
      s.audioCalls, c.audio,
      `${c.pieceKey}: phased sfx keys must reach audioManager.play in order`
    );

    console.log(`ok - ${c.pieceKey}: banner + ${seq.length} visuals in phase order + ${c.audio.length} sfx`);
  }

  console.log('\ncheck event-flow smoke tests: ALL PASSED');
})().catch((err) => {
  console.error('check event-flow smoke tests FAILED:');
  console.error(err);
  process.exit(1);
});
