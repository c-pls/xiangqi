'use strict';
/**
 * tests/harness.js — QA-owned test harness for the Phase 1 effects system (W4a + W4b).
 *
 * Loads a browser-oriented <script> file (plain script: NO import/export) in a
 * Node sandbox so that `window.*` assignments land on a stub `window` object.
 *
 * Each test runs as:  node tests/<name>.test.js   (from the sandbox root)
 * A failing assertion throws -> process exits non-zero.
 *
 * Contract for scripts under test:
 *  - assign explicitly to `window` (e.g. `window.GameBus = {...}`)
 *  - touch ONLY the injected globals: window, localStorage, Howler, gsap,
 *    matchMedia, sfx, document, navigator
 *  - plain script syntax; ES module syntax (import/export) is NOT supported here
 *
 * W4b notes:
 *  - js/audio-manager.js deliberately FAIL-CLOSES when the vfx.js `sfx` map is
 *    unavailable (`typeof sfx === 'undefined'` -> throws, so window.audioManager
 *    is never assigned — by design, keep it). Tests loading audio-manager.js
 *    MUST pass an sfx stub via loadScript(stubs, path, { sfx: {...} }), e.g.
 *    { boom: { volume(){}, play(){} } }.
 *  - js/audio-manager.js reads `window.localStorage` (not the bare global), so
 *    makeStubs() attaches the localStorage stub onto window.
 *  - js/effects-bridge.js binds UI via document.getElementById guarded by
 *    try/catch + typeof checks; tests may pass a stub document via
 *    loadScript(stubs, path, { document: {...} }). When omitted, `document`
 *    stays undefined inside the sandbox so the guard path is exercised.
 */
const fs = require('fs');

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      const k = String(key);
      return store.has(k) ? store.get(k) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
    key(i) {
      const keys = [...store.keys()];
      return i >= 0 && i < keys.length ? keys[i] : null;
    },
    get length() {
      return store.size;
    },
  };
}

function makeStubs() {
  const localStorage = makeLocalStorage();
  const win = {};
  // audio-manager.js reads `window.localStorage` (not the bare global).
  win.localStorage = localStorage;
  return {
    window: win,
    localStorage,
    Howler: {
      _volume: 1,
      volume(v) {
        if (typeof v === 'number') this._volume = Math.min(1, Math.max(0, v));
        return this._volume;
      },
    },
    gsap: {
      globalTimeline: { getChildren: () => [] },
    },
    matchMedia: () => ({
      matches: false,
      addListener() {},
      removeListener() {},
    }),
    // vfx.js `sfx` Howl-map stand-in; tests override per-load via opts.sfx.
    sfx: {},
  };
}

/**
 * Read a script file and execute it with the stub globals injected as
 * parameters, so `window.X = ...` lands on stubs.window.
 * opts: { sfx, document, navigator } — each injected only when provided;
 *   sfx defaults to stubs.sfx; document/navigator default to undefined.
 * Returns stubs.window for convenience.
 */
function loadScript(stubs, absPath, opts) {
  opts = opts || {};
  const code = fs.readFileSync(absPath, 'utf8');
  const runner = new Function(
    'window', 'localStorage', 'Howler', 'gsap', 'matchMedia',
    'sfx', 'document', 'navigator',
    code
  );
  runner(
    stubs.window,
    stubs.localStorage,
    stubs.Howler,
    stubs.gsap,
    stubs.matchMedia,
    opts.sfx !== undefined ? opts.sfx : stubs.sfx,
    opts.document !== undefined ? opts.document : stubs.document,
    opts.navigator !== undefined ? opts.navigator : stubs.navigator
  );
  return stubs.window;
}

module.exports = { makeStubs, makeLocalStorage, loadScript };
