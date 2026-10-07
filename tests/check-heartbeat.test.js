'use strict';
/**
 * tests/check-heartbeat.test.js — QA (W4-final) unit tests for the Phase 3
 * heartbeat loop in js/audio-manager.js:
 *   startHeartbeat() / stopHeartbeat() / setHeartbeatIntensity('normal'|'high')
 *
 * Contract under test:
 *   - startHeartbeat() is idempotent (2nd call is a no-op: one timer).
 *   - stopHeartbeat() is idempotent (clears the timer + nodes; 2nd call no-op,
 *     stopping before starting never throws).
 *   - setHeartbeatIntensity('high') switches the period 1000 -> 620ms live
 *     (timer restarted) or applies to the next start; invalid levels ignored.
 *   - Mute is respected: no thumps are synthesized while muted.
 *   - Master/sfx volume is honored: zero volume => silence.
 *
 * Loads the REAL js/audio-manager.js with a stub `sfx` map (the module
 * fail-closes without it), a stub window.AudioContext that counts created
 * oscillators, and spies on the global setInterval/clearInterval (patched
 * and restored around each case).
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/check-heartbeat.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const harness = require('./harness');

const AUDIO = path.join(path.resolve(__dirname, '..'), 'js', 'audio-manager.js');

function makeAudioContextStub() {
  const ctx = {
    createdOsc: 0,
    state: 'running',
    currentTime: 1000,
    destination: {},
    resume() { ctx.resumed = true; },
    createOscillator() {
      ctx.createdOsc++;
      const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
      return {
        type: 'sine',
        frequency: param,
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
      };
    },
    createGain() {
      const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
      return { gain: param, connect() {}, disconnect() {} };
    },
  };
  return ctx;
}

const SFX_STUB = {
  tick: { volume: () => 0.4, play() {}, state: () => 'loaded' },
};

function loadAudio() {
  const stubs = harness.makeStubs();
  const actx = makeAudioContextStub();
  // AudioContext must be a *constructor*: hbAudioCtx() does `new AC()`.
  stubs.window.AudioContext = function () { return actx; };
  harness.loadScript(stubs, AUDIO, { sfx: SFX_STUB });
  const am = stubs.window.audioManager;
  assert.ok(am, 'real window.audioManager loaded');
  assert.strictEqual(typeof am.startHeartbeat, 'function', 'startHeartbeat exposed');
  assert.strictEqual(typeof am.stopHeartbeat, 'function', 'stopHeartbeat exposed');
  assert.strictEqual(
    typeof am.setHeartbeatIntensity, 'function', 'setHeartbeatIntensity exposed'
  );
  return { am, actx };
}

// Patch the globals the heartbeat timer uses; returns { calls, restore }.
function spyTimers() {
  const realSet = global.setInterval;
  const realClear = global.clearInterval;
  const calls = { set: [], clear: [] };
  global.setInterval = (fn, ms, ...rest) => {
    calls.set.push(ms);
    return realSet(fn, ms, ...rest);
  };
  global.clearInterval = (id) => {
    calls.clear.push(id);
    return realClear(id);
  };
  return { calls, restore() { global.setInterval = realSet; global.clearInterval = realClear; } };
}

(async () => {
  // --- 1. start is idempotent: one timer ------------------------------------
  {
    const t = spyTimers();
    try {
      const { am } = loadAudio();
      am.startHeartbeat();
      am.startHeartbeat();
      am.startHeartbeat();
      assert.strictEqual(t.calls.set.length, 1, 'three starts => exactly one setInterval');
      am.stopHeartbeat();
    } finally { t.restore(); }
    console.log('ok - startHeartbeat() is idempotent (one timer)');
  }

  // --- 2. stop is idempotent; stopping first never throws --------------------
  {
    const t = spyTimers();
    try {
      const { am } = loadAudio();
      am.stopHeartbeat(); // never started: must not throw
      am.startHeartbeat();
      const clearsBefore = t.calls.clear.length;
      am.stopHeartbeat();
      am.stopHeartbeat();
      assert.strictEqual(
        t.calls.clear.length, clearsBefore + 1,
        'two stops => exactly one clearInterval'
      );
    } finally { t.restore(); }
    console.log('ok - stopHeartbeat() is idempotent; stop-before-start never throws');
  }

  // --- 3. intensity switch: high => 620ms live -------------------------------
  {
    const t = spyTimers();
    try {
      const { am } = loadAudio();
      am.setHeartbeatIntensity('high'); // before start: applies to next start
      am.startHeartbeat();
      assert.strictEqual(
        t.calls.set[t.calls.set.length - 1], 620,
        `'high' starts the timer at 620ms (got ${t.calls.set[t.calls.set.length - 1]})`
      );
      const clearsBefore = t.calls.clear.length;
      am.setHeartbeatIntensity('normal'); // live switch while running
      assert.strictEqual(
        t.calls.clear.length, clearsBefore + 1,
        'live switch restarts the single timer (clearInterval called)'
      );
      assert.strictEqual(
        t.calls.set[t.calls.set.length - 1], 1000,
        `'normal' restarts the timer at 1000ms (got ${t.calls.set[t.calls.set.length - 1]})`
      );
      am.stopHeartbeat();
    } finally { t.restore(); }
    console.log("ok - setHeartbeatIntensity('high'|'normal') switches 620/1000ms, live or pre-start");
  }

  // --- 4. invalid intensity levels are ignored --------------------------------
  {
    const t = spyTimers();
    try {
      const { am } = loadAudio();
      am.setHeartbeatIntensity('ludicrous'); // must not throw, must not change level
      am.setHeartbeatIntensity(null);
      am.startHeartbeat();
      assert.strictEqual(
        t.calls.set[t.calls.set.length - 1], 1000,
        'invalid levels ignored: timer still starts at the normal 1000ms'
      );
      am.stopHeartbeat();
    } finally { t.restore(); }
    console.log('ok - invalid intensity levels are ignored (no throw, level unchanged)');
  }

  // --- 5. mute respected: no thumps while muted -------------------------------
  {
    const t = spyTimers();
    try {
      const { am, actx } = loadAudio();
      am.setMuted(true);
      assert.ok(am.isMuted(), 'mute state sticks');
      am.startHeartbeat(); // immediate first beat must synthesize nothing
      assert.strictEqual(actx.createdOsc, 0, 'muted: zero oscillators created');
      am.stopHeartbeat();
      am.setMuted(false);
    } finally { t.restore(); }
    console.log('ok - mute respected: no heartbeat thumps while muted');
  }

  // --- 6. unmuted heartbeat synthesizes thumps ---------------------------------
  {
    const t = spyTimers();
    try {
      const { am, actx } = loadAudio();
      am.setMuted(false);
      am.startHeartbeat(); // immediate first beat: one lub-dub = 2 oscillators
      assert.ok(
        actx.createdOsc >= 2,
        `unmuted: thumps synthesized (oscillators created: ${actx.createdOsc})`
      );
      am.stopHeartbeat();
    } finally { t.restore(); }
    console.log('ok - unmuted heartbeat synthesizes thumps via Web Audio');
  }

  // --- 7. zero master/sfx volume => silence -------------------------------------
  {
    const t = spyTimers();
    try {
      const { am, actx } = loadAudio();
      am.setVolume({ master: 0, sfx: 0 });
      am.startHeartbeat();
      assert.strictEqual(actx.createdOsc, 0, 'zero volume: zero oscillators created');
      am.stopHeartbeat();
      am.setVolume({ master: 1, sfx: 1 });
    } finally { t.restore(); }
    console.log('ok - master/sfx volume honored: zero volume silences the heartbeat');
  }

  console.log('\ncheck-heartbeat tests: ALL PASSED');
})().catch((err) => {
  console.error('check-heartbeat tests FAILED:');
  console.error(err);
  process.exit(1);
});
