'use strict';
/**
 * tests/phase5-w3.test.js — W3 (audio/ambience) Phase 5 unit tests.
 *
 * Covers:
 *  1. js/music.js — API surface; GameBus 'check' -> intensity 1,
 *     'move' -> baseline; setIntensity clamps; mute honored (bus gain 0);
 *     time-pressure monitor: heartbeat starts at/below the documented 30s
 *     threshold (fake window.app clocks), stops when pressure ends, no-ops
 *     without window.app/clocks/audioManager.
 *  2. js/audio-manager.js — playAnnouncementSting(): two synth notes, honors
 *     mute.
 *  3. js/effects-bridge.js — haptics: capture -> 40ms, check -> double pulse,
 *     checkmate -> longer pattern; never throws without navigator.vibrate;
 *     silent at intensity 'off'.
 *  4. js/effects-bridge.js — announcer sting gating: _showAnnouncement plays
 *     the sting at 'full' only (silent at 'low'/'off' by documented choice).
 *  5. js/effects-bridge.js — idle class: body.fx-idle-on at full/low, off at
 *     'off' and under prefers-reduced-motion.
 *  6. js/hall-of-fame.js — no-ops without DOM/canvas/modal; injects the
 *     snapshot button when the modal opens; saveSnapshot composites and
 *     downloads.
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/phase5-w3.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const MUSIC = path.join(ROOT, 'js', 'music.js');
const AUDIO = path.join(ROOT, 'js', 'audio-manager.js');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');
const HOF = path.join(ROOT, 'js', 'hall-of-fame.js');
const RIVER = path.join(ROOT, 'js', 'river-fx.js');

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

function paramStub() {
  return { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
}

// Stub Web Audio context; counts oscillators and records music-bus levels.
function makeAudioContext() {
  const busLevels = [];
  const ctx = {
    createdOsc: 0,
    state: 'running',
    currentTime: 1000,
    destination: {},
    resume() {},
    createOscillator() {
      ctx.createdOsc++;
      return {
        type: 'sine', frequency: paramStub(), detune: paramStub(),
        connect() {}, disconnect() {}, start() {}, stop() {},
      };
    },
    createGain() {
      return {
        gain: {
          value: 0,
          setTargetAtTime(v) { busLevels.push(v); },
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {}, disconnect() {},
      };
    },
    createBiquadFilter() {
      return { type: 'lowpass', frequency: paramStub(), Q: paramStub(), connect() {} };
    },
  };
  return { ctx, busLevels };
}

const SFX_STUB = {
  tick: { volume: () => 0.4, play() {} },
};

function makeDocument() {
  const appended = [];
  const classes = new Set();
  function makeEl(tag) {
    return {
      tagName: String(tag).toUpperCase(),
      className: '',
      textContent: '',
      style: {},
      children: [],
      removed: false,
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        toggle: (c, force) => {
          if (force === undefined) {
            if (classes.has(c)) classes.delete(c); else classes.add(c);
          } else if (force) classes.add(c); else classes.delete(c);
        },
        contains: (c) => classes.has(c),
      },
      appendChild(c) { this.children.push(c); appended.push(c); return c; },
      remove() { this.removed = true; },
      addEventListener() {},
      click() { this.clicked = true; },
    };
  }
  const body = makeEl('body');
  return {
    appended, body, classes,
    createElement: (t) => makeEl(t),
    getElementById: () => null,
    querySelector: () => null,
  };
}

function loadMusic({ muted = false, volumes = null } = {}) {
  const stubs = harness.makeStubs();
  const { ctx, busLevels } = makeAudioContext();
  stubs.window.AudioContext = function () { return ctx; };
  stubs.window.addEventListener = () => {};
  const am = {
    _muted: muted,
    _vol: volumes || { master: 0.8, sfx: 1, music: 0.7 },
    isMuted() { return this._muted; },
    getVolume() { return this._vol; },
    hbStarts: 0, hbStops: 0,
    startHeartbeat() { this.hbStarts++; },
    stopHeartbeat() { this.hbStops++; },
  };
  stubs.window.audioManager = am;
  harness.loadScript(stubs, BUS);
  harness.loadScript(stubs, MUSIC);
  const engine = stubs.window.MusicEngine;
  assert.ok(engine, 'window.MusicEngine assigned');
  return { stubs, engine, am, busLevels, ctx };
}

function loadBridge({ navigatorStub, matchMediaMatches = false, documentStub } = {}) {
  const stubs = harness.makeStubs();
  stubs.window.matchMedia = () => ({ matches: matchMediaMatches });
  harness.loadScript(stubs, BUS);
  const doc = documentStub || makeDocument();
  const stingCalls = [];
  stubs.window.audioManager = {
    play() {},
    playAnnouncementSting() { stingCalls.push(Date.now()); },
  };
  const opts = { document: doc };
  if (navigatorStub !== undefined) opts.navigator = navigatorStub;
  harness.loadScript(stubs, BRIDGE, opts);
  const manager = stubs.window.effectsManager;
  assert.ok(manager, 'window.effectsManager assigned');
  return { stubs, doc, manager, stingCalls };
}

(async () => {
  // ------------------------------------------------------------ music -----
  await test('music: API surface and documented threshold', async () => {
    const { engine } = loadMusic();
    for (const m of ['start', 'stop', 'setIntensity', 'reset']) {
      assert.strictEqual(typeof engine[m], 'function', m + ' exposed');
    }
    assert.strictEqual(engine.PRESSURE_THRESHOLD_S, 30, 'threshold documented as 30s');
    engine.stop();
    engine._debug.stopPressureWatch();
  });

  await test('music: intensity follows check/move events', async () => {
    const { stubs, engine } = loadMusic();
    engine.start();
    assert.strictEqual(engine._debug.state().targetIntensity, 0.35, 'baseline at start');
    stubs.window.GameBus.emit('check', {});
    assert.strictEqual(engine._debug.state().targetIntensity, 1, 'check -> 1');
    stubs.window.GameBus.emit('move', {});
    assert.strictEqual(engine._debug.state().targetIntensity, 0.35, 'move -> baseline');
    engine.setIntensity(2);
    assert.strictEqual(engine._debug.state().targetIntensity, 1, 'clamped high');
    engine.setIntensity(-1);
    assert.strictEqual(engine._debug.state().targetIntensity, 0, 'clamped low');
    engine.reset();
    assert.strictEqual(engine._debug.state().targetIntensity, 0.35, 'reset -> baseline');
    engine.stop();
    engine._debug.stopPressureWatch();
  });

  await test('music: honors mute (bus gain driven to 0)', async () => {
    const env = loadMusic({ muted: true });
    env.engine.start();
    env.engine._debug.tick();
    assert.ok(env.busLevels.length > 0, 'bus level was set');
    assert.ok(env.busLevels.every((v) => v === 0), 'all bus levels are 0 when muted');
    env.engine.stop();
    env.engine._debug.stopPressureWatch();
  });

  await test('music: honors master/music volume when unmuted', async () => {
    const env = loadMusic({ muted: false, volumes: { master: 0.5, sfx: 1, music: 0.5 } });
    env.engine.start();
    env.engine._debug.tick();
    const last = env.busLevels[env.busLevels.length - 1];
    assert.ok(Math.abs(last - 0.5 * 0.5 * 0.6) < 1e-9, 'bus = master*music*0.6, got ' + last);
    env.engine.stop();
    env.engine._debug.stopPressureWatch();
  });

  await test('music: pressure heartbeat starts/stops at the 30s threshold', async () => {
    const { stubs, engine, am } = loadMusic();
    stubs.window.app = {
      clocks: { red: 25, black: 300 },
      timeMode: '3min',
      game: { gameOver: false },
    };
    engine._debug.pressureTick();
    assert.strictEqual(am.hbStarts, 1, 'heartbeat started under threshold');
    engine._debug.pressureTick();
    assert.strictEqual(am.hbStarts, 1, 'start is idempotent while pressure persists');
    stubs.window.app.clocks.red = 61;
    engine._debug.pressureTick();
    assert.strictEqual(am.hbStops, 1, 'heartbeat stopped when pressure ends');
    engine._debug.stopPressureWatch();
  });

  await test('music: pressure monitor no-ops without app/clocks/audioManager', async () => {
    const { stubs, engine } = loadMusic();
    delete stubs.window.app;
    engine._debug.pressureTick(); // must not throw
    stubs.window.app = { timeMode: '3min', game: {} }; // clocks absent
    engine._debug.pressureTick();
    stubs.window.app = { clocks: { red: 5, black: 5 }, timeMode: 'unlimited', game: {} };
    engine._debug.pressureTick(); // unlimited -> no pressure
    stubs.window.app = {
      clocks: { red: 5, black: 5 }, timeMode: '3min', game: { gameOver: true },
    };
    engine._debug.pressureTick(); // game over -> no pressure
    delete stubs.window.audioManager;
    stubs.window.app = { clocks: { red: 5, black: 5 }, timeMode: '3min', game: {} };
    engine._debug.pressureTick(); // no audioManager -> silent no-op
    engine._debug.stopPressureWatch();
  });

  // ------------------------------------------------------ announcer sting --
  await test('audio-manager: playAnnouncementSting removed with the announcer popups', async () => {
    const stubs = harness.makeStubs();
    const { ctx } = makeAudioContext();
    stubs.window.AudioContext = function () { return ctx; };
    harness.loadScript(stubs, AUDIO, { sfx: SFX_STUB });
    const am = stubs.window.audioManager;
    assert.ok(am, 'audioManager loaded');
    assert.strictEqual(am.playAnnouncementSting, undefined,
      'sting entry point removed; nothing can trigger it');
  });

  // ------------------------------------------------------------ haptics ----
  await test('haptics: capture/check/checkmate patterns', async () => {
    const calls = [];
    const env = loadBridge({ navigatorStub: { vibrate: (p) => calls.push(p) } });
    env.manager.setIntensity('full');
    env.stubs.window.GameBus.emit('capture', {
      attacker: 'R', victim: 'P', side: 'red', from: { r: 9, c: 0 }, to: { r: 9, c: 4 },
      commit: () => {},
    });
    assert.deepStrictEqual(calls[0], 40, 'capture -> 40ms pulse');
    env.stubs.window.GameBus.emit('check', { pieceKey: 'R', side: 'red' });
    assert.deepStrictEqual(calls[1], [30, 60, 30], 'check -> double pulse');
    env.stubs.window.GameBus.emit('checkmate', { reason: 'checkmate' });
    assert.deepStrictEqual(calls[2], [60, 80, 60, 80, 120], 'checkmate -> longer pattern');
  });

  await test('haptics: never throws without navigator.vibrate', async () => {
    const env = loadBridge({ navigatorStub: undefined });
    env.manager.setIntensity('full');
    env.stubs.window.GameBus.emit('capture', {
      attacker: 'R', victim: 'P', side: 'red', from: { r: 9, c: 0 }, to: { r: 9, c: 4 },
      commit: () => {},
    });
    env.stubs.window.GameBus.emit('check', { pieceKey: 'R', side: 'red' });
    env.stubs.window.GameBus.emit('checkmate', { reason: 'checkmate' });
    // no navigator at all
    const env2 = loadBridge({});
    env2.manager.setIntensity('full');
    env2.stubs.window.GameBus.emit('check', { pieceKey: 'R', side: 'red' });
  });

  await test('haptics: silent at intensity off', async () => {
    const calls = [];
    const env = loadBridge({ navigatorStub: { vibrate: (p) => calls.push(p) } });
    env.manager.setIntensity('off');
    env.stubs.window.GameBus.emit('capture', {
      attacker: 'R', victim: 'P', side: 'red', from: { r: 9, c: 0 }, to: { r: 9, c: 4 },
      commit: () => {},
    });
    env.stubs.window.GameBus.emit('check', { pieceKey: 'R', side: 'red' });
    env.stubs.window.GameBus.emit('checkmate', { reason: 'checkmate' });
    assert.strictEqual(calls.length, 0, 'no haptics at off');
  });

  // ------------------------------------------- sting removed (announcer) ---
  await test('sting removed: no _showAnnouncement, capture plays no sting', async () => {
    const env = loadBridge({});
    assert.strictEqual(typeof env.manager._showAnnouncement, 'undefined',
      '_showAnnouncement was removed with the announcer popups');
    env.manager.setIntensity('full');
    env.stubs.window.GameBus.emit('capture', {
      attacker: 'R', victim: 'P', side: 'red', from: { r: 9, c: 0 }, to: { r: 9, c: 4 },
      commit: () => {},
    });
    assert.strictEqual(env.stingCalls.length, 0, 'no sting on capture after removal');
  });

  // -------------------------------------------------------- idle class -----
  await test('idle: body.fx-idle-on follows intensity, off under reduced motion', async () => {
    const env = loadBridge({});
    assert.ok(env.doc.classes.has('fx-idle-on'), 'on at default full');
    env.manager.setIntensity('low');
    assert.ok(env.doc.classes.has('fx-idle-on'), 'on at low');
    env.manager.setIntensity('off');
    assert.ok(!env.doc.classes.has('fx-idle-on'), 'off at off');
    env.manager.setIntensity('full');
    assert.ok(env.doc.classes.has('fx-idle-on'), 'back on at full');
    const envRm = loadBridge({ matchMediaMatches: true });
    assert.ok(!envRm.doc.classes.has('fx-idle-on'), 'forced off under reduced motion');
  });

  // -------------------------------------------------------- hall of fame ---
  function loadHof({ documentStub } = {}) {
    const stubs = harness.makeStubs();
    harness.loadScript(stubs, BUS);
    const opts = {};
    if (documentStub !== undefined) opts.document = documentStub;
    harness.loadScript(stubs, HOF, opts);
    const hof = stubs.window.HallOfFame;
    assert.ok(hof, 'window.HallOfFame assigned');
    return { stubs, hof };
  }

  await test('hall-of-fame: clean no-ops without DOM/canvas/modal', async () => {
    const { hof } = loadHof({}); // no document
    assert.strictEqual(hof.injectButton(), false, 'inject without modal -> false');
    assert.strictEqual(hof.saveSnapshot(), false, 'snapshot without canvas -> false');
    assert.deepStrictEqual(hof.collectCanvases(), [], 'no canvases collected');
    const { hof: hof2 } = loadHof({ documentStub: makeDocument() });
    assert.strictEqual(hof2.injectButton(), false, 'inject without modal el -> false');
    assert.strictEqual(hof2.saveSnapshot(), false, 'snapshot without source canvas -> false');
  });

  await test('hall-of-fame: injects button into the modal card when it opens', async () => {
    const doc = makeDocument();
    const cardChildren = [];
    const card = {
      appendChild(c) { cardChildren.push(c); return c; },
      insertBefore(c) { cardChildren.push(c); return c; },
    };
    const modalClasses = new Set();
    const modal = {
      classList: {
        add: (c) => modalClasses.add(c),
        contains: (c) => modalClasses.has(c),
      },
      querySelector: () => card,
    };
    let injectedBtn = null;
    doc.getElementById = (id) => {
      if (id === 'gameOverModal') return modal;
      if (id === 'hofSnapshotBtn') return injectedBtn;
      return null;
    };
    const origCreate = doc.createElement;
    doc.createElement = (t) => {
      const el = origCreate(t);
      if (t === 'button') {
        const prevAdd = el.addEventListener;
        el.addEventListener = prevAdd;
      }
      return el;
    };
    const { stubs, hof } = loadHof({ documentStub: doc });
    // Simulate the modal opening via the checkmate flow with a MutationObserver stub.
    global.MutationObserver = function (cb) { this.cb = cb; };
    global.MutationObserver.prototype.observe = function () {
      modalClasses.add('open');
      this.cb();
    };
    global.MutationObserver.prototype.disconnect = function () {};
    try {
      stubs.window.GameBus.emit('checkmate', { reason: 'checkmate' });
      const btn = doc.getElementById('hofSnapshotBtn');
      // The stub document does not track the button id; verify via card children.
      assert.ok(cardChildren.length === 1, 'one button injected into the modal card');
      injectedBtn = cardChildren[0];
      assert.ok(/snapshot/i.test(injectedBtn.textContent), 'button is the snapshot button');
      assert.strictEqual(hof.injectButton(), true, 'idempotent: second inject is a no-op true');
      assert.strictEqual(cardChildren.length, 1, 'no duplicate button');
    } finally {
      delete global.MutationObserver;
    }
  });

  await test('hall-of-fame: saveSnapshot composites canvases and downloads', async () => {
    const doc = makeDocument();
    const drawn = [];
    const fxCanvas = {
      width: 300, height: 200,
      getContext: () => ({}),
    };
    const ctx2d = {
      fillRect() {},
      drawImage(c) { drawn.push(c); },
    };
    const offscreen = {
      width: 0, height: 0,
      getContext: () => ctx2d,
      toDataURL: () => 'data:image/png;base64,AAA',
    };
    let clicked = null;
    const anchor = { click() { clicked = this.href; }, remove() {} };
    doc.getElementById = (id) => {
      if (id === 'fxCanvas') return fxCanvas;
      if (id === 'fxCanvas3D') return null;
      if (id === 'boardOuter') return { getBoundingClientRect: () => ({ width: 400, height: 450 }) };
      return null;
    };
    doc.createElement = (t) => {
      if (t === 'canvas') return offscreen;
      if (t === 'a') return anchor;
      return makeDocument().createElement(t);
    };
    doc.body = { appendChild() {} };
    const { hof } = loadHof({ documentStub: doc });
    assert.deepStrictEqual(hof.collectCanvases(), [fxCanvas], 'fxCanvas collected');
    assert.strictEqual(hof.saveSnapshot(), true, 'snapshot succeeded');
    assert.deepStrictEqual(drawn, [fxCanvas], 'source canvas drawn into composite');
    assert.ok(clicked && clicked.indexOf('data:image/png') === 0, 'download triggered');
    assert.strictEqual(offscreen.width, 400, 'composite sized to board');
    assert.strictEqual(anchor.download, 'antigravity-checkmate.png', 'download filename');
  });

  // ------------------------------------------------------------- river ------
  function loadRiver({ documentStub, matchMediaMatches = false } = {}) {
    const stubs = harness.makeStubs();
    stubs.window.matchMedia = () => ({ matches: matchMediaMatches });
    harness.loadScript(stubs, BUS);
    const opts = {};
    if (documentStub !== undefined) opts.document = documentStub;
    harness.loadScript(stubs, RIVER, opts);
    const river = stubs.window.RiverFX;
    assert.ok(river, 'window.RiverFX assigned');
    return { stubs, river };
  }

  await test('river-fx: no-ops cleanly without DOM', async () => {
    const { river } = loadRiver({});
    assert.strictEqual(river.splash({ r: 4, c: 4 }), false, 'splash without canvas -> false');
    river.setIntensity('bogus');
    assert.strictEqual(river._debug.state().intensity, 'full', 'invalid intensity ignored');
    river.setIntensity('off');
    assert.strictEqual(river._debug.state().intensity, 'off', 'off accepted');
  });

  await test('river-fx: splash ripples on soldierCrossRiver at full', async () => {
    const ctx2d = {
      clearRect() {}, beginPath() {}, moveTo() {}, bezierCurveTo() {},
      stroke() {}, fill() {}, arc() {}, ellipse() {},
      createRadialGradient() { return { addColorStop() {} }; },
    };
    Object.defineProperty(ctx2d, 'strokeStyle', { set() {} });
    Object.defineProperty(ctx2d, 'fillStyle', { set() {} });
    Object.defineProperty(ctx2d, 'lineWidth', { set() {} });
    const canvasEl = {
      id: '', style: {},
      clientWidth: 300, clientHeight: 40, width: 0, height: 0,
      getContext: () => ctx2d,
    };
    const outer = {
      children: [],
      querySelector: () => null,
      appendChild(c) { this.children.push(c); return c; },
      insertBefore(c) { this.children.push(c); return c; },
    };
    const doc = makeDocument();
    doc.getElementById = (id) => (id === 'boardOuter' ? outer : null);
    doc.createElement = (t) => (t === 'canvas' ? canvasEl : makeDocument().createElement(t));
    const { stubs, river } = loadRiver({ documentStub: doc });
    river.setIntensity('full');
    assert.ok(river._debug.state().hasCanvas, 'canvas created under boardOuter');
    stubs.window.GameBus.emit('soldierCrossRiver', { to: { r: 4, c: 4 }, move: {} });
    assert.strictEqual(river._debug.state().rippleCount, 3, 'three ripples queued');
    assert.strictEqual(river.splash({ r: 5, c: 0 }), true, 'manual splash works');
    assert.strictEqual(river.splash(null), false, 'splash with bad cell -> false');
    river.setIntensity('off'); // stop the rAF loop so the process can exit
    assert.strictEqual(river._debug.state().loopRunning, false, 'loop stopped at off');
    assert.strictEqual(river.splash({ r: 4, c: 4 }), false, 'splash at off -> false');
  });

  await test('river-fx: reduced-motion renders a static wash, no loop', async () => {
    const painted = [];
    const ctx2d = {
      clearRect() { painted.push('clear'); },
      beginPath() {}, moveTo() {}, bezierCurveTo() {},
      stroke() { painted.push('stroke'); }, fill() {}, arc() {}, ellipse() {},
      createRadialGradient() { return { addColorStop() {} }; },
    };
    Object.defineProperty(ctx2d, 'strokeStyle', { set() {} });
    Object.defineProperty(ctx2d, 'fillStyle', { set() {} });
    Object.defineProperty(ctx2d, 'lineWidth', { set() {} });
    const canvasEl = {
      id: '', style: {},
      clientWidth: 300, clientHeight: 40, width: 0, height: 0,
      getContext: () => ctx2d,
    };
    const outer = {
      querySelector: () => null,
      appendChild(c) { return c; },
      insertBefore(c) { return c; },
    };
    const doc = makeDocument();
    doc.getElementById = (id) => (id === 'boardOuter' ? outer : null);
    doc.createElement = (t) => (t === 'canvas' ? canvasEl : makeDocument().createElement(t));
    const { river } = loadRiver({ documentStub: doc, matchMediaMatches: true });
    assert.ok(painted.length > 0, 'static wash painted once');
    assert.strictEqual(river._debug.state().loopRunning, false, 'no animation loop');
    assert.strictEqual(river.splash({ r: 4, c: 4 }), false, 'splash no-op under reduced motion');
  });

  console.log(`\n${passed} tests passed`);
})();
