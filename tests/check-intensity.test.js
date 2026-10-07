'use strict';
/**
 * tests/check-intensity.test.js — QA (W4-final) intensity-gating tests for
 * Phase 3 check cinematics (js/effects-bridge.js `_onCheck`).
 *
 * Contract under test:
 *   Off  = zero check presentation (no banner, no sound, no visuals).
 *   Low  = banner (app.triggerCheckBanner) + sound (heartbeat) only —
 *          NO CheckVFX sequence and NO CheckVFX visual escalation.
 *   Full = banner + heartbeat + the config-driven CheckVFX sequence.
 *
 * Loads the REAL js/event-bus.js + js/effects-config.js +
 * js/effects-bridge.js with stubbed CheckVFX / audioManager / app, then
 * drives 'check' events through the real bus.
 *
 * KNOWN DEVIATION (QA FINDING-01): at Low intensity with 2+ checkingPieces
 * the manager calls CheckVFX.setDoubleCheck(true) (effects-bridge.js:468)
 * before the Low early-return (:485), although the contract — and the
 * manager's own doc comment — says Low = banner + sound only. The
 * 'Low + double check => no CheckVFX visual escalation' assertion below
 * pins this; it FAILS until the manager gates the escalation on Full.
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/check-intensity.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const CONFIG = path.join(ROOT, 'js', 'effects-config.js');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');

// The 8 "scene" CheckVFX visuals (presentation; clearAll/setDoubleCheck are
// ambience hygiene handled separately).
const SCENE_VISUALS = new Set([
  'trembleGeneral', 'sweatDrops', 'palaceGlow', 'cannonLaserAim',
  'chariotLane', 'horseGhostTrail', 'soldierAim', 'flyingGeneralDuel',
]);

function setup() {
  const stubs = harness.makeStubs();
  harness.loadScript(stubs, BUS);
  assert.ok(stubs.window.GameBus, 'real GameBus loaded');
  harness.loadScript(stubs, CONFIG);
  assert.ok(stubs.window.EFFECTS_CONFIG, 'real EFFECTS_CONFIG loaded');

  const vfxCalls = [];
  const CheckVFX = {};
  for (const m of [...SCENE_VISUALS, 'setDoubleCheck', 'clearAll']) {
    CheckVFX[m] = (...args) => vfxCalls.push({ method: m, args });
  }
  stubs.window.CheckVFX = CheckVFX;

  const audioCalls = [];
  stubs.window.audioManager = {
    play(name) { audioCalls.push({ method: 'play', name }); },
    startHeartbeat() { audioCalls.push({ method: 'startHeartbeat' }); },
    stopHeartbeat() { audioCalls.push({ method: 'stopHeartbeat' }); },
    setHeartbeatIntensity(lvl) { audioCalls.push({ method: 'setHeartbeatIntensity', lvl }); },
  };

  const bannerCalls = [];
  stubs.window.app = {
    triggerCheckBanner(type) { bannerCalls.push(type); },
  };

  harness.loadScript(stubs, BRIDGE); // no document -> guard path exercised
  const manager = stubs.window.effectsManager;
  assert.ok(manager, 'real EffectsManager loaded');
  return { manager, vfxCalls, audioCalls, bannerCalls, GameBus: stubs.window.GameBus };
}

function checkEvent(pieceKey, nCheckers) {
  const checkers = [];
  for (let i = 0; i < nCheckers; i++) {
    checkers.push({ r: 2 + i, c: 4, piece: pieceKey === 'flyingGeneral' ? 'K' : pieceKey });
  }
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

const sceneCalls = (vfxCalls) => vfxCalls.filter((c) => SCENE_VISUALS.has(c.method));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // --- Off: zero check presentation ---------------------------------------
  {
    const s = setup();
    s.manager.setIntensity('off');
    s.GameBus.emit('check', checkEvent('C', 1));
    await sleep(50);
    assert.strictEqual(s.bannerCalls.length, 0, 'Off: triggerCheckBanner must not fire');
    assert.ok(
      !s.audioCalls.some((c) => c.method === 'startHeartbeat'),
      'Off: heartbeat must not start'
    );
    assert.ok(
      !s.audioCalls.some((c) => c.method === 'play'),
      'Off: no sfx may play'
    );
    assert.strictEqual(
      sceneCalls(s.vfxCalls).length, 0,
      `Off: no CheckVFX scene visuals (got ${JSON.stringify(sceneCalls(s.vfxCalls))})`
    );
    console.log('ok - Off: zero check presentation (no banner, no sound, no visuals)');
  }

  // --- Low, single check: banner + sound only --------------------------------
  {
    const s = setup();
    s.manager.setIntensity('low');
    s.GameBus.emit('check', checkEvent('R', 1));
    await sleep(50);
    assert.strictEqual(s.bannerCalls.length, 1, 'Low: banner fires exactly once');
    assert.strictEqual(s.bannerCalls[0], 'R', 'Low: banner type follows the checking piece');
    assert.ok(
      s.audioCalls.some((c) => c.method === 'startHeartbeat'),
      'Low: heartbeat starts (sound)'
    );
    assert.strictEqual(
      sceneCalls(s.vfxCalls).length, 0,
      `Low: no CheckVFX scene visuals (got ${JSON.stringify(sceneCalls(s.vfxCalls))})`
    );
    assert.ok(
      !s.audioCalls.some((c) => c.method === 'play'),
      'Low: no config-sequence sfx'
    );
    console.log('ok - Low (single check): banner + heartbeat only, no CheckVFX sequence');
  }

  // --- Low, DOUBLE check: still banner + sound only (FINDING-01) -------------
  {
    const s = setup();
    s.manager.setIntensity('low');
    s.GameBus.emit('check', checkEvent('C', 2));
    await sleep(50);
    assert.strictEqual(s.bannerCalls.length, 1, 'Low double: banner fires exactly once');
    assert.ok(
      s.audioCalls.some((c) => c.method === 'startHeartbeat'),
      'Low double: heartbeat starts (sound)'
    );
    assert.ok(
      s.audioCalls.some((c) => c.method === 'setHeartbeatIntensity' && c.lvl === 'high'),
      'Low double: heartbeat escalates to high (audio-side escalation is sound-only)'
    );
    assert.strictEqual(
      sceneCalls(s.vfxCalls).length, 0,
      'Low double: no CheckVFX scene visuals'
    );
    // FINDING-01: the manager must not escalate CheckVFX visuals at Low.
    assert.ok(
      !s.vfxCalls.some((c) => c.method === 'setDoubleCheck' && c.args[0] === true),
      'FINDING-01: Low intensity must not call CheckVFX.setDoubleCheck(true) — ' +
      'contract is banner + sound only (effects-bridge.js:468 fires before the Low return at :485)'
    );
    console.log('ok - Low (double check): banner + high heartbeat, no CheckVFX visual escalation');
  }

  // --- Full: banner + heartbeat + config-driven CheckVFX sequence ------------
  {
    const s = setup();
    s.manager.setIntensity('full');
    s.GameBus.emit('check', checkEvent('H', 1));
    await sleep(250); // t=0 (tremble) + t=250 (ghost trail) phases land
    assert.strictEqual(s.bannerCalls.length, 1, 'Full: banner fires exactly once');
    assert.ok(
      s.audioCalls.some((c) => c.method === 'startHeartbeat'),
      'Full: heartbeat starts'
    );
    const methods = sceneCalls(s.vfxCalls).map((c) => c.method);
    assert.ok(
      methods.includes('trembleGeneral') && methods.includes('horseGhostTrail'),
      `Full: config-driven CheckVFX sequence runs (got ${JSON.stringify(methods)})`
    );
    console.log('ok - Full: banner + heartbeat + config-driven CheckVFX sequence');
  }

  console.log('\ncheck-intensity gating tests: ALL PASSED');
})().catch((err) => {
  console.error('check-intensity gating tests FAILED:');
  console.error(err);
  process.exit(1);
});
