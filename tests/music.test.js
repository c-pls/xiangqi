'use strict';
/**
 * tests/music.test.js — QA (W4) tests for Phase 5 music (W3), river-fx (W3),
 *                        and the announcer sting gating (W3, audio-manager.js).
 *
 * PINNED CONTRACT (W3 actual, verified 2026-10-06 against js/music.js):
 *  - window.MusicEngine with start(), stop(), setIntensity(0..1) (clamped,
 *    smoothed), reset(). NO setMood/getMood/getIntensity, NO setMuted/
 *    setVolume — mute + master/music volume are honored via window.audioManager
 *    (isMuted()/getVolume()), with conservative defaults when it is absent.
 *  - GameBus wiring: 'check' -> setIntensity(1), 'move' -> setIntensity(0.35
 *    = BASE_INTENSITY), 'checkmate' -> 0.9 swell then fade-out stop after 8s.
 *  - PRESSURE_THRESHOLD_S = 30: time-pressure heartbeat starts when either
 *    clock <= 30s (timed mode, game not over), stops when pressure ends.
 *  - window.RiverFX subscribes to GameBus 'soldierCrossRiver'; splash(cell)
 *    queues ripples; intensity off/low/full (+ reduced-motion) gating.
 *  - audioManager.playAnnouncementSting() — the exact entry point. Audible at
 *    Full intensity ONLY (gated in effects-bridge._showAnnouncement); silent
 *    at Low and Off.
 *
 * Exit codes: 0 = pass, 1 = fail, 3 = implementation not landed yet.
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/music.test.js
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const MUSIC = path.join(ROOT, 'js', 'music.js');
const RIVER = path.join(ROOT, 'js', 'river-fx.js');
const AUDIO = path.join(ROOT, 'js', 'audio-manager.js');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');

function needLanded(p, what) {
  if (!fs.existsSync(p)) {
    console.error(`NOT-LANDED: ${what} not present — re-run after it lands. (${p})`);
    process.exit(3);
  }
}

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

// ------------------------------------------------------------------ stubs ---

function makeAudioParam() {
  return {
    value: 0,
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    exponentialRampToValueAtTime(v) { this.value = v; },
    setTargetAtTime(v) { this.value = v; },
  };
}

// Stub Web Audio context: counts created oscillators, records the music-bus
// gain levels driven by schedulerTick().
function makeMusicContext() {
  const busLevels = [];
  const ctx = {
    createdOsc: 0,
    state: 'running',
    currentTime: 1000,
    destination: {},
    resume() {},
    createOscillator() {
      ctx.createdOsc++;
      const o = {
        frequency: makeAudioParam(), detune: makeAudioParam(), type: 'sine',
        connect() {}, disconnect() {}, start() {}, stop() {},
      };
      return o;
    },
    createGain() {
      return {
        gain: {
          value: 0,
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
          setTargetAtTime(v) { busLevels.push(v); },
        },
        connect() {}, disconnect() {},
      };
    },
    createBiquadFilter() {
      return {
        type: 'lowpass', frequency: makeAudioParam(), Q: makeAudioParam(),
        connect() {},
      };
    },
  };
  return { ctx, busLevels };
}

function loadMusic({ audioContext = false, audioManager = null } = {}) {
  const stubs = harness.makeStubs();
  let musicCtx = null;
  if (audioContext) {
    musicCtx = makeMusicContext();
    const c = musicCtx.ctx;
    stubs.window.AudioContext = function () { return c; };
  }
  stubs.window.addEventListener = () => {};
  if (audioManager !== null) stubs.window.audioManager = audioManager;
  harness.loadScript(stubs, BUS);
  harness.loadScript(stubs, MUSIC);
  const engine = stubs.window.MusicEngine;
  assert.ok(engine, `window.MusicEngine must be assigned by js/music.js — got: ${Object.keys(stubs.window).join(',')}`);
  return { stubs, engine, musicCtx };
}

function stopEngine(engine) {
  // Clear both the scheduler interval and the pressure-monitor interval so
  // the process can exit.
  try { engine.stop(); } catch (e) {}
  try { engine._debug.stopPressureWatch(); } catch (e) {}
}

function captureTimeouts(fn) {
  const orig = globalThis.setTimeout;
  const calls = [];
  globalThis.setTimeout = (cb, ms, ...rest) => {
    calls.push({ cb, ms, rest });
    return 0xCAFE;
  };
  try {
    fn(calls);
  } finally {
    globalThis.setTimeout = orig;
  }
  return calls;
}

// ------------------------------------------------------------------ tests ---

(async () => {
  // ------------------------------------------------------------- music ---
  needLanded(MUSIC, 'js/music.js (W3)');

  await test('music: API surface is window.MusicEngine (start/stop/setIntensity/reset)', () => {
    const { engine } = loadMusic();
    for (const m of ['start', 'stop', 'setIntensity', 'reset']) {
      assert.strictEqual(typeof engine[m], 'function', `MusicEngine.${m}() must exist`);
    }
    // Negative pins: the scaffold's assumed mood/mute/volume API does NOT exist.
    for (const m of ['setMood', 'getMood', 'getIntensity', 'setMuted', 'setVolume', 'isMuted', 'getVolume']) {
      assert.strictEqual(engine[m], undefined, `MusicEngine.${m} must NOT exist (mute/volume live on audioManager)`);
    }
    assert.strictEqual(engine.PRESSURE_THRESHOLD_S, 30, 'PRESSURE_THRESHOLD_S documented as 30');
    assert.strictEqual(engine.BASE_INTENSITY, 0.35, 'BASE_INTENSITY documented as 0.35');
    stopEngine(engine);
  });

  await test('music: no AudioContext -> start/stop/setIntensity/reset never throw', () => {
    const { engine } = loadMusic({ audioContext: false });
    assert.doesNotThrow(() => {
      engine.start();
      engine.setIntensity(0.9);
      engine.setIntensity(2);
      engine.reset();
      engine.stop();
    }, 'no method may throw without an AudioContext');
    assert.strictEqual(engine._debug.state().playing, false, 'must not be playing without an AudioContext');
    assert.strictEqual(engine._debug.state().targetIntensity, 0.35, 'reset() restores baseline even without AC');
    stopEngine(engine);
  });

  await test('music: setIntensity clamps to 0..1', () => {
    const { engine } = loadMusic();
    engine.setIntensity(2);
    assert.strictEqual(engine._debug.state().targetIntensity, 1, 'clamped high');
    engine.setIntensity(-3);
    assert.strictEqual(engine._debug.state().targetIntensity, 0, 'clamped low');
    engine.setIntensity(NaN);
    assert.strictEqual(engine._debug.state().targetIntensity, 0, 'NaN -> 0');
    engine.setIntensity('loud');
    assert.strictEqual(engine._debug.state().targetIntensity, 0, 'non-numeric -> 0');
    engine.setIntensity(0.5);
    assert.strictEqual(engine._debug.state().targetIntensity, 0.5, 'in-range passes through');
    stopEngine(engine);
  });

  await test('music: start() builds an audio graph; stop() ends it', () => {
    const { engine, musicCtx } = loadMusic({ audioContext: true });
    engine.start();
    assert.strictEqual(engine._debug.state().playing, true, 'playing after start()');
    assert.ok(
      musicCtx.ctx.createdOsc >= 3,
      `scheduler must schedule pad+arp notes, created ${musicCtx.ctx.createdOsc} osc`
    );
    engine.start(); // idempotent
    assert.strictEqual(engine._debug.state().playing, true, 'repeated start() is a no-op');
    stopEngine(engine);
    assert.strictEqual(engine._debug.state().playing, false, 'stopped after stop()');
  });

  await test("music: bus 'check' -> 1, 'move' -> baseline 0.35", () => {
    const { stubs, engine } = loadMusic({ audioContext: true });
    const bus = stubs.window.GameBus;
    engine.start();
    assert.strictEqual(engine._debug.state().targetIntensity, 0.35, 'baseline at start');
    bus.emit('check', { pieceKey: 'C' });
    assert.strictEqual(engine._debug.state().targetIntensity, 1, "check -> setIntensity(1)");
    bus.emit('move', { from: { r: 1, c: 1 }, to: { r: 2, c: 1 } });
    assert.strictEqual(engine._debug.state().targetIntensity, 0.35, "move -> setIntensity(0.35)");
    engine.reset();
    assert.strictEqual(engine._debug.state().targetIntensity, 0.35, 'reset() -> baseline');
    stopEngine(engine);
  });

  await test("music: bus 'checkmate' -> 0.9 swell, then stop after 8s", () => {
    const { stubs, engine } = loadMusic({ audioContext: true });
    const bus = stubs.window.GameBus;
    engine.start();
    const calls = captureTimeouts(() => {
      bus.emit('checkmate', { reason: 'checkmate' });
    });
    assert.strictEqual(engine._debug.state().targetIntensity, 0.9, 'checkmate -> 0.9 swell');
    assert.strictEqual(calls.length, 1, `exactly one settle timer scheduled, got ${calls.length}`);
    assert.strictEqual(calls[0].ms, 8000, `settle timer must be 8000ms, got ${calls[0].ms}`);
    assert.strictEqual(engine._debug.state().playing, true, 'still playing during the swell');
    calls[0].cb(); // the 8s elapse
    assert.strictEqual(engine._debug.state().playing, false, 'stopped after the 8s settle');
    stopEngine(engine);
  });

  await test('music: mute honored via audioManager.isMuted (bus gain -> 0)', () => {
    const am = { isMuted: () => true, getVolume: () => ({ master: 1, music: 1 }) };
    const { engine, musicCtx } = loadMusic({ audioContext: true, audioManager: am });
    engine.start();
    engine._debug.tick();
    assert.ok(musicCtx.busLevels.length > 0, 'scheduler must drive the music bus gain');
    assert.ok(
      musicCtx.busLevels.every((v) => v === 0),
      `muted: every bus level 0, got [${musicCtx.busLevels.join(',')}]`
    );
    stopEngine(engine);
  });

  await test('music: master/music volume honored via audioManager.getVolume', () => {
    const am = { isMuted: () => false, getVolume: () => ({ master: 0.5, music: 0.5 }) };
    const { engine, musicCtx } = loadMusic({ audioContext: true, audioManager: am });
    engine.start();
    engine._debug.tick();
    const last = musicCtx.busLevels[musicCtx.busLevels.length - 1];
    assert.ok(
      Math.abs(last - 0.5 * 0.5 * 0.6) < 1e-9,
      `bus level = master*music*0.6 = 0.15, got ${last}`
    );
    stopEngine(engine);
  });

  await test('music: conservative default when audioManager is absent', () => {
    const { engine, musicCtx } = loadMusic({ audioContext: true, audioManager: null });
    engine.start();
    engine._debug.tick();
    const last = musicCtx.busLevels[musicCtx.busLevels.length - 1];
    assert.ok(
      Math.abs(last - 0.6) < 1e-9,
      `no audioManager -> level 0.6, got ${last}`
    );
    stopEngine(engine);
  });

  await test('music: subscribes to check/move/checkmate on the bus', () => {
    const stubs = harness.makeStubs();
    stubs.window.addEventListener = () => {};
    harness.loadScript(stubs, BUS);
    const subs = [];
    const bus = stubs.window.GameBus;
    const origOn = bus.on.bind(bus);
    bus.on = (ev, fn) => { subs.push(ev); return origOn(ev, fn); };
    harness.loadScript(stubs, MUSIC);
    for (const ev of ['check', 'move', 'checkmate']) {
      assert.ok(subs.includes(ev), `MusicEngine must subscribe to '${ev}' — got: ${subs.join(',') || '(none)'}`);
    }
    stopEngine(stubs.window.MusicEngine);
  });

  await test('music: pressure heartbeat starts at/below the 30s threshold', () => {
    const hb = { starts: 0, stops: 0 };
    const am = {
      isMuted: () => false, getVolume: () => ({ master: 1, music: 1 }),
      startHeartbeat() { hb.starts++; }, stopHeartbeat() { hb.stops++; },
    };
    const { stubs, engine } = loadMusic({ audioManager: am });
    stubs.window.app = { clocks: { red: 25, black: 300 }, timeMode: '3min', game: { gameOver: false } };
    engine._debug.pressureTick();
    assert.strictEqual(hb.starts, 1, 'heartbeat starts when a clock <= 30s');
    engine._debug.pressureTick();
    assert.strictEqual(hb.starts, 1, 'start is idempotent while pressure persists');
    stubs.window.app.clocks.red = 61;
    engine._debug.pressureTick();
    assert.strictEqual(hb.stops, 1, 'heartbeat stops when pressure ends');
    assert.strictEqual(hb.starts, 1, 'no restart after pressure ends');
    stopEngine(engine);
  });

  await test('music: pressure monitor no-ops without app/clocks/audioManager', () => {
    const hb = { starts: 0, stops: 0 };
    const am = {
      isMuted: () => false, getVolume: () => ({ master: 1, music: 1 }),
      startHeartbeat() { hb.starts++; }, stopHeartbeat() { hb.stops++; },
    };
    const { stubs, engine } = loadMusic({ audioManager: am });
    assert.doesNotThrow(() => {
      delete stubs.window.app;
      engine._debug.pressureTick(); // no app
      stubs.window.app = { timeMode: '3min', game: {} };
      engine._debug.pressureTick(); // no clocks
      stubs.window.app = { clocks: { red: 5, black: 5 }, timeMode: 'unlimited', game: {} };
      engine._debug.pressureTick(); // unlimited mode
      stubs.window.app = { clocks: { red: 5, black: 5 }, timeMode: '3min', game: { gameOver: true } };
      engine._debug.pressureTick(); // game over
      stubs.window.app = { clocks: { red: 5, black: 5 }, timeMode: '3min', game: {} };
      delete stubs.window.audioManager;
      engine._debug.pressureTick(); // no audioManager
    }, 'pressure monitor must never throw');
    assert.strictEqual(hb.starts + hb.stops, 0, 'no heartbeat activity in any no-op case');
    stopEngine(engine);
  });

  // ----------------------------------------------------------- river-fx ---
  needLanded(RIVER, 'js/river-fx.js (W3)');

  // Self-chaining recording 2d context: any method call returns the ctx so
  // chained canvas calls never throw.
  function makeRecCtx() {
    const calls = [];
    const ctx = new Proxy({}, {
      get(t, k) {
        if (k === '__calls') return calls;
        return (...a) => { calls.push(String(k)); return ctx; };
      },
      set(t, k, v) { t[k] = v; return true; },
    });
    return { ctx, calls };
  }

  function loadRiver({ intensity = 'low' } = {}) {
    const stubs = harness.makeStubs();
    harness.loadScript(stubs, BUS);
    const subs = [];
    const bus = stubs.window.GameBus;
    const origOn = bus.on.bind(bus);
    bus.on = (ev, fn) => { subs.push(ev); return origOn(ev, fn); };
    stubs.window.effectsManager = { intensity };
    const rec = makeRecCtx();
    const canvasEl = {
      id: '', style: {}, clientWidth: 300, clientHeight: 40, width: 0, height: 0,
      getContext: () => rec.ctx,
    };
    const outerEl = {
      querySelector: () => null,
      appendChild() {}, insertBefore() {},
    };
    const doc = {
      readyState: 'complete',
      createElement: (tag) => (tag === 'canvas' ? canvasEl : { style: {}, appendChild() {} }),
      getElementById: (id) => (id === 'boardOuter' ? outerEl : null),
      addEventListener() {},
      body: { appendChild() {} },
    };
    stubs.window.document = doc;
    stubs.window.addEventListener = () => {};
    harness.loadScript(stubs, RIVER, { document: doc });
    const RiverFX = stubs.window.RiverFX;
    assert.ok(RiverFX, `window.RiverFX must be assigned by js/river-fx.js — got: ${Object.keys(stubs.window).join(',')}`);
    return { stubs, bus, subs, rec, doc, canvasEl, RiverFX };
  }

  await test('river-fx: subscribes to soldierCrossRiver', () => {
    const { subs } = loadRiver();
    assert.ok(
      subs.includes('soldierCrossRiver'),
      `RiverFX must subscribe to 'soldierCrossRiver' — subscribed: ${subs.join(',') || '(none)'}`
    );
  });

  await test('river-fx: soldierCrossRiver queues splash ripples (low: static, no loop)', () => {
    const { bus, RiverFX } = loadRiver({ intensity: 'low' });
    assert.doesNotThrow(() => {
      bus.emit('soldierCrossRiver', { from: { r: 6, c: 4 }, to: { r: 5, c: 4 }, piece: 'P', side: 'red' });
    }, 'soldierCrossRiver handler must not throw');
    assert.strictEqual(
      RiverFX._debug.state().rippleCount, 3,
      `splash must queue 3 ripples, got ${RiverFX._debug.state().rippleCount}`
    );
    assert.strictEqual(RiverFX._debug.state().loopRunning, false, 'low intensity: no animation loop');
  });

  await test('river-fx: splash guards — bad cell -> false; off -> no-op + canvas hidden', () => {
    const { RiverFX, canvasEl } = loadRiver({ intensity: 'low' });
    assert.strictEqual(RiverFX.splash(null), false, 'splash(null) -> false');
    assert.strictEqual(RiverFX.splash({ r: 'x' }), false, 'splash with bad cell -> false');
    RiverFX.setIntensity('bogus');
    assert.strictEqual(RiverFX._debug.state().intensity, 'low', 'invalid intensity ignored');
    RiverFX.setIntensity('off');
    assert.strictEqual(RiverFX._debug.state().intensity, 'off', 'off accepted');
    assert.strictEqual(canvasEl.style.display, 'none', 'canvas hidden at off');
    assert.strictEqual(RiverFX.splash({ r: 4, c: 4 }), false, 'splash at off -> false');
  });

  // --------------------------------------- announcer sting removed --------
  needLanded(AUDIO, 'js/audio-manager.js');

  await test('announcer sting removed: audioManager no longer exposes playAnnouncementSting', () => {
    const stubs = harness.makeStubs();
    const music = makeMusicContext();
    stubs.window.AudioContext = function () { return music.ctx; };
    harness.loadScript(stubs, BUS);
    harness.loadScript(stubs, AUDIO, { sfx: { tick: { volume: () => 0.4, play() {} } } });
    const AM = stubs.window.audioManager;
    assert.ok(AM, 'window.audioManager must be assigned');
    assert.strictEqual(AM.playAnnouncementSting, undefined,
      'playAnnouncementSting was removed with the announcer popups');
  });

  await test('announcer sting removed: bridge never calls playAnnouncementSting()', () => {
    needLanded(BRIDGE, 'js/effects-bridge.js');
    const raw = fs.readFileSync(BRIDGE, 'utf8');
    // Strip comments so doc mentions don't shadow a real call site.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(
      src.indexOf('playAnnouncementSting()') < 0,
      'effects-bridge.js must NOT call playAnnouncementSting() (announcer popups removed per user request)'
    );
  });

  console.log(`\nmusic tests: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ' — ALL PASSED'}`);
})().catch((err) => {
  console.error('music tests FAILED:');
  console.error(err);
  process.exit(1);
});
