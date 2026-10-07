'use strict';
/**
 * tests/check-clear-on-move.test.js — check visuals must not linger after the
 * check is escaped.
 *
 * Regression test for the user-reported bug (2026-10-06): the cannon laser
 * line (and other check overlays) stayed on the board after the checked side
 * moved out of check. Root cause: the GameBus 'move' handler stopped the
 * heartbeat but never cleared the check visuals.
 *
 * Covers (real js/event-bus.js + real js/effects-bridge.js, recording
 * window.CheckVFX stub, no DOM):
 *  - Rendering check visuals, then emitting 'move', clears them
 *    (clearAll runs after the visuals).
 *  - A fresh 'check' after the escape re-renders the visuals (the 'move'
 *    clear does not break subsequent checks).
 *  - Stale phased check timeouts no-op after a clear (generation guard): a
 *    _runCheckConfig phase scheduled before _clearCheckVFX() must not
 *    re-add visuals; without an intervening clear the phase still runs.
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/check-clear-on-move.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function makeCheckVFX(calls) {
  return {
    clearAll() { calls.push('clearAll'); },
    trembleGeneral(cell, on) { calls.push('trembleGeneral:' + on); },
    sweatDrops(cell, on) { calls.push('sweatDrops:' + on); },
    palaceGlow(side, on) { calls.push('palaceGlow:' + on); },
    cannonLaserAim(f, t, on) { calls.push('cannonLaserAim:' + on); },
    chariotLane(f, t, on) { calls.push('chariotLane:' + on); },
    horseGhostTrail(cells, on) { calls.push('horseGhostTrail:' + on); },
    soldierAim(f, t, on) { calls.push('soldierAim:' + on); },
    flyingGeneralDuel(a, b, on) { calls.push('flyingGeneralDuel:' + on); },
    setDoubleCheck(on) { calls.push('setDoubleCheck:' + on); },
  };
}

function loadEnv() {
  const stubs = harness.makeStubs();
  const calls = [];
  stubs.window.CheckVFX = makeCheckVFX(calls);
  harness.loadScript(stubs, BUS);
  // No EFFECTS_CONFIG: _checkConfigFor returns null -> deterministic
  // synchronous _runDefaultCheck path (no setTimeout phases).
  harness.loadScript(stubs, BRIDGE);
  const manager = stubs.window.effectsManager;
  assert.ok(manager, 'window.effectsManager assigned');
  manager.setIntensity('full');
  return { stubs, calls, manager, bus: stubs.window.GameBus };
}

const CTX = {
  side: 'red',
  generalCell: { r: 9, c: 4 },
  checkerPos: { r: 5, c: 4 },
  from: { r: 5, c: 4 },
  to: { r: 9, c: 4 },
};

function checkEvent() {
  return {
    pieceKey: 'C',
    side: 'red',
    generalCell: { r: 9, c: 4 },
    checkingPos: { r: 5, c: 4 },
    checkingPieces: [{ r: 5, c: 4, piece: 'C' }],
    from: { r: 5, c: 4 },
    to: { r: 9, c: 4 },
  };
}

function count(calls, name) {
  return calls.filter((c) => c === name).length;
}

(async () => {
  await test('escaping check clears the visuals (move -> clearAll after render)', async () => {
    const env = loadEnv();
    env.manager._runDefaultCheck('C', CTX);
    assert.ok(count(env.calls, 'cannonLaserAim:true') === 1, 'laser rendered');
    assert.ok(count(env.calls, 'trembleGeneral:true') === 1, 'general trembling');
    env.bus.emit('move', { move: {} });
    assert.ok(count(env.calls, 'clearAll') === 1, 'one clearAll on move');
    assert.ok(
      env.calls.indexOf('clearAll') > env.calls.indexOf('cannonLaserAim:true'),
      'clear runs after the visuals were rendered'
    );
  });

  await test('a new check after the escape re-renders visuals', async () => {
    const env = loadEnv();
    env.bus.emit('check', checkEvent());
    assert.ok(count(env.calls, 'cannonLaserAim:true') === 1, 'first check rendered');
    env.bus.emit('move', { move: {} }); // escape
    assert.ok(count(env.calls, 'clearAll') >= 1, 'escape cleared');
    env.bus.emit('check', checkEvent()); // check again
    assert.ok(count(env.calls, 'cannonLaserAim:true') === 2, 'second check re-rendered');
    const lastClear = env.calls.lastIndexOf('clearAll');
    const lastLaser = env.calls.lastIndexOf('cannonLaserAim:true');
    assert.ok(lastLaser > lastClear, 'fresh visuals come after the escape clear');
  });

  await test('stale phased check timeouts no-op after a clear (generation guard)', async () => {
    const env = loadEnv();
    const before = count(env.calls, 'cannonLaserAim:true');
    env.manager._runCheckConfig(
      { phases: [{ t: 40, visual: 'cannonLaserAim' }] },
      CTX
    );
    env.manager._clearCheckVFX(); // escape lands before the phase fires
    await sleep(120);
    assert.strictEqual(
      count(env.calls, 'cannonLaserAim:true'), before,
      'stale phase did not re-add the laser'
    );
  });

  await test('phased check timeouts still run when not superseded (control)', async () => {
    const env = loadEnv();
    const before = count(env.calls, 'cannonLaserAim:true');
    env.manager._runCheckConfig(
      { phases: [{ t: 20, visual: 'cannonLaserAim' }] },
      CTX
    );
    await sleep(100);
    assert.strictEqual(
      count(env.calls, 'cannonLaserAim:true'), before + 1,
      'phase runs normally without an intervening clear'
    );
  });

  console.log(`\n${passed} tests passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
})().catch((err) => {
  console.error('check-clear-on-move test FAILED:');
  console.error(err);
  process.exit(1);
});
