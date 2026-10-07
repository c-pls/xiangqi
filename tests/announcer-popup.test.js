'use strict';
/**
 * tests/announcer-popup.test.js — announcer REMOVAL verification.
 *
 * Per user request (2026-10-06) the announcer popups (FIRST BLOOD! /
 * DOUBLE KILL! / CANNON MASTER! / REVENGE!) were removed: captures play
 * their cinematics with no toast, and the announcer sting no longer fires.
 * js/announcer.js itself is intentionally untouched (pure logic, frozen
 * contract, no DOM).
 *
 * Loads the REAL js/event-bus.js + REAL js/announcer.js + REAL
 * js/effects-bridge.js (+ real config) with stubbed engines and a minimal
 * document stub, then emits captures through the REAL GameBus and asserts:
 *   - Full / Low / Off intensity: NO `fx-announcement-popup` DOM is created.
 *   - The announcer sting (audioManager.playAnnouncementSting) never fires.
 *   - Captures still commit exactly once (the cinematic pipeline is intact).
 *   - js/announcer.js still computes descriptors (pure logic preserved).
 *   - skipAll() with no popups does not throw.
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/announcer-popup.test.js
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

function makeDocument() {
  const appended = [];
  function makeEl(tag) {
    return {
      tagName: String(tag).toUpperCase(),
      className: '',
      textContent: '',
      style: {},
      children: [],
      removed: false,
      appendChild(c) { this.children.push(c); appended.push(c); return c; },
      remove() { this.removed = true; },
    };
  }
  const body = makeEl('body');
  return {
    appended,
    body,
    createElement: (t) => makeEl(t),
    getElementById: () => null, // no settings UI in the smoke env
    querySelector: () => null,
  };
}

function makeEngine() {
  const calls = [];
  const engine = {
    calls,
    playCannonCapture(...a) { calls.push(['playCannonCapture', a]); a[4](); },
    playChariotCapture(...a) { calls.push(['playChariotCapture', a]); a[4](); },
    playHorseCapture(...a) { calls.push(['playHorseCapture', a]); a[4](); },
    playElephantCapture(...a) { calls.push(['playElephantCapture', a]); a[4](); },
    playAdvisorCapture(...a) { calls.push(['playAdvisorCapture', a]); a[4](); },
    playSoldierCapture(...a) { calls.push(['playSoldierCapture', a]); a[4](); },
    playGeneralCapture(...a) { calls.push(['playGeneralCapture', a]); a[4](); },
    playCapture(...a) { calls.push(['playCapture', a]); a[5](); },
  };
  return engine;
}

function loadReal() {
  const stubs = harness.makeStubs();
  harness.loadScript(stubs, BUS);
  harness.loadScript(stubs, CONFIG);
  harness.loadScript(stubs, ANNOUNCER);
  const doc = makeDocument();
  const stings = [];
  stubs.window.aaaEngine = makeEngine();
  stubs.window.audioManager = {
    play() {},
    playAnnouncementSting() { stings.push(1); },
  };
  harness.loadScript(stubs, BRIDGE, { document: doc });
  const manager = stubs.window.effectsManager;
  assert.ok(manager, 'window.effectsManager assigned');
  assert.ok(stubs.window.Announcer, 'window.Announcer assigned');
  return { stubs, doc, stings, manager, Announcer: stubs.window.Announcer };
}

// Emit 'move' (as app.js executeMove does) then 'capture' with `side`.
function emitCapture(env, attacker, side) {
  let commits = 0;
  env.stubs.window.GameBus.emit('move', { move: {} });
  env.stubs.window.GameBus.emit('capture', {
    attacker, victim: 'P', side,
    from: 'a0', to: 'a1', targetEl: null, movingPieceEl: null,
    commit: () => { commits++; },
  });
  return () => commits;
}

function popupTexts(doc) {
  return doc.appended
    .filter((el) => el.className === 'fx-announcement-popup')
    .map((el) => el.textContent);
}

(async () => {
  await test('full: captures commit, no popups, no sting', async () => {
    const env = loadReal();
    env.manager.setIntensity('full');
    const commits1 = emitCapture(env, 'R', 'red');   // was FIRST BLOOD
    const commits2 = emitCapture(env, 'H', 'red');   // was DOUBLE KILL
    assert.strictEqual(commits1(), 1, 'first capture committed exactly once');
    assert.strictEqual(commits2(), 1, 'second capture committed exactly once');
    assert.deepStrictEqual(popupTexts(env.doc), [], 'no announcement popups rendered');
    assert.strictEqual(env.stings.length, 0, 'announcer sting never fired');
  });

  await test('low: captures commit, no popups, no sting', async () => {
    const env = loadReal();
    env.manager.setIntensity('low');
    const commits = emitCapture(env, 'R', 'red');
    await sleep(320); // low commit delay (~250ms)
    assert.strictEqual(commits(), 1, 'capture committed exactly once at low');
    assert.deepStrictEqual(popupTexts(env.doc), [], 'no announcement popups at low');
    assert.strictEqual(env.stings.length, 0, 'announcer sting never fired at low');
  });

  await test('off: captures commit instantly, no popups', async () => {
    const env = loadReal();
    env.manager.setIntensity('off');
    const commits = emitCapture(env, 'R', 'red');
    await sleep(60);
    assert.strictEqual(commits(), 1, 'capture committed exactly once at off');
    assert.strictEqual(env.doc.appended.length, 0, 'no popups at off');
  });

  await test('announcer module left intact (pure logic, no DOM)', async () => {
    const env = loadReal();
    env.Announcer.reset('game-1');
    const d = env.Announcer.announceForCapture({ piece: 'R', victim: 'p', side: 'red', moveNumber: 0 });
    assert.deepStrictEqual(d, { text: 'FIRST BLOOD', level: 'major' },
      'js/announcer.js still computes descriptors');
  });

  await test('skipAll() with no popups does not throw', async () => {
    const env = loadReal();
    env.manager.setIntensity('full');
    emitCapture(env, 'R', 'red');
    assert.doesNotThrow(() => env.manager.skipAll(), 'skipAll safe without popups');
    assert.strictEqual((env.manager._popups || []).length, 0, 'popup list stays empty');
  });

  console.log(`\n${passed} tests passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
})().catch((err) => {
  console.error('announcer removal verification FAILED:');
  console.error(err);
  process.exit(1);
});
