'use strict';
/**
 * tests/capture-path.test.js — QA (W4, Phase B) per-capture event-flow tests.
 *
 * Loads the REAL js/event-bus.js + REAL js/effects-config.js + REAL
 * js/announcer.js + REAL js/effects-bridge.js with stubbed window.aaaEngine
 * (records the 7 cinematic play*Capture calls + legacy playCapture) and
 * window.audioManager (records play calls). Drives 'capture' through the
 * REAL GameBus for EACH piece key R/H/E/A/P/K (+C regression) and asserts
 * the bus -> manager -> config path:
 *   - config phase audio scheduled through audioManager.play, in order
 *   - the piece's ENGINE_METHODS cinematic method invoked with
 *     { muteInternalAudio: true } as the trailing arg
 *   - legacy playCapture NOT called for full configs
 *   - commit invoked EXACTLY ONCE per capture
 * Plus: intensity 'off' commits instantly with zero engine/audio calls;
 * 'low' skips visuals silently; legacy playCapture fallback is reachable
 * (empty-phases config, and unknown piece key).
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/capture-path.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const CONFIG = path.join(ROOT, 'js', 'effects-config.js');
const ANNOUNCER = path.join(ROOT, 'js', 'announcer.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CINEMATIC = {
  C: 'playCannonCapture',
  R: 'playChariotCapture',
  H: 'playHorseCapture',
  E: 'playElephantCapture',
  A: 'playAdvisorCapture',
  P: 'playSoldierCapture',
  K: 'playGeneralCapture',
};
const PIECES = ['R', 'H', 'E', 'A', 'P', 'K', 'C'];

let passed = 0;
async function test(name, fn) {
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

function makeEngine() {
  const calls = {};
  for (const m of Object.values(CINEMATIC)) calls[m] = [];
  calls.playCapture = [];
  const engine = { calls };
  // Cinematic: (from, to, targetEl, movingPieceEl, done, {muteInternalAudio:true})
  for (const m of Object.values(CINEMATIC)) {
    engine[m] = (...args) => {
      calls[m].push(args);
      const done = args[4];
      if (typeof done === 'function') done(); // auto-commit
    };
  }
  // Legacy: (attacker, from, to, targetEl, movingPieceEl, done)
  engine.playCapture = (...args) => {
    calls.playCapture.push(args);
    const done = args[5];
    if (typeof done === 'function') done();
  };
  return engine;
}

/** Fresh sandbox with the REAL config + announcer + bridge. No document. */
function loadReal() {
  const stubs = harness.makeStubs();
  harness.loadScript(stubs, BUS);
  harness.loadScript(stubs, CONFIG);
  harness.loadScript(stubs, ANNOUNCER);
  const engine = makeEngine();
  const audio = { plays: [], play(name) { this.plays.push(name); } };
  stubs.window.aaaEngine = engine;
  stubs.window.audioManager = audio;
  harness.loadScript(stubs, BRIDGE); // no document -> popup rendering no-ops
  assert.ok(stubs.window.effectsManager, 'window.effectsManager assigned');
  return { stubs, engine, audio, manager: stubs.window.effectsManager };
}

/** Fresh sandbox with a synthetic compressed config (fast legacy-fallback checks). */
function loadSynthetic(piecesCfg) {
  const stubs = harness.makeStubs();
  harness.loadScript(stubs, BUS);
  const engine = makeEngine();
  const audio = { plays: [], play(name) { this.plays.push(name); } };
  stubs.window.aaaEngine = engine;
  stubs.window.audioManager = audio;
  stubs.window.EFFECTS_CONFIG = { version: 1, pieces: piecesCfg };
  harness.loadScript(stubs, BRIDGE);
  return { stubs, engine, audio, manager: stubs.window.effectsManager };
}

function emitCapture(stubs, attacker, side) {
  let commits = 0;
  // app.js emits 'move' BEFORE 'capture' for the same move (executeMove).
  stubs.window.GameBus.emit('move', { move: {} });
  stubs.window.GameBus.emit('capture', {
    attacker, victim: 'P', side: side || 'red',
    from: 'a0', to: 'a1', targetEl: null, movingPieceEl: null,
    commit: () => { commits++; },
  });
  return () => commits;
}

/** Expected audio schedule for a piece from the REAL config (audio-bearing phases, in order). */
function expectedAudio(stubs, piece) {
  return stubs.window.EFFECTS_CONFIG.pieces[piece].capture.phases
    .filter((p) => p.audio)
    .map((p) => p.audio);
}

/** Max phase t for a piece in the REAL config (how long to wait for its audio). */
function maxT(stubs, piece) {
  return Math.max(...stubs.window.EFFECTS_CONFIG.pieces[piece].capture.phases.map((p) => p.t));
}

(async () => {
  // 1. Per-piece cinematic routing with the REAL config (R/H/E/A/P/K + C).
  for (const piece of PIECES) {
    await test(`full: ${piece} -> ${CINEMATIC[piece]} muted + config phase audio`, async () => {
      const { stubs, engine, audio, manager } = loadReal();
      manager.setIntensity('full');
      const commits = emitCapture(stubs, piece, 'red');
      // Engine dispatch is synchronous; audio is scheduled per phase t.
      assert.strictEqual(engine.calls[CINEMATIC[piece]].length, 1,
        `${CINEMATIC[piece]} invoked once`);
      const lastArg = engine.calls[CINEMATIC[piece]][0].at(-1);
      assert.ok(lastArg && lastArg.muteInternalAudio === true,
        `${CINEMATIC[piece]} trailing arg is {muteInternalAudio:true}`);
      for (const m of Object.values(CINEMATIC)) {
        if (m !== CINEMATIC[piece]) assert.strictEqual(engine.calls[m].length, 0, `${m} not called`);
      }
      assert.strictEqual(engine.calls.playCapture.length, 0, 'legacy playCapture not called');
      await sleep(maxT(stubs, piece) + 120);
      assert.deepStrictEqual(audio.plays, expectedAudio(stubs, piece),
        `phase audio for ${piece} played in order through audioManager`);
      assert.strictEqual(commits(), 1, 'commit invoked exactly once');
    });
  }

  // 2. Intensity 'off': instant commit, zero engine/audio calls (all pieces).
  await test("off: instant commit, no engine/audio calls (all pieces)", async () => {
    const { stubs, engine, audio, manager } = loadReal();
    manager.setIntensity('off');
    for (const piece of PIECES) {
      const commits = emitCapture(stubs, piece, 'red');
      assert.strictEqual(commits(), 1, `${piece}: commit invoked synchronously exactly once`);
    }
    await sleep(60);
    for (const m of [...Object.values(CINEMATIC), 'playCapture']) {
      assert.strictEqual(engine.calls[m].length, 0, `${m}: no calls at off`);
    }
    assert.strictEqual(audio.plays.length, 0, 'no audio at off');
  });

  // 3. Intensity 'low': silent, no visuals, commit after ~250ms.
  await test('low: silent, no visuals, commit ~250ms', async () => {
    const { stubs, engine, audio, manager } = loadReal();
    manager.setIntensity('low');
    const commits = emitCapture(stubs, 'K', 'black');
    await sleep(100);
    assert.strictEqual(commits(), 0, 'commit must not fire early at low');
    await sleep(300);
    assert.strictEqual(commits(), 1, 'commit invoked exactly once at low');
    for (const m of [...Object.values(CINEMATIC), 'playCapture']) {
      assert.strictEqual(engine.calls[m].length, 0, `${m}: no calls at low`);
    }
    assert.strictEqual(audio.plays.length, 0, 'low path is silent');
  });

  // 4. Legacy fallback: empty-phases config piece -> playCapture.
  await test('legacy fallback: empty-phases piece uses playCapture', async () => {
    const { stubs, engine, audio, manager } = loadSynthetic({
      R: { capture: { durationMs: 30, phases: [] } }, // placeholder shape
      H: { capture: { durationMs: 30, phases: [{ t: 0, visual: 'x', audio: 'horse_run' }] } },
    });
    manager.setIntensity('full');
    const commitsR = emitCapture(stubs, 'R', 'red');
    await sleep(60);
    assert.strictEqual(engine.calls.playCapture.length, 1, 'R fell back to legacy playCapture');
    assert.strictEqual(engine.calls.playChariotCapture.length, 0, 'no cinematic for R');
    assert.strictEqual(commitsR(), 1, 'commit invoked exactly once');
    const commitsH = emitCapture(stubs, 'H', 'red');
    await sleep(60);
    assert.strictEqual(engine.calls.playHorseCapture.length, 1, 'H still takes the cinematic path');
    assert.strictEqual(engine.calls.playCapture.length, 1, 'no extra legacy calls');
    assert.strictEqual(commitsH(), 1, 'commit invoked exactly once');
    assert.deepStrictEqual(audio.plays, ['horse_run'], 'only the cinematic path schedules audio');
  });

  // 5. Legacy fallback: unknown piece key -> playCapture.
  await test('legacy fallback: unknown piece key uses playCapture', async () => {
    const { stubs, engine, manager } = loadSynthetic({
      C: { capture: { durationMs: 30, phases: [{ t: 0, visual: 'x' }] } },
    });
    manager.setIntensity('full');
    const commits = emitCapture(stubs, 'X', 'red');
    await sleep(60);
    assert.strictEqual(engine.calls.playCapture.length, 1, 'unknown key fell back to legacy');
    assert.strictEqual(commits(), 1, 'commit invoked exactly once');
  });

  // 6. Announcer hook does not break routing when Announcer is absent.
  await test('routing works with no Announcer loaded', async () => {
    const stubs = harness.makeStubs();
    harness.loadScript(stubs, BUS);
    harness.loadScript(stubs, CONFIG);
    const engine = makeEngine();
    const audio = { plays: [], play(n) { this.plays.push(n); } };
    stubs.window.aaaEngine = engine;
    stubs.window.audioManager = audio;
    harness.loadScript(stubs, BRIDGE);
    const manager = stubs.window.effectsManager;
    manager.setIntensity('full');
    let commits = 0;
    stubs.window.GameBus.emit('capture', {
      attacker: 'E', victim: 'P', side: 'black', from: 'a0', to: 'a1',
      commit: () => { commits++; },
    });
    assert.strictEqual(engine.calls.playElephantCapture.length, 1);
    assert.strictEqual(commits, 1);
  });

  console.log(`\n${passed} tests passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
})().catch((err) => {
  console.error('capture-path smoke test FAILED:');
  console.error(err);
  process.exit(1);
});
