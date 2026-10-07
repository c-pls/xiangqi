'use strict';
/**
 * tests/effects-manager.test.js — QA (W4b) tests for js/effects-bridge.js.
 *
 * Loads the REAL js/event-bus.js + REAL js/effects-bridge.js with stubbed
 * window.aaaEngine (records playCannonCapture/playCapture calls),
 * window.audioManager (records play calls), and window.EFFECTS_CONFIG
 * (cannon phases with compressed timings).
 *
 * Verified against js/effects-bridge.js source:
 *  - bus payload for 'capture' carries { attacker, from, to, targetEl,
 *    movingPieceEl, commit }; attacker 'C' selects the cannon path.
 *  - window.effectsManager is the live instance; intensity is the public
 *    `intensity` field; setIntensity(level) ignores garbage (warn + return).
 *  - 'off' commits synchronously; 'low' commits after ~250ms silently;
 *    'full' cannon schedules phase audio then calls
 *    playCannonCapture(from, to, targetEl, movingPieceEl, finish,
 *    {muteInternalAudio:true}); 'full' non-cannon calls legacy playCapture.
 *  - skipAll() invokes the pending (once-guarded) commit.
 *  - reduced-motion (window.matchMedia matches) defaults intensity to 'low'.
 *  - UI binding is guarded by `typeof document === 'undefined'` (verified).
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/effects-manager.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ---------------------------------------------------------------- stubs ---

function makeEngine({ autoCommit = true } = {}) {
  const calls = { playCannonCapture: [], playCapture: [] };
  return {
    calls,
    // Bridge signatures:
    //   playCannonCapture(from, to, targetEl, movingPieceEl, finish, {muteInternalAudio:true})
    //   playCapture(attacker, from, to, targetEl, movingPieceEl, finish)
    playCannonCapture(...args) {
      calls.playCannonCapture.push(args);
      const done = args[4];
      if (autoCommit && typeof done === 'function') done();
    },
    playCapture(...args) {
      calls.playCapture.push(args);
      const done = args[5];
      if (autoCommit && typeof done === 'function') done();
    },
  };
}

function makeAudio() {
  const plays = [];
  return { plays, play(name) { plays.push(name); } };
}

// Shape mirrors js/effects-config.js; timings compressed so the suite is fast.
function makeConfig() {
  return {
    version: 1,
    pieces: {
      C: {
        capture: {
          durationMs: 40,
          phases: [
            { t: 0, visual: 'barrel-elevate', audio: 'cannon_charge' },
            { t: 10, visual: 'muzzle-flash', audio: 'cannon_fire' },
            { t: 20, visual: 'impact', audio: 'cannon_impact' },
          ],
        },
      },
      R: { capture: { durationMs: 30, phases: [] } },
    },
  };
}

/**
 * Fresh sandbox: new stubs, real event-bus, stub engines/config, real bridge.
 * The bridge reads window.matchMedia (not the bare injected one), so the
 * reduced-motion stub is attached to window here.
 */
function loadFresh({ matchMediaMatches = false, autoCommit = true, documentStub } = {}) {
  const stubs = harness.makeStubs();
  stubs.window.matchMedia = () => ({ matches: matchMediaMatches });
  harness.loadScript(stubs, BUS);
  const engine = makeEngine({ autoCommit });
  const audio = makeAudio();
  stubs.window.aaaEngine = engine;
  stubs.window.audioManager = audio;
  stubs.window.EFFECTS_CONFIG = makeConfig();
  const opts = {};
  if (documentStub !== undefined) opts.document = documentStub;
  harness.loadScript(stubs, BRIDGE, opts); // throws if the bridge has unguarded globals
  assert.ok(stubs.window.effectsManager, 'window.effectsManager assigned');
  assert.ok(stubs.window.GameBus, 'window.GameBus assigned');
  return { stubs, engine, audio, manager: stubs.window.effectsManager };
}

function capturePayload(attacker, commit) {
  return {
    attacker, from: 'a0', to: 'a1',
    targetEl: null, movingPieceEl: null, commit,
  };
}

function emitCapture(stubs, attacker) {
  let commits = 0;
  stubs.window.GameBus.emit('capture', capturePayload(attacker, () => { commits++; }));
  return () => commits;
}

// ----------------------------------------------------------------- tests ---

(async () => {
  // 0. Document guard: the bridge must load with NO document present.
  await test('loads without document (UI binding guarded)', async () => {
    const { manager } = loadFresh(); // documentStub omitted -> undefined
    assert.ok(manager);
  });

  // 1. Intensity off -> immediate commit, no engine/audio calls.
  await test('off: commit immediately, no engine/audio calls', async () => {
    const { stubs, engine, audio, manager } = loadFresh();
    manager.setIntensity('off');
    const commits = emitCapture(stubs, 'C');
    await sleep(30);
    assert.strictEqual(commits(), 1, 'commit invoked exactly once');
    assert.strictEqual(engine.calls.playCannonCapture.length, 0);
    assert.strictEqual(engine.calls.playCapture.length, 0);
    assert.strictEqual(audio.plays.length, 0);
  });

  // 2. Intensity low -> commit ~250ms, silent (no engine, no audio).
  await test('low: commit ~250ms, silent', async () => {
    const { stubs, engine, audio, manager } = loadFresh();
    manager.setIntensity('low');
    const t0 = Date.now();
    const commits = emitCapture(stubs, 'R');
    await sleep(120);
    assert.strictEqual(commits(), 0, 'commit must not fire early');
    await sleep(250);
    assert.strictEqual(commits(), 1, 'commit invoked exactly once');
    const dt = Date.now() - t0;
    assert.ok(dt >= 230 && dt < 900, `commit delay ~250ms, got ${dt}ms`);
    assert.strictEqual(engine.calls.playCannonCapture.length, 0);
    assert.strictEqual(engine.calls.playCapture.length, 0);
    assert.strictEqual(audio.plays.length, 0, 'low path is silent (manager fix)');
  });

  // 3. Full + cannon -> phase audio scheduled, playCannonCapture muted.
  await test('full cannon: phase audio + muted playCannonCapture', async () => {
    const { stubs, engine, audio, manager } = loadFresh();
    manager.setIntensity('full');
    const commits = emitCapture(stubs, 'C');
    await sleep(120); // covers t=0,10,20 phases + 40ms duration
    assert.deepStrictEqual(
      audio.plays,
      ['cannon_charge', 'cannon_fire', 'cannon_impact'],
      'phase audio scheduled in order'
    );
    assert.strictEqual(engine.calls.playCannonCapture.length, 1);
    const lastArg = engine.calls.playCannonCapture[0].at(-1);
    assert.ok(
      lastArg && lastArg.muteInternalAudio === true,
      'playCannonCapture called with {muteInternalAudio:true}'
    );
    assert.strictEqual(engine.calls.playCapture.length, 0);
    assert.strictEqual(commits(), 1, 'commit invoked exactly once');
  });

  // 4. Full + non-cannon -> legacy playCapture.
  await test('full non-cannon: legacy playCapture', async () => {
    const { stubs, engine, audio, manager } = loadFresh();
    manager.setIntensity('full');
    const commits = emitCapture(stubs, 'R');
    await sleep(120);
    assert.strictEqual(engine.calls.playCapture.length, 1);
    assert.strictEqual(engine.calls.playCannonCapture.length, 0);
    assert.strictEqual(commits(), 1, 'commit invoked exactly once');
  });

  // 5. skipAll -> pending commit invoked (engine holds the finish callback).
  await test('skipAll: pending commit invoked', async () => {
    const { stubs, manager } = loadFresh({ autoCommit: false });
    manager.setIntensity('full');
    const commits = emitCapture(stubs, 'C');
    await sleep(30);
    assert.strictEqual(commits(), 0, 'commit still pending before skipAll');
    manager.skipAll();
    await sleep(30);
    assert.strictEqual(commits(), 1, 'skipAll invokes the pending commit');
  });

  // 6. setIntensity rejects garbage (warn + ignore; intensity unchanged).
  await test('setIntensity rejects garbage', async () => {
    const { manager } = loadFresh();
    manager.setIntensity('full');
    const before = manager.intensity;
    manager.setIntensity('turbo'); // must not throw, must not change intensity
    assert.strictEqual(manager.intensity, before, 'intensity unchanged after garbage');
  });

  // 7. reduced-motion -> default low.
  await test('reduced-motion: default intensity is low', async () => {
    const { manager } = loadFresh({ matchMediaMatches: true });
    assert.strictEqual(manager.intensity, 'low');
  });

  // 8. Back-to-back captures: each commits exactly once (FIFO, no double-commit).
  await test('back-to-back captures: each commits exactly once', async () => {
    const { stubs, manager } = loadFresh();
    manager.setIntensity('off');
    const c1 = emitCapture(stubs, 'C');
    const c2 = emitCapture(stubs, 'R');
    await sleep(30);
    assert.strictEqual(c1(), 1);
    assert.strictEqual(c2(), 1);
  });

  console.log(`\n${passed} tests passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
})();
