'use strict';
/**
 * tests/event-flow.test.js — QA (W4b) bus-level smoke test for Phase 1.
 *
 * Loads the REAL js/event-bus.js + REAL js/effects-bridge.js with stubbed
 * engines, then drives the Phase 1 events through the REAL bus:
 *   'capture' -> routed/handled (commit invoked)
 *   'check', 'checkmate', 'soldierCrossRiver', 'move' -> no-op, no throw
 * Also asserts the bridge never touches game logic: the source (comments
 * stripped) must not reference XiangqiGame / makeMove / the word "game".
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/event-flow.test.js
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const stubs = harness.makeStubs();
  harness.loadScript(stubs, BUS);
  assert.ok(stubs.window.GameBus, 'real GameBus loaded');

  const engineCalls = { playCannonCapture: 0, playCapture: 0 };
  stubs.window.aaaEngine = {
    playCannonCapture() { engineCalls.playCannonCapture++; },
    playCapture() { engineCalls.playCapture++; },
  };
  const audioPlays = [];
  stubs.window.audioManager = { play(name) { audioPlays.push(name); } };
  stubs.window.EFFECTS_CONFIG = { version: 1, pieces: {} };

  harness.loadScript(stubs, BRIDGE); // no document -> guard path exercised
  const GameBus = stubs.window.GameBus;
  const manager = stubs.window.effectsManager;
  assert.ok(manager, 'real EffectsManager loaded');

  // The bridge must not blow up when the bus is missing either (load-order guard).
  const stubs2 = harness.makeStubs();
  harness.loadScript(stubs2, BRIDGE);
  console.log('ok - effects-bridge.js loads with no GameBus present (guarded)');

  // --- 'capture' is routed and handled through the real bus -----------------
  manager.setIntensity('off');
  let commits = 0;
  GameBus.emit('capture', { attacker: 'C', from: 'a0', to: 'a1', commit: () => { commits++; } });
  await sleep(30);
  assert.strictEqual(commits, 1, "'capture' routed: commit invoked exactly once");
  console.log("ok - 'capture' routed through real bus, commit invoked");

  // --- other Phase 1 events are no-ops and never throw ----------------------
  for (const ev of ['check', 'checkmate', 'soldierCrossRiver', 'move']) {
    GameBus.emit(ev, { attacker: 'C', commit: () => { commits++; } }); // must not throw
  }
  await sleep(30);
  assert.strictEqual(commits, 1, 'non-capture events cause no extra commits');
  assert.strictEqual(engineCalls.playCannonCapture, 0);
  assert.strictEqual(engineCalls.playCapture, 0);
  assert.strictEqual(audioPlays.length, 0);
  console.log("ok - 'check'/'checkmate'/'soldierCrossRiver'/'move' no-op without throwing");

  // --- game logic untouched: grep the bridge source -------------------------
  const src = fs.readFileSync(BRIDGE, 'utf8');
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const offenders = [];
  for (const [label, re] of [
    ['XiangqiGame', /\bXiangqiGame\b/],
    ['makeMove', /\bmakeMove\b/],
    ['word "game"', /\bgame\b/i],
  ]) {
    const lines = [];
    stripped.split('\n').forEach((line, i) => {
      if (re.test(line)) lines.push(i + 1);
    });
    if (lines.length) offenders.push(`${label} @ lines ${lines.join(',')}`);
  }
  assert.strictEqual(
    offenders.length, 0,
    `effects-bridge.js references game internals outside comments: ${offenders.join('; ')}`
  );
  console.log('ok - effects-bridge.js contains no XiangqiGame/makeMove/"game" refs outside comments');

  console.log('\nevent-flow smoke test: ALL PASSED');
})().catch((err) => {
  console.error('event-flow smoke test FAILED:');
  console.error(err);
  process.exit(1);
});
