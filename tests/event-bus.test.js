'use strict';
/**
 * tests/event-bus.test.js — contract tests for window.GameBus (W1).
 *
 * Frozen contract:
 *   window.GameBus = { on(event, fn), off(event, fn), emit(event, payload) };
 *   emit is synchronous, with try/catch isolation per handler.
 *
 * Run:  node tests/event-bus.test.js
 * Any failing assertion throws -> non-zero exit code.
 *
 * Override the script under test with EVENT_BUS_PATH env var
 * (used by QA to validate this file against a synthetic implementation).
 */
const path = require('path');
const assert = require('node:assert');
const { makeStubs, loadScript } = require('./harness');

const SCRIPT = process.env.EVENT_BUS_PATH || path.join(__dirname, '..', 'js', 'event-bus.js');

function freshBus() {
  const stubs = makeStubs();
  loadScript(stubs, SCRIPT);
  const GameBus = stubs.window.GameBus;
  assert.ok(GameBus, `window.GameBus must be defined by ${SCRIPT}`);
  return GameBus;
}

// --- shape: on/off/emit are functions ------------------------------------
{
  const GameBus = freshBus();
  for (const m of ['on', 'off', 'emit']) {
    assert.strictEqual(typeof GameBus[m], 'function', `GameBus.${m} must be a function`);
  }
}

// --- 1. on/emit delivers the payload ---------------------------------------
{
  const GameBus = freshBus();
  let received = null;
  GameBus.on('move', (p) => { received = p; });
  GameBus.emit('move', { from: 'a1', to: 'b2' });
  assert.deepStrictEqual(received, { from: 'a1', to: 'b2' }, 'subscriber must receive the emitted payload');
}

// --- 2. emit is synchronous -------------------------------------------------
{
  const GameBus = freshBus();
  let ran = false;
  GameBus.on('sync', () => { ran = true; });
  GameBus.emit('sync');
  assert.strictEqual(ran, true, 'emit must invoke handlers synchronously (before it returns)');
}

// --- 3. multiple subscribers all fire, in subscription order -----------------
{
  const GameBus = freshBus();
  const order = [];
  GameBus.on('x', () => order.push('a'));
  GameBus.on('x', () => order.push('b'));
  GameBus.on('x', () => order.push('c'));
  GameBus.emit('x');
  assert.deepStrictEqual(order, ['a', 'b', 'c'], 'all subscribers must fire in subscription order');
}

// --- 4. off removes the handler ---------------------------------------------
{
  const GameBus = freshBus();
  let count = 0;
  const handler = () => { count++; };
  GameBus.on('y', handler);
  GameBus.emit('y');
  assert.strictEqual(count, 1);
  GameBus.off('y', handler);
  GameBus.emit('y');
  assert.strictEqual(count, 1, 'off() must remove the handler');
}

// --- 5. off with a never-registered handler must not throw -------------------
{
  const GameBus = freshBus();
  assert.doesNotThrow(
    () => GameBus.off('nope', () => {}),
    'off() on an unknown event/handler must not throw'
  );
}

// --- 6. emit with no subscribers must not throw ------------------------------
{
  const GameBus = freshBus();
  assert.doesNotThrow(
    () => GameBus.emit('nobody-listening', { n: 1 }),
    'emit() with no subscribers must not throw'
  );
}

// --- 7. handler error isolation -----------------------------------------------
{
  const GameBus = freshBus();
  const called = [];
  GameBus.on('boom', () => { called.push('first'); throw new Error('handler failure'); });
  GameBus.on('boom', () => { called.push('second'); });
  assert.doesNotThrow(
    () => GameBus.emit('boom', {}),
    'emit() must not throw when a handler throws (try/catch per handler)'
  );
  assert.deepStrictEqual(called, ['first', 'second'], 'handlers after a throwing handler must still run');
}

// --- 8. events are isolated by name --------------------------------------------
{
  const GameBus = freshBus();
  let got = 0;
  GameBus.on('one', () => { got++; });
  GameBus.emit('two');
  assert.strictEqual(got, 0, 'emitting one event must not trigger another event\'s handlers');
}

console.log('ok - event-bus contract tests passed');
