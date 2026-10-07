'use strict';
/**
 * tests/debug-panel.test.js — QA (W4) tests for the Phase 5 debug panel (W2).
 *
 * Debug panel covers (PINNED to the W2 actual API, verified 2026-10-06):
 *  - window.FxDebug.trigger(piece, event) dispatches the correct bus events
 *    with plausible payloads ('capture' / 'check' / 'checkmate').
 *  - The panel is hidden by default; `?fxdebug=1` reveals it;
 *    Shift+Alt+D toggles it.
 *  - Exactly ONE range slider: the slow-mo factor in percent (5..100),
 *    driving window.SlowMo via FxDebug.setSlowMo(f) (f>=1 -> reset(),
 *    f<1 -> begin({minScale:f, downMs:300})).
 *  - Intensity is a <select id="fxDebugIntensity"> (follow/full/low/off)
 *    driving FxDebug.setIntensityOverride(v); 'follow' restores the
 *    pre-override intensity; invalid values rejected. There is NO shake/
 *    trauma control anywhere (binding decision).
 * NOTE (2026-10-06): the hall-of-fame snapshot module (W3) was removed per
 * user request — the "Save board snapshot" button no longer exists.
 *
 * QA CONTRACT v1 (assumptions — flagged to the Phase 5 manager for W2/W3 alignment):
 *  - js/debug-panel.js assigns `window.FxDebug` with trigger(piece, eventName),
 *    setSlowMo(f), setIntensityOverride(v) (pinned 2026-10-06).
 *  - One <input type=range> (slow-mo percent); intensity is a <select>
 *    driving setIntensityOverride; no shake/trauma controls.
 *
 * Exit codes: 0 = pass, 1 = fail, 3 = implementation not landed yet.
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/debug-panel.test.js
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const PANEL = path.join(ROOT, 'js', 'debug-panel.js');

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

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    _listeners: {},
    _clicked: 0,
    id: '', className: '', textContent: '', innerHTML: '',
    value: '', type: '', checked: false, href: '',
    setAttribute(k, v) { el['attr:' + k] = String(v); },
    getAttribute(k) { return el['attr:' + k] !== undefined ? el['attr:' + k] : null; },
    appendChild(c) { el.children.push(c); return c; },
    addEventListener(t, fn) { (el._listeners[t] = el._listeners[t] || []).push(fn); },
    removeEventListener() {},
    click() { el._clicked++; },
    fire(t, ev) { (el._listeners[t] || []).forEach((fn) => fn(ev || { target: el })); },
  };
  return el;
}

function makeDocument() {
  const created = [];
  const listeners = {};
  const body = makeElement('body');
  const doc = {
    created, listeners, body,
    createElement(tag) { const el = makeElement(tag); created.push(el); return el; },
    createElementNS(ns, tag) { const el = makeElement(tag); created.push(el); return el; },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    documentElement: makeElement('html'),
    head: makeElement('head'),
  };
  return doc;
}

// Recording window: key listeners + location.search.
function makeWindow(search) {
  const listeners = {};
  return {
    listeners,
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    location: { search: search || '', href: 'http://localhost/' + (search || '') },
    innerWidth: 1024, innerHeight: 768,
  };
}

function fireKey(win, doc, ev) {
  const full = Object.assign({ key: 'D', code: 'KeyD', keyCode: 68, shiftKey: true, altKey: true, preventDefault() {} }, ev);
  (win.listeners.keydown || []).forEach((fn) => fn(full));
  (doc.listeners.keydown || []).forEach((fn) => fn(full));
}

function withLocation(search, fn) {
  const prev = globalThis.location;
  globalThis.location = { search, href: 'http://localhost/' + search };
  try { fn(); } finally {
    if (prev === undefined) delete globalThis.location;
    else globalThis.location = prev;
  }
}

function loadPanel(search) {
  const stubs = harness.makeStubs();
  const winExtra = makeWindow(search);
  Object.assign(stubs.window, winExtra);
  stubs.window.__winListeners = winExtra.listeners;
  harness.loadScript(stubs, BUS);
  const doc = makeDocument();
  stubs.window.document = doc;
  const slowmoCalls = [];
  stubs.window.SlowMo = new Proxy(
    {
      _scale: 1,
      isActive: () => false,
      begin(opts) { return opts; },
      reset() {},
    },
    {
      get(t, k) {
        const v = t[k];
        if (typeof v === 'function') return (...a) => { slowmoCalls.push([k, ...a]); return v.apply(t, a); };
        return v;
      },
      set(t, k, v) { slowmoCalls.push(['set:' + String(k), v]); t[k] = v; return true; },
    }
  );
  const intensityCalls = [];
  stubs.window.effectsManager = new Proxy(
    { intensity: 'full' },
    {
      get(t, k) {
        if (k === 'setIntensity') return (lv) => { intensityCalls.push(lv); t.intensity = lv; };
        return t[k];
      },
      set(t, k, v) { t[k] = v; return true; },
    }
  );
  const events = [];
  const bus = stubs.window.GameBus;
  const origEmit = bus.emit.bind(bus);
  bus.emit = (name, payload) => { events.push({ name, payload }); return origEmit(name, payload); };
  withLocation(search || '', () => {
    harness.loadScript(stubs, PANEL, { document: doc });
  });
  const FxDebug = stubs.window.FxDebug;
  assert.ok(FxDebug, 'window.FxDebug must be assigned by js/debug-panel.js');
  return { stubs, doc, winExtra, FxDebug, events, slowmoCalls, intensityCalls };
}

function findPanel(doc) {
  return doc.created.find((el) =>
    /debug|fxdbg|fx-debug/i.test(el.id || '') ||
    /debug|fxdbg/i.test(el.className || '') ||
    el.style.position === 'fixed'
  ) || null;
}

function findSliders(doc) {
  return doc.created.filter((el) => el.tagName === 'INPUT' && (el.type === 'range' || el.getAttribute('type') === 'range'));
}

// ------------------------------------------------------------------ tests ---

(async () => {
  // ------------------------------------------------------- debug panel ---
  needLanded(PANEL, 'js/debug-panel.js (W2)');

  await test('FxDebug.trigger dispatches bus events with plausible payloads', () => {
    const w = loadPanel('');
    assert.strictEqual(typeof w.FxDebug.trigger, 'function', 'FxDebug.trigger(piece, event) must exist');

    w.FxDebug.trigger('C', 'capture');
    const cap = w.events.find((e) => e.name === 'capture');
    assert.ok(cap, `trigger('C','capture') must emit bus 'capture' — got: ${w.events.map((e) => e.name).join(',') || '(none)'}`);
    assert.strictEqual(cap.payload.attacker, 'C', 'capture payload attacker must be C');
    assert.ok(cap.payload.from && cap.payload.to, 'capture payload needs from/to');

    w.FxDebug.trigger('R', 'check');
    const chk = w.events.find((e) => e.name === 'check');
    assert.ok(chk, `trigger('R','check') must emit bus 'check' — got: ${w.events.map((e) => e.name).join(',')}`);
    const cp = chk.payload;
    assert.ok(cp.pieceKey === 'R' || (cp.move && cp.move.piece === 'R'), 'check payload must identify piece R');
    assert.ok(cp.checkingPieces || cp.checkingPos || cp.generalCell, 'check payload needs checking info');

    w.FxDebug.trigger('K', 'checkmate');
    const mate = w.events.find((e) => e.name === 'checkmate');
    assert.ok(mate, `trigger('K','checkmate') must emit bus 'checkmate' — got: ${w.events.map((e) => e.name).join(',')}`);
    assert.ok(mate.payload.winningPiece === 'K' || mate.payload.pieceKey === 'K', 'checkmate payload must identify K');
    console.log('    events: ' + w.events.map((e) => `${e.name}(${JSON.stringify(e.payload).slice(0, 60)}…)`).join(' | '));
  });

  await test('panel hidden by default; ?fxdebug=1 reveals it; Shift+Alt+D toggles', () => {
    const w = loadPanel('');
    const panel = findPanel(w.doc);
    assert.ok(panel, `debug panel element must be created — created: ${w.doc.created.map((e) => e.tagName + '#' + e.id).join(', ')}`);
    const hidden = panel.style.display === 'none' || panel.hidden === true || panel.getAttribute('hidden') !== null;
    assert.ok(hidden, 'panel must be hidden by default (no ?fxdebug=1)');

    const w2 = loadPanel('?fxdebug=1');
    const panel2 = findPanel(w2.doc);
    assert.ok(panel2, 'panel element must exist with ?fxdebug=1');
    const shown = panel2.style.display !== 'none' && panel2.hidden !== true;
    assert.ok(shown, 'panel must be visible with ?fxdebug=1');

    // Toggle via Shift+Alt+D.
    const before = panel2.style.display;
    fireKey(w2.winExtra, w2.doc);
    const after = panel2.style.display;
    assert.ok(before !== after || panel2.hidden === true || panel2.style.display === 'none',
      `Shift+Alt+D must toggle the panel (display ${before} -> ${after})`);
    console.log(`    toggle: display '${before}' -> '${after}'`);
  });

  await test('slow-mo slider + intensity select drive SlowMo / setIntensity; NO shake controls', () => {
    const w = loadPanel('?fxdebug=1');
    // PINNED (W2 actual): exactly ONE range slider — the slow-mo factor in
    // percent (5..100). Intensity is a <select id="fxDebugIntensity"> driving
    // FxDebug.setIntensityOverride(), NOT a second slider.
    const sliders = findSliders(w.doc);
    assert.strictEqual(sliders.length, 1, `expected exactly 1 range slider (slow-mo), found ${sliders.length}`);
    const slowmo = sliders[0];
    const slowmoLabel = (slowmo.id + ' ' + slowmo.getAttribute('aria-label')).toLowerCase();
    assert.ok(/slow/.test(slowmoLabel), `the range slider must be the slow-mo factor — got '${slowmoLabel}'`);
    assert.strictEqual(slowmo.getAttribute('min'), '5', 'slow-mo slider min 5%');
    assert.strictEqual(slowmo.getAttribute('max'), '100', 'slow-mo slider max 100%');

    slowmo.value = '25';
    slowmo.fire('input', { target: slowmo });
    const beginCall = w.slowmoCalls.find((c) => c[0] === 'begin');
    assert.ok(beginCall, `slow-mo slider must drive window.SlowMo.begin — calls: ${JSON.stringify(w.slowmoCalls)}`);
    assert.ok(Math.abs(beginCall[1].minScale - 0.25) < 1e-9,
      `25% slider -> begin({minScale: 0.25}) — got ${JSON.stringify(beginCall[1])}`);

    // FxDebug.setSlowMo API mapping (documented in js/debug-panel.js header).
    assert.strictEqual(w.FxDebug.setSlowMo(1), true, 'setSlowMo(1) -> real-time');
    assert.ok(w.slowmoCalls.some((c) => c[0] === 'reset'), 'setSlowMo(1) must call SlowMo.reset()');
    assert.strictEqual(w.FxDebug.setSlowMo('loud'), false, 'setSlowMo(non-numeric) rejected');

    // Intensity override: select + API.
    const sel = w.doc.created.find((el) => el.tagName === 'SELECT' && el.id === 'fxDebugIntensity');
    assert.ok(sel, 'panel must have the #fxDebugIntensity select');
    const optValues = sel.children.map((o) => o.getAttribute('value'));
    assert.deepStrictEqual(optValues, ['follow', 'full', 'low', 'off'],
      `intensity options pinned — got ${JSON.stringify(optValues)}`);
    sel.value = 'low';
    sel.fire('change', { target: sel });
    assert.ok(w.intensityCalls.includes('low'),
      `intensity select must call effectsManager.setIntensity('low') — got ${JSON.stringify(w.intensityCalls)}`);

    // setIntensityOverride API: override, restore, reject.
    w.intensityCalls.length = 0;
    assert.strictEqual(w.FxDebug.setIntensityOverride('off'), true);
    assert.ok(w.intensityCalls.includes('off'), 'setIntensityOverride(off) drives the manager');
    assert.strictEqual(w.FxDebug.setIntensityOverride('bogus'), false, 'invalid intensity rejected');
    assert.strictEqual(w.FxDebug.setIntensityOverride('follow'), true, 'follow restores');
    assert.ok(w.intensityCalls.length >= 2, 'follow must restore the pre-override intensity');

    // NO shake/trauma controls: DOM-level…
    const bad = w.doc.created.filter((el) =>
      /shake|trauma/i.test(el.id || '') || /shake|trauma/i.test(el.getAttribute('aria-label') || '')
    );
    assert.strictEqual(bad.length, 0, `panel must have NO shake/trauma controls — found: ${bad.map((e) => e.tagName + '#' + e.id).join(',')}`);
    // …and source-level (comments stripped).
    const src = fs.readFileSync(PANEL, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(!/trauma|shake/i.test(src), 'js/debug-panel.js must not reference trauma/shake (binding decision)');
  });


  console.log(`\ndebug-panel tests: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ' — ALL PASSED'}`);
})().catch((err) => {
  console.error('debug-panel tests FAILED:');
  console.error(err);
  process.exit(1);
});
