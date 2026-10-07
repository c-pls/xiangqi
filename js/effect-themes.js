/**
 * effect-themes.js — Phase 5 (W2): named effect themes for the AntiGravity FX system.
 *
 * Exposes `window.EffectThemes` (classic script; assigns explicitly to window).
 *
 *   EffectThemes.register(name, def)  — add (or replace) a theme.
 *   EffectThemes.apply(name)          — activate a theme. Returns true/false.
 *   EffectThemes.list()               — registered theme names, registration order.
 *   EffectThemes.current()            — active theme name (null before init).
 *   EffectThemes.palette()            — active theme's palette object (for _themeColor helpers).
 *   EffectThemes.remapAudioKey(key)   — theme sfx-key remap (identity when unmapped).
 *
 * Ships TWO built-in themes: 'ink' (default — matches the shipped look) and
 * 'neon' (cyberpunk cyan/magenta). The selection persists as `ag_fx_theme` in
 * localStorage and is applied on load. If a `#fxTheme` select exists in the
 * settings panel it is bound (change -> apply) and kept in sync.
 *
 * No game-rules or game-logic changes. No trauma/shake controls (binding).
 *
 * ============================================================================
 * THEME CONSUMPTION CONTRACT (v1)
 * ============================================================================
 * A theme def is a plain object:
 *   {
 *     palette:    { role -> cssColor | string[] },  // semantic roles, JS-consumed
 *     cssVars:    { '--var-name' -> value },         // set as-is on :root
 *     audioRemap: { sfxKey -> sfxKey }               // sfx key substitution map
 *   }
 * All three sections are optional; missing/invalid sections normalize to {}.
 *
 * Palette roles (semantic, NOT per-piece — a theme recolors by role):
 *   particleFire  fire cores, muzzle flashes, hot sparks (canvas particles)
 *   shockwave     expanding shockwave rings (canvas particles)
 *   laser         laser/beam weapons, e.g. the check laser sight (canvas)
 *   bannerInk     checkmate calligraphy banner primary glow (inline style)
 *   checkDanger   check-threat color: duel bolt (JS) + laser/lane/palace/glow (CSS)
 *   celebration   victory confetti + fireworks colors (MUST be an ARRAY)
 *   particleSmoke smoke/dust tint — RESERVED (no JS lookup site yet; via CSS var)
 *   vignette      cinematic vignette tint — RESERVED (via CSS var --fx-vignette-edge)
 *
 * How vfx modules consume a theme (the ONLY sanctioned pattern):
 *   1. JS (canvas colors / DOM inline styles): each module defines a
 *      module-local `_themeColor(key, fallback)` that returns
 *      `EffectThemes.palette()[key]` when defined, else `fallback`.
 *      Call sites wrap the authored literal, e.g.
 *        color: _themeColor('particleFire', '#ff5500')
 *      When EffectThemes is absent — or the active theme leaves the role
 *      undefined — the authored color is used. The default 'ink' theme keeps
 *      its palette EMPTY on purpose, so every _themeColor() falls back and the
 *      shipped look is reproduced bit-for-bit. A non-array `celebration`
 *      value is ignored (fallback used).
 *   2. CSS (class-driven colors, e.g. check-vfx.js `fx-check-*` rules): apply()
 *      sets each cssVars entry as a custom property on document.documentElement.
 *      style.css consumes them via var(--name, fallback), where the fallbacks
 *      are the shipped values — an un-patched stylesheet is unaffected.
 *      Sanctioned vars: --fx-check-danger ("r, g, b" triplet, for rgba()
 *      composition), --fx-check-danger-soft, --fx-check-warn,
 *      --fx-vignette-edge, --fx-banner-glow.
 *   3. Audio: EffectThemes.remapAudioKey(key) is the single consumption point
 *      for audioRemap. NOT yet wired into js/audio-manager.js (one-line hook:
 *      `key = window.EffectThemes ? EffectThemes.remapAudioKey(key) : key`
 *      at the top of play()); both shipped themes carry an empty audioRemap
 *      because no alternate sfx assets exist.
 *
 * Rules for module authors (W1/W3):
 *   - NEVER read EffectThemes internals (registry objects); use palette() and
 *     remapAudioKey() only, always through a local _themeColor helper with an
 *     authored fallback, so the module keeps working if this file fails to load.
 *   - Do NOT refactor particle engines for theming; wrap literals at spawn /
 *     creation sites only. Colors resolve at creation time, never per-frame,
 *     so the pooling hot path is untouched.
 *   - Theme application is NOT intensity-gated (a look preference applies at
 *     any intensity) and adds no motion, so it is inherently reduced-motion
 *     safe. Intensity gating still applies to the effects themselves downstream.
 *   - apply() returns false (and keeps the current theme) for unknown names;
 *     it never throws for bad input.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'ag_fx_theme';
    var DEFAULT_THEME = 'ink';

    var _registry = {};   // name -> normalized def
    var _order = [];      // registration order
    var _current = null;  // active theme name
    var _appliedVars = []; // css var names set on :root by the last apply()
    var _uiBound = false;

    function warn(msg) {
        try { console.warn('[EffectThemes] ' + msg); } catch (e) {}
    }

    function isPlainObject(v) {
        return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    function storage() {
        try {
            if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
        } catch (e) {}
        try {
            if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
        } catch (e2) {}
        return null;
    }

    function storageGet(key) {
        var s = storage();
        if (!s) return null;
        try { return s.getItem(key); } catch (e) { return null; }
    }

    function storageSet(key, value) {
        var s = storage();
        if (!s) return;
        try { s.setItem(key, value); } catch (e) {}
    }

    function normalizeDef(name, def) {
        def = isPlainObject(def) ? def : {};
        return {
            name: name,
            palette: isPlainObject(def.palette) ? def.palette : {},
            cssVars: isPlainObject(def.cssVars) ? def.cssVars : {},
            audioRemap: isPlainObject(def.audioRemap) ? def.audioRemap : {}
        };
    }

    function getDef(name) {
        if (typeof name !== 'string' || !name) return null;
        return Object.prototype.hasOwnProperty.call(_registry, name) ? _registry[name] : null;
    }

    // ------------------------------------------------------------ public API
    function register(name, def) {
        if (typeof name !== 'string' || !name) {
            warn('register: theme name must be a non-empty string');
            return false;
        }
        if (!isPlainObject(def)) {
            warn('register: theme def for "' + name + '" must be an object');
            return false;
        }
        if (!getDef(name)) _order.push(name);
        _registry[name] = normalizeDef(name, def);
        return true;
    }

    function list() {
        return _order.slice();
    }

    function current() {
        return _current;
    }

    function get(name) {
        var d = getDef(name || _current);
        return d ? {
            name: d.name,
            palette: d.palette,
            cssVars: d.cssVars,
            audioRemap: d.audioRemap
        } : null;
    }

    function palette() {
        var d = getDef(_current);
        return d ? d.palette : {};
    }

    function remapAudioKey(key) {
        var d = getDef(_current);
        if (d && typeof d.audioRemap[key] === 'string' && d.audioRemap[key]) {
            return d.audioRemap[key];
        }
        return key;
    }

    function syncSelect() {
        try {
            if (typeof document === 'undefined' || !document.getElementById) return;
            var sel = document.getElementById('fxTheme');
            if (sel && typeof sel.value !== 'undefined' && sel.value !== _current) {
                sel.value = _current;
            }
        } catch (e) {}
    }

    function apply(name) {
        var def = getDef(name);
        if (!def) {
            warn('apply: unknown theme "' + String(name) + '"' +
                (_current ? '; keeping "' + _current + '"' : ''));
            return false;
        }
        _current = def.name;
        // 1. CSS custom properties on :root; drop vars the new theme doesn't define.
        try {
            if (typeof document !== 'undefined' && document.documentElement &&
                document.documentElement.style) {
                var rootStyle = document.documentElement.style;
                var next = Object.keys(def.cssVars);
                for (var i = 0; i < _appliedVars.length; i++) {
                    if (next.indexOf(_appliedVars[i]) === -1) {
                        try { rootStyle.removeProperty(_appliedVars[i]); } catch (e2) {}
                    }
                }
                next.forEach(function (k) {
                    try { rootStyle.setProperty(k, def.cssVars[k]); } catch (e3) {}
                });
                _appliedVars = next;
            }
        } catch (e) {}
        // 2. Persist.
        storageSet(STORAGE_KEY, def.name);
        // 3. Notify observers (vfx modules read palette() lazily anyway).
        try {
            if (typeof window !== 'undefined' && window.GameBus &&
                typeof window.GameBus.emit === 'function') {
                window.GameBus.emit('themeChanged', { name: def.name, theme: get(def.name) });
            }
        } catch (e4) {}
        syncSelect();
        return true;
    }

    // ------------------------------------------------------------ settings UI
    function bindUi() {
        if (_uiBound) return;
        try {
            if (typeof document === 'undefined' || !document.getElementById) return;
            var sel = document.getElementById('fxTheme');
            if (!sel || sel.__fxThemeBound) return;
            sel.__fxThemeBound = true;
            _uiBound = true;
            if (typeof sel.value !== 'undefined' && _current) sel.value = _current;
            if (typeof sel.addEventListener === 'function') {
                sel.addEventListener('change', function () {
                    apply(sel.value);
                });
            }
        } catch (e) {}
    }

    // ------------------------------------------------------------ built-ins
    //
    // 'ink' — the default theme. Its palette is INTENTIONALLY EMPTY: every
    // _themeColor(key, fallback) in the vfx modules then resolves to the
    // authored fallback, reproducing the shipped look bit-for-bit. The cssVars
    // below pin the :root custom properties to the shipped values (harmless
    // until style.css consumes them via var(--name, fallback)).
    var INK = {
        palette: {},
        cssVars: {
            '--fx-check-danger': '239, 68, 68',
            '--fx-check-danger-soft': '#fca5a5',
            '--fx-check-warn': '#fef08a',
            '--fx-vignette-edge': 'rgba(220, 38, 38, 0.25)',
            '--fx-banner-glow': '#ff5500'
        },
        audioRemap: {}
    };

    // 'neon' — cyberpunk: cyan/magenta. Recolors the semantic roles; piece
    // silhouettes, timing, and choreography are untouched.
    var NEON = {
        palette: {
            particleFire: '#ff2fb3',
            shockwave: '#00e5ff',
            laser: '#ff2fb3',
            bannerInk: '#00e5ff',
            checkDanger: '#ff2fb3',
            celebration: ['#00e5ff', '#ff2fb3', '#b967ff', '#f9f871', '#7df9ff', '#ff9de2']
        },
        cssVars: {
            '--fx-check-danger': '255, 47, 179',
            '--fx-check-danger-soft': '#ff9de2',
            '--fx-check-warn': '#00e5ff',
            '--fx-vignette-edge': 'rgba(255, 47, 179, 0.28)',
            '--fx-banner-glow': '#00e5ff'
        },
        audioRemap: {}
    };

    function init() {
        register('ink', INK);
        register('neon', NEON);
        var stored = storageGet(STORAGE_KEY);
        if (typeof stored === 'string' && getDef(stored)) {
            apply(stored);
        } else {
            apply(DEFAULT_THEME);
        }
        bindUi();
        try {
            if (typeof document !== 'undefined' && document.addEventListener) {
                document.addEventListener('DOMContentLoaded', bindUi);
            }
        } catch (e) {}
    }

    if (typeof window !== 'undefined') {
        window.EffectThemes = {
            register: register,
            apply: apply,
            list: list,
            current: current,
            get: get,
            palette: palette,
            remapAudioKey: remapAudioKey,
            STORAGE_KEY: STORAGE_KEY
        };
    }

    try {
        init();
    } catch (e) {
        warn('init failed: ' + e);
    }
})();
