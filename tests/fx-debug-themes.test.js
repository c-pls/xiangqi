'use strict';
/**
 * tests/fx-debug-themes.test.js — Phase 5 (W2) verification.
 *
 * Covers js/effect-themes.js and js/debug-panel.js plus the theme wiring in
 * js/check-vfx.js and js/checkmate-vfx.js, using tests/harness.js stubs.
 *
 * Run from the sandbox root:  node tests/fx-debug-themes.test.js
 * A failing assertion throws -> non-zero exit.
 */
const assert = require('assert');
const path = require('path');
const { makeStubs, loadScript } = require('./harness.js');

const JS = path.join(__dirname, '..', 'js');
let passed = 0;
function ok(name, fn) {
    fn();
    passed++;
    console.log('ok - ' + name);
}

// ---------------------------------------------------------------- fakes
function makeFakeEl(tag) {
    const el = {
        tag: tag || 'div',
        children: [],
        attrs: {},
        style: {},
        classList: {
            _s: new Set(),
            add(c) { this._s.add(c); },
            remove(c) { this._s.delete(c); },
            contains(c) { return this._s.has(c); }
        },
        textContent: '',
        className: '',
        id: '',
        value: '',
        clientWidth: 400,
        clientHeight: 450,
        parentNode: null,
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
        appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
        removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; },
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 450 }; }
    };
    el.style.setProperty = function (k, v) { this[k] = v; };
    el.style.removeProperty = function (k) { delete this[k]; };
    return el;
}

// Document stub for effect-themes cssVars assertions.
function makeCssDoc() {
    const setProps = {};
    return {
        setProps,
        documentElement: {
            style: {
                setProperty(k, v) { setProps[k] = v; },
                removeProperty(k) { delete setProps[k]; }
            }
        },
        getElementById() { return null; },
        addEventListener() {}
    };
}

// Document stub for the debug panel DOM (records keydown handlers).
function makePanelDoc() {
    const created = [];
    const handlers = {};
    const body = makeFakeEl('body');
    const doc = {
        created,
        handlers,
        body,
        createElement(tag) { const e = makeFakeEl(tag); created.push(e); return e; },
        createElementNS(ns, tag) { const e = makeFakeEl(tag); created.push(e); return e; },
        getElementById() { return null; },
        querySelectorAll() { return []; },
        addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
    };
    return doc;
}

// Document stub for check-vfx / checkmate-vfx overlay tests.
function makeOverlayDoc() {
    const created = [];
    const outer = makeFakeEl('div'); outer.id = 'boardOuter';
    const layer = makeFakeEl('div'); layer.id = 'boardLayer';
    const body = makeFakeEl('body');
    return {
        created,
        body,
        createElement(tag) { const e = makeFakeEl(tag); created.push(e); return e; },
        createElementNS(ns, tag) { const e = makeFakeEl(tag); created.push(e); return e; },
        getElementById(id) {
            if (id === 'boardOuter') return outer;
            if (id === 'boardLayer') return layer;
            return null;
        },
        querySelectorAll() { return []; },
        addEventListener() {}
    };
}

function findAll(root, pred, out) {
    out = out || [];
    (root.children || []).forEach(c => { if (pred(c)) out.push(c); findAll(c, pred, out); });
    return out;
}

// ================================================================ EffectThemes
(function themes() {
    // -- default load: ink active, empty palette, persisted
    let stubs = makeStubs();
    const cssDoc = makeCssDoc();
    const busEvents = [];
    stubs.window.GameBus = { emit(ev, p) { busEvents.push([ev, p]); } };
    loadScript(stubs, path.join(JS, 'effect-themes.js'), { document: cssDoc });
    const T = stubs.window.EffectThemes;

    ok('themes: API exposed, ink default', () => {
        assert.ok(T, 'window.EffectThemes assigned');
        ['register', 'apply', 'list', 'current', 'palette', 'remapAudioKey'].forEach(k =>
            assert.strictEqual(typeof T[k], 'function', k));
        assert.strictEqual(T.current(), 'ink');
        assert.deepStrictEqual(T.list(), ['ink', 'neon']);
        assert.deepStrictEqual(T.palette(), {}, 'ink palette intentionally empty');
        assert.strictEqual(stubs.localStorage.getItem('ag_fx_theme'), 'ink');
    });

    ok('themes: invalid theme name rejected, current unchanged', () => {
        assert.strictEqual(T.apply('nope'), false);
        assert.strictEqual(T.apply(''), false);
        assert.strictEqual(T.apply(null), false);
        assert.strictEqual(T.current(), 'ink');
    });

    ok('themes: apply(neon) sets palette, css vars, persists, notifies', () => {
        busEvents.length = 0;
        assert.strictEqual(T.apply('neon'), true);
        assert.strictEqual(T.current(), 'neon');
        assert.strictEqual(T.palette().particleFire, '#ff2fb3');
        assert.ok(Array.isArray(T.palette().celebration));
        assert.strictEqual(stubs.localStorage.getItem('ag_fx_theme'), 'neon');
        assert.strictEqual(cssDoc.setProps['--fx-check-danger'], '255, 47, 179');
        assert.strictEqual(cssDoc.setProps['--fx-banner-glow'], '#00e5ff');
        assert.strictEqual(busEvents.length, 1);
        assert.strictEqual(busEvents[0][0], 'themeChanged');
        assert.strictEqual(busEvents[0][1].name, 'neon');
    });

    ok('themes: stale css vars removed when switching themes', () => {
        assert.strictEqual(T.register('custom', {
            palette: { particleFire: '#123456' },
            cssVars: { '--fx-extra': 'yes', '--fx-check-danger': '1, 2, 3' },
            audioRemap: { boom: 'bang' }
        }), true);
        assert.ok(T.list().indexOf('custom') !== -1);
        assert.strictEqual(T.apply('custom'), true);
        assert.strictEqual(cssDoc.setProps['--fx-extra'], 'yes');
        assert.strictEqual(T.remapAudioKey('boom'), 'bang');
        assert.strictEqual(T.remapAudioKey('other'), 'other');
        assert.strictEqual(T.apply('ink'), true);
        assert.ok(!Object.prototype.hasOwnProperty.call(cssDoc.setProps, '--fx-extra'),
            'stale var removed');
        assert.strictEqual(cssDoc.setProps['--fx-check-danger'], '239, 68, 68');
    });

    ok('themes: register validates input', () => {
        assert.strictEqual(T.register('', {}), false);
        assert.strictEqual(T.register('bad'), false);
        assert.strictEqual(T.register('bad2', null), false);
        assert.strictEqual(T.register('bad3', []), false);
        assert.ok(T.list().indexOf('bad') === -1);
    });

    ok('themes: get() returns a normalized def copy', () => {
        const d = T.get('neon');
        assert.strictEqual(d.name, 'neon');
        assert.ok(d.palette && d.cssVars && d.audioRemap);
        assert.strictEqual(T.get('missing'), null);
    });

    // -- persistence round-trip: fresh context with pre-seeded storage
    ok('themes: persisted selection applied on load', () => {
        const s2 = makeStubs();
        s2.localStorage.setItem('ag_fx_theme', 'neon');
        loadScript(s2, path.join(JS, 'effect-themes.js'), { document: makeCssDoc() });
        assert.strictEqual(s2.window.EffectThemes.current(), 'neon');
        assert.strictEqual(s2.window.EffectThemes.palette().laser, '#ff2fb3');
    });

    ok('themes: corrupt stored value falls back to ink', () => {
        const s3 = makeStubs();
        s3.localStorage.setItem('ag_fx_theme', 'does-not-exist');
        loadScript(s3, path.join(JS, 'effect-themes.js'), { document: makeCssDoc() });
        assert.strictEqual(s3.window.EffectThemes.current(), 'ink');
    });
})();

// ================================================================== FxDebug
(function debug() {
    function freshDebug(opts) {
        opts = opts || {};
        const stubs = makeStubs();
        const busEvents = [];
        if (opts.bus !== false) {
            stubs.window.GameBus = { emit(ev, p) { busEvents.push([ev, p]); } };
        }
        const slowmoCalls = [];
        stubs.window.SlowMo = {
            _active: false,
            isActive() { return this._active; },
            begin(o) { slowmoCalls.push(['begin', o]); this._active = true; return true; },
            reset() { slowmoCalls.push(['reset']); this._active = false; return true; }
        };
        const intensityCalls = [];
        stubs.window.effectsManager = {
            intensity: 'full',
            setIntensity(v) { intensityCalls.push(v); this.intensity = v; }
        };
        if (opts.location) stubs.window.location = { search: opts.location };
        const doc = opts.document || null;
        loadScript(stubs, path.join(JS, 'debug-panel.js'), doc ? { document: doc } : {});
        return { stubs, busEvents, slowmoCalls, intensityCalls, doc, Fx: stubs.window.FxDebug };
    }

    ok('debug: API exposed', () => {
        const { Fx } = freshDebug();
        assert.ok(Fx, 'window.FxDebug assigned');
        ['trigger', 'setSlowMo', 'setIntensityOverride', 'toggle', 'show', 'hide', 'isVisible']
            .forEach(k => assert.strictEqual(typeof Fx[k], 'function', k));
        assert.deepStrictEqual(Fx.PIECES, ['C', 'R', 'H', 'E', 'A', 'P', 'K', 'flyingGeneral']);
        assert.deepStrictEqual(Fx.EVENTS, ['capture', 'check', 'checkmate']);
    });

    ok('debug: trigger(C, capture) payload mirrors app.js emit shape', () => {
        const { Fx, busEvents } = freshDebug();
        assert.strictEqual(Fx.trigger('C', 'capture'), true);
        assert.strictEqual(busEvents.length, 1);
        const [ev, p] = busEvents[0];
        assert.strictEqual(ev, 'capture');
        assert.strictEqual(p.attacker, 'C');
        assert.strictEqual(typeof p.victim, 'string');
        assert.strictEqual(p.side, 'red');
        assert.deepStrictEqual(Object.keys(p).sort(),
            ['attacker', 'commit', 'from', 'movingPieceEl', 'side', 'targetEl', 'to', 'victim']);
        assert.ok(p.from && typeof p.from.r === 'number' && typeof p.from.c === 'number');
        assert.ok(p.to && typeof p.to.r === 'number' && typeof p.to.c === 'number');
        assert.strictEqual(typeof p.commit, 'function');
        p.commit(); // synthetic commit must be safe
    });

    ok('debug: trigger(flyingGeneral, capture) is the KxK same-file duel shape', () => {
        const { Fx, busEvents } = freshDebug();
        assert.strictEqual(Fx.trigger('flyingGeneral', 'capture'), true);
        const p = busEvents[0][1];
        assert.strictEqual(p.attacker, 'K');
        assert.strictEqual(p.victim, 'k');
        assert.strictEqual(p.from.c, p.to.c, 'same file');
    });

    ok('debug: trigger(R, check) payload mirrors app.js check emit', () => {
        const { Fx, busEvents } = freshDebug();
        assert.strictEqual(Fx.trigger('R', 'check'), true);
        const [ev, p] = busEvents[0];
        assert.strictEqual(ev, 'check');
        assert.strictEqual(p.pieceKey, 'R');
        assert.deepStrictEqual(Object.keys(p).sort(),
            ['checkingPieces', 'checkingPos', 'from', 'generalCell', 'move', 'pieceKey', 'side', 'to']);
        assert.ok(Array.isArray(p.checkingPieces) && p.checkingPieces.length === 1);
        assert.strictEqual(p.checkingPieces[0].piece, 'R');
        assert.deepStrictEqual(p.generalCell, { r: 0, c: 4 });
        assert.strictEqual(p.side, 'black');
    });

    ok('debug: trigger(flyingGeneral, check) uses K mover + flyingGeneral key', () => {
        const { Fx, busEvents } = freshDebug();
        assert.strictEqual(Fx.trigger('flyingGeneral', 'check'), true);
        const p = busEvents[0][1];
        assert.strictEqual(p.pieceKey, 'flyingGeneral');
        assert.strictEqual(p.checkingPieces[0].piece, 'K');
    });

    ok('debug: trigger(K, checkmate) mirrors _buildCheckmateEvent shape', () => {
        const { Fx, busEvents } = freshDebug();
        assert.strictEqual(Fx.trigger('K', 'checkmate'), true);
        const [ev, p] = busEvents[0];
        assert.strictEqual(ev, 'checkmate');
        assert.deepStrictEqual(Object.keys(p).sort(),
            ['losingGeneralCell', 'move', 'pieceKey', 'reason', 'winnerSide', 'winningPiece']);
        assert.strictEqual(p.pieceKey, 'K');
        assert.strictEqual(p.winningPiece, 'K');
        assert.deepStrictEqual(p.losingGeneralCell, { r: 0, c: 4 });
        assert.strictEqual(p.winnerSide, 'red');
        assert.strictEqual(p.reason, 'checkmate');
    });

    ok('debug: trigger(flyingGeneral, checkmate) is the general_captured shape', () => {
        const { Fx, busEvents } = freshDebug();
        assert.strictEqual(Fx.trigger('flyingGeneral', 'checkmate'), true);
        const p = busEvents[0][1];
        assert.strictEqual(p.reason, 'general_captured');
        assert.strictEqual(p.pieceKey, 'flyingGeneral');
        assert.strictEqual(p.winningPiece, 'flyingGeneral');
        assert.strictEqual(p.losingGeneralCell, null);
    });

    ok('debug: invalid piece/event rejected, unknown bus handled', () => {
        const { Fx, busEvents } = freshDebug();
        assert.strictEqual(Fx.trigger('X', 'capture'), false);
        assert.strictEqual(Fx.trigger('C', 'bogus'), false);
        assert.strictEqual(Fx.trigger(null, 'check'), false);
        assert.strictEqual(busEvents.length, 0);
        const noBus = freshDebug({ bus: false });
        assert.strictEqual(noBus.Fx.trigger('C', 'capture'), false);
    });

    ok('debug: setSlowMo drives SlowMo (mapping documented in file header)', () => {
        const { Fx, slowmoCalls, stubs } = freshDebug();
        assert.strictEqual(Fx.setSlowMo(0.5), true);
        assert.deepStrictEqual(slowmoCalls[0][0], 'begin');
        assert.strictEqual(slowmoCalls[0][1].minScale, 0.5);
        assert.ok(stubs.window.SlowMo.isActive());
        // change mid-active: reset then begin (begin() alone would no-op)
        assert.strictEqual(Fx.setSlowMo(0.25), true);
        assert.deepStrictEqual(slowmoCalls.map(c => c[0]), ['begin', 'reset', 'begin']);
        assert.strictEqual(slowmoCalls[2][1].minScale, 0.25);
        // >= 1 -> real-time reset
        assert.strictEqual(Fx.setSlowMo(1), true);
        assert.strictEqual(slowmoCalls[3][0], 'reset');
        assert.ok(!stubs.window.SlowMo.isActive());
        // clamping + invalid
        assert.strictEqual(Fx.setSlowMo(0.01), true);
        assert.strictEqual(slowmoCalls[4][1].minScale, 0.05);
        assert.strictEqual(Fx.setSlowMo('x'), false);
        const noSlow = freshDebug();
        delete noSlow.stubs.window.SlowMo;
        assert.strictEqual(noSlow.Fx.setSlowMo(0.5), false);
    });

    ok('debug: setIntensityOverride drives manager, follow restores', () => {
        const { Fx, intensityCalls, stubs } = freshDebug();
        assert.strictEqual(Fx.setIntensityOverride('low'), true);
        assert.deepStrictEqual(intensityCalls, ['low']);
        assert.strictEqual(stubs.window.effectsManager.intensity, 'low');
        assert.strictEqual(Fx.setIntensityOverride('bogus'), false);
        assert.deepStrictEqual(intensityCalls, ['low']);
        // follow restores the pre-override intensity ('full')
        assert.strictEqual(Fx.setIntensityOverride('follow'), true);
        assert.deepStrictEqual(intensityCalls, ['low', 'full']);
        const noMgr = freshDebug();
        delete noMgr.stubs.window.effectsManager;
        assert.strictEqual(noMgr.Fx.setIntensityOverride('low'), false);
    });

    ok('debug: panel builds 24 trigger buttons, hidden until revealed', () => {
        const doc = makePanelDoc();
        const { Fx } = freshDebug({ document: doc });
        const panel = doc.created.find(e => e.id === 'fxDebugPanel');
        assert.ok(panel, 'panel injected');
        assert.strictEqual(panel.style.display, 'none');
        assert.strictEqual(Fx.isVisible(), false);
        const triggers = findAll(panel, e => e.getAttribute('data-fxd-trigger'));
        assert.strictEqual(triggers.length, 24, '8 pieces x 3 events');
        const specs = new Set(triggers.map(e => e.getAttribute('data-fxd-trigger')));
        assert.strictEqual(specs.size, 24, 'all piece|event combos unique');
        assert.ok(specs.has('flyingGeneral|checkmate'));
        assert.strictEqual(Fx.show(), true);
        assert.strictEqual(Fx.isVisible(), true);
        assert.strictEqual(Fx.hide(), true);
        assert.strictEqual(Fx.isVisible(), false);
    });

    ok('debug: ?fxdebug=1 reveals on load; Shift+Alt+D toggles', () => {
        const doc = makePanelDoc();
        const { Fx } = freshDebug({ document: doc, location: '?fxdebug=1' });
        assert.strictEqual(Fx.isVisible(), true, 'url param reveals');
        Fx.hide();
        const kd = doc.handlers.keydown;
        assert.ok(kd && kd.length === 1, 'hotkey bound');
        const fakeEvent = {
            shiftKey: true, altKey: true, ctrlKey: false, metaKey: false,
            key: 'D', code: 'KeyD', target: { tagName: 'DIV' },
            preventDefault() {}
        };
        kd[0](fakeEvent);
        assert.strictEqual(Fx.isVisible(), true, 'hotkey toggles on');
        kd[0](fakeEvent);
        assert.strictEqual(Fx.isVisible(), false, 'hotkey toggles off');
        // typing in an input must not toggle
        const inInput = Object.assign({}, fakeEvent, { target: { tagName: 'INPUT' } });
        kd[0](inInput);
        assert.strictEqual(Fx.isVisible(), false, 'no toggle while typing');
    });

    ok('debug: panel buttons dispatch through trigger()', () => {
        const doc = makePanelDoc();
        const { Fx, busEvents } = freshDebug({ document: doc });
        Fx.show();
        const panel = doc.created.find(e => e.id === 'fxDebugPanel');
        const btn = findAll(panel, e => e.getAttribute('data-fxd-trigger') === 'H|check')[0];
        assert.ok(btn, 'H|check button found');
        const spec = btn.getAttribute('data-fxd-trigger').split('|');
        assert.strictEqual(Fx.trigger(spec[0], spec[1]), true);
        assert.strictEqual(busEvents[0][0], 'check');
        assert.strictEqual(busEvents[0][1].pieceKey, 'H');
    });
})();

// ==================================================== theme wiring in vfx modules
(function wiring() {
    ok('wiring: check-vfx duel bolt follows the checkDanger role', () => {
        const stubs = makeStubs();
        const doc = makeOverlayDoc();
        loadScript(stubs, path.join(JS, 'effect-themes.js'), { document: makeCssDoc() });
        loadScript(stubs, path.join(JS, 'check-vfx.js'), { document: doc });
        const T = stubs.window.EffectThemes;
        const V = stubs.window.CheckVFX;
        assert.ok(V, 'window.CheckVFX assigned');

        T.apply('neon');
        V.flyingGeneralDuel({ r: 9, c: 4 }, { r: 0, c: 4 }, true);
        const svg = doc.created.find(e => e.tag === 'svg');
        assert.ok(svg, 'bolt svg created');
        const bolt = (svg.children || []).find(c => c.getAttribute('class') === 'fx-check-bolt');
        assert.ok(bolt, 'bolt polyline created');
        assert.strictEqual(bolt.style.stroke, '#ff2fb3', 'neon checkDanger applied');

        T.apply('ink');
        V.clearAll();
        doc.created.length = 0;
        V.flyingGeneralDuel({ r: 9, c: 4 }, { r: 0, c: 4 }, true);
        const svg2 = doc.created.find(e => e.tag === 'svg');
        const bolt2 = (svg2.children || []).find(c => c.getAttribute('class') === 'fx-check-bolt');
        assert.strictEqual(bolt2.style.stroke, '#fef08a', 'ink falls back to authored color');
    });

    ok('wiring: checkmate-vfx confetti + fireworks follow the celebration role', () => {
        const stubs = makeStubs();
        const doc = makeOverlayDoc();
        loadScript(stubs, path.join(JS, 'effect-themes.js'), { document: makeCssDoc() });
        loadScript(stubs, path.join(JS, 'checkmate-vfx.js'), { document: doc });
        const T = stubs.window.EffectThemes;
        const M = stubs.window.CheckmateVFX;
        assert.ok(M, 'window.CheckmateVFX assigned');

        T.apply('neon');
        const neonSet = new Set(T.palette().celebration);
        M.celebrate();
        const wrap = doc.created.find(e => e.className === 'fx-mate-celebrate');
        assert.ok(wrap, 'celebrate wrap created');
        const confetti = findAll(wrap, e => e.className === 'fx-mate-confetti');
        assert.strictEqual(confetti.length, 44);
        confetti.forEach(c => assert.ok(neonSet.has(c.style.background),
            'confetti uses neon celebration color: ' + c.style.background));

        doc.created.length = 0;
        M.cannonFireworks();
        const flashes = [];
        doc.created.forEach(e => findAll(e, c => c.className === 'fx-mate-burstflash', flashes));
        const sparks = [];
        doc.created.forEach(e => findAll(e, c => c.className === 'fx-mate-spark', sparks));
        assert.ok(flashes.length > 0 && sparks.length > 0, 'fireworks built');
        flashes.concat(sparks).forEach(c => assert.ok(neonSet.has(c.style.background),
            'firework uses neon celebration color: ' + c.style.background));

        // ink: falls back to the authored arrays
        T.apply('ink');
        doc.created.length = 0;
        M.celebrate();
        const wrap2 = doc.created.find(e => e.className === 'fx-mate-celebrate');
        const conf2 = findAll(wrap2, e => e.className === 'fx-mate-confetti');
        const authored = new Set(['#facc15', '#ef4444', '#3b82f6', '#22c55e', '#f0abfc', '#fb923c']);
        conf2.forEach(c => assert.ok(authored.has(c.style.background),
            'ink falls back to authored confetti colors'));
    });

    ok('wiring: vfx modules degrade gracefully without EffectThemes', () => {
        // check-vfx loaded WITHOUT effect-themes.js: helper must fall back.
        const stubs = makeStubs();
        const doc = makeOverlayDoc();
        loadScript(stubs, path.join(JS, 'check-vfx.js'), { document: doc });
        stubs.window.CheckVFX.flyingGeneralDuel({ r: 9, c: 4 }, { r: 0, c: 4 }, true);
        const svg = doc.created.find(e => e.tag === 'svg');
        const bolt = (svg.children || []).find(c => c.getAttribute('class') === 'fx-check-bolt');
        assert.strictEqual(bolt.style.stroke, '#fef08a', 'fallback when themes absent');
    });
})();

console.log('\n' + passed + ' tests passed');
