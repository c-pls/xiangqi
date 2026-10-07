/**
 * debug-panel.js — Phase 5 (W2): hidden FX debug panel for the AntiGravity effects system.
 *
 * Exposes `window.FxDebug` (classic script; assigns explicitly to window):
 *   FxDebug.trigger(piece, event)        — dispatch a synthetic GameBus event.
 *   FxDebug.setSlowMo(f)                — drive window.SlowMo (see SLOW-MO MAPPING).
 *   FxDebug.setIntensityOverride(v)     — drive the EffectsManager intensity.
 *   FxDebug.toggle() / show() / hide() / isVisible()
 *
 * Reveal: Shift+Alt+D keyboard shortcut, or the `?fxdebug=1` URL parameter.
 * The panel is self-injecting DOM, `display:none` until revealed, with minimal
 * inline styling. It never touches game rules or logic.
 *
 * ---------------------------------------------------------------------------
 * SYNTHETIC EVENT PAYLOADS — mirror the real emit shapes in js/app.js
 * ---------------------------------------------------------------------------
 *   'move'      (app.js executeMove):            { move }
 *   'capture'   (app.js executeMove, kill seq):  { attacker, victim, side, from, to,
 *                                                 targetEl, movingPieceEl, commit }
 *       attacker = move.piece.toUpperCase() ('C'|'R'|'H'|'E'|'A'|'P'|'K');
 *       victim   = move.captured || null (piece char, lowercase = black);
 *       side     = this.game.turn ('red'|'black'); commit = commitMove.
 *       Flying-general duel: attacker 'K' + victim 'k' on the same file
 *       (from.c === to.c) — mirrors the Phase-3 _onCapture duel detection.
 *   'check'     (app.js commitMove, bus-route-first):
 *               { move, pieceKey, checkingPieces, checkingPos, generalCell,
 *                 from, to, side }
 *       pieceKey 'C'|'R'|'H'|'P'|'flyingGeneral' (a general checking => the
 *       flying-general rule); checkingPieces = [{r, c, piece}]; side = the
 *       side now to move (the side IN check).
 *   'checkmate' (app.js commitMove -> _buildCheckmateEvent):
 *               { move, pieceKey, winningPiece, losingGeneralCell,
 *                 winnerSide, reason }
 *       reason 'checkmate' | 'general_captured'; flying-general mate routes
 *       pieceKey + winningPiece as 'flyingGeneral' with losingGeneralCell null
 *       (the general left the board via capture).
 *   'soldierCrossRiver' (app.js commitMove): { to, move }.
 *
 * The panel offers piece x event triggers for pieces
 *   C R H E A P K flyingGeneral  x  events  capture check checkmate
 * (24 buttons). Synthetic payloads are plausible but NOT legal moves: the
 * synthetic capture `commit` is a no-op (the board does not advance), and
 * targetEl/movingPieceEl are detached dummy divs. Everything flows through the
 * normal GameBus -> EffectsManager pipeline, so intensity gating,
 * reduced-motion defaults, skipAll(), and the announcer all behave exactly as
 * they would for a real event — that is the point of the tool.
 *
 * ---------------------------------------------------------------------------
 * SLOW-MO MAPPING (drives window.SlowMo, js/slowmo.js)
 * ---------------------------------------------------------------------------
 *   setSlowMo(f): f in [0.05, 1]. f >= 1  -> SlowMo.reset()  (real-time).
 *                 f < 1   -> SlowMo.reset() if active, then
 *                            SlowMo.begin({ minScale: f, downMs: 300 }).
 *   The slider is labelled in percent (5%..100%); 100% = real-time.
 *   begin() is a no-op while slow-mo is already active, hence the
 *   reset-then-begin when changing the factor mid-ramp. Audio Howls ramp to
 *   0.85x and gsap.globalTimeline.timeScale ramps to f — same mechanism as the
 *   checkmate replay path. Trauma shake / hit-stop are NOT touched (binding:
 *   they stay OFF; this panel exposes no shake controls anywhere).
 *
 * ---------------------------------------------------------------------------
 * INTENSITY OVERRIDE (drives the EffectsManager, js/effects-bridge.js)
 * ---------------------------------------------------------------------------
 *   setIntensityOverride('off'|'low'|'full') calls
 *   window.effectsManager.setIntensity(v). The pre-override intensity is
 *   remembered; setIntensityOverride('follow') (or the "follow settings"
 *   option) restores it, so the user's stored `ag_fx_intensity` preference is
 *   never clobbered by a debug session. Invalid values are rejected (false).
 *
 * Reduced motion: the panel adds no motion of its own; synthetic triggers run
 * through the manager, which already degrades under prefers-reduced-motion.
 * The panel surfaces the reduced-motion state as a label.
 */
(function () {
    'use strict';

    var PIECES = ['C', 'R', 'H', 'E', 'A', 'P', 'K', 'flyingGeneral'];
    var EVENTS = ['capture', 'check', 'checkmate'];
    var INTENSITIES = ['off', 'low', 'full'];
    var PANEL_ID = 'fxDebugPanel';

    // Plausible (not necessarily legal) from/to cells per piece, in the real
    // {r, c} board convention (0-based, r 0-9, c 0-8).
    var MOVE_CELLS = {
        C: { from: { r: 2, c: 1 }, to: { r: 2, c: 4 } },
        R: { from: { r: 9, c: 0 }, to: { r: 9, c: 4 } },
        H: { from: { r: 9, c: 1 }, to: { r: 7, c: 2 } },
        E: { from: { r: 9, c: 2 }, to: { r: 7, c: 4 } },
        A: { from: { r: 9, c: 3 }, to: { r: 8, c: 4 } },
        P: { from: { r: 6, c: 4 }, to: { r: 5, c: 4 } },
        K: { from: { r: 9, c: 4 }, to: { r: 8, c: 4 } },
        // Flying-general capture: red general takes the black general down the file.
        flyingGeneral: { from: { r: 3, c: 4 }, to: { r: 0, c: 4 } }
    };

    // Plausible black victims for a red attacker (lowercase = black).
    var VICTIMS = { C: 'p', R: 'h', H: 'c', E: 'p', A: 'p', P: 'p', K: 'r', flyingGeneral: 'k' };

    var _overrideActive = false;
    var _preOverrideIntensity = null;
    var _panel = null;

    function warn(msg) {
        try { console.warn('[FxDebug] ' + msg); } catch (e) {}
    }

    function hasDoc() {
        return (typeof document !== 'undefined') && !!document.createElement;
    }

    function getBus() {
        try {
            var b = (typeof window !== 'undefined') ? window.GameBus : null;
            return (b && typeof b.emit === 'function') ? b : null;
        } catch (e) { return null; }
    }

    function dummyEl() {
        try {
            if (hasDoc()) return document.createElement('div');
        } catch (e) {}
        return null;
    }

    function cellsFor(piece) {
        var c = MOVE_CELLS[piece];
        return {
            from: { r: c.from.r, c: c.from.c },
            to: { r: c.to.r, c: c.to.c }
        };
    }

    // ------------------------------------------------------------ payloads
    function buildCapture(piece) {
        var cells = cellsFor(piece);
        var isFG = (piece === 'flyingGeneral');
        return {
            attacker: isFG ? 'K' : piece,
            victim: VICTIMS[piece],
            side: 'red',
            from: cells.from,
            to: cells.to,
            targetEl: dummyEl(),
            movingPieceEl: dummyEl(),
            // Synthetic commit: there is no real move to land; the manager
            // still calls it after the cinematic, so it must exist and be safe.
            commit: function () {}
        };
    }

    function buildCheck(piece) {
        var cells = cellsFor(piece);
        var isFG = (piece === 'flyingGeneral');
        var mover = isFG ? 'K' : piece;
        return {
            move: { from: cells.from, to: cells.to, piece: mover },
            pieceKey: piece,
            checkingPieces: [{ r: cells.to.r, c: cells.to.c, piece: mover }],
            checkingPos: { r: cells.to.r, c: cells.to.c },
            generalCell: { r: 0, c: 4 },
            from: cells.from,
            to: cells.to,
            side: 'black'
        };
    }

    function buildCheckmate(piece, side) {
        var cells = cellsFor(piece);
        var isFG = (piece === 'flyingGeneral');
        var mover = isFG ? 'K' : piece;
        return {
            move: { from: cells.from, to: cells.to, piece: mover, captured: VICTIMS[piece] },
            pieceKey: isFG ? 'flyingGeneral' : piece,
            winningPiece: isFG ? 'flyingGeneral' : piece,
            losingGeneralCell: isFG ? null : { r: 0, c: 4 },
            winnerSide: (side === 'black' || side === 'red') ? side : 'red',
            reason: isFG ? 'general_captured' : 'checkmate'
        };
    }

    function buildPayload(piece, event, side) {
        if (event === 'capture') return buildCapture(piece);
        if (event === 'check') return buildCheck(piece);
        if (event === 'checkmate') return buildCheckmate(piece, side);
        return null;
    }

    // ------------------------------------------------------------ public API
    // `side` is optional ('red'|'black', default 'red'); it sets the
    // checkmate payload's winnerSide so the victory scroll theme previews.
    function trigger(piece, event, side) {
        if (PIECES.indexOf(piece) === -1) {
            warn('trigger: unknown piece "' + String(piece) + '"');
            return false;
        }
        if (EVENTS.indexOf(event) === -1) {
            warn('trigger: unknown event "' + String(event) + '"');
            return false;
        }
        var bus = getBus();
        if (!bus) {
            warn('trigger: window.GameBus unavailable');
            return false;
        }
        var payload = buildPayload(piece, event, side);
        if (!payload) return false;
        try {
            bus.emit(event, payload);
            return true;
        } catch (e) {
            warn('trigger: emit failed: ' + e);
            return false;
        }
    }

    function setSlowMo(f) {
        var S = null;
        try { S = (typeof window !== 'undefined') ? window.SlowMo : null; } catch (e) {}
        if (!S || typeof S.begin !== 'function' || typeof S.reset !== 'function') {
            warn('setSlowMo: window.SlowMo unavailable');
            return false;
        }
        var v = Number(f);
        if (!isFinite(v)) {
            warn('setSlowMo: factor must be a number');
            return false;
        }
        v = Math.min(1, Math.max(0.05, v));
        try {
            if (v >= 1) {
                S.reset();
            } else {
                if (typeof S.isActive === 'function' && S.isActive()) S.reset();
                S.begin({ minScale: v, downMs: 300 });
            }
            return true;
        } catch (e) {
            warn('setSlowMo failed: ' + e);
            return false;
        }
    }

    function setIntensityOverride(v) {
        var M = null;
        try { M = (typeof window !== 'undefined') ? window.effectsManager : null; } catch (e) {}
        if (!M || typeof M.setIntensity !== 'function') {
            warn('setIntensityOverride: window.effectsManager unavailable');
            return false;
        }
        // 'follow' (or null/undefined) = stop overriding, restore pre-override.
        if (v === 'follow' || v === null || v === undefined) {
            if (_overrideActive && _preOverrideIntensity) {
                try { M.setIntensity(_preOverrideIntensity); } catch (e) {}
            }
            _overrideActive = false;
            _preOverrideIntensity = null;
            syncIntensitySelect();
            return true;
        }
        if (INTENSITIES.indexOf(v) === -1) {
            warn('setIntensityOverride: invalid intensity "' + String(v) + '"');
            return false;
        }
        if (!_overrideActive) {
            _preOverrideIntensity = (typeof M.intensity === 'string') ? M.intensity : 'full';
            _overrideActive = true;
        }
        try {
            M.setIntensity(v);
        } catch (e) {
            warn('setIntensityOverride failed: ' + e);
            return false;
        }
        syncIntensitySelect();
        return true;
    }

    // ------------------------------------------------------------ panel DOM
    function reducedMotion() {
        try {
            if (typeof matchMedia === 'function') {
                return matchMedia('(prefers-reduced-motion: reduce)').matches;
            }
        } catch (e) {}
        return false;
    }

    function el(tag, style, text) {
        var n = document.createElement(tag);
        if (style) n.setAttribute('style', style);
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    }

    function buildPanel() {
        if (_panel || !hasDoc()) return _panel;
        try {
            var p = el('div',
                'display:none;position:fixed;right:12px;bottom:12px;z-index:99999;' +
                'background:rgba(8,10,18,0.94);border:1px solid #3b82f6;border-radius:10px;' +
                'padding:10px 12px;color:#e5e7eb;font:12px/1.45 system-ui,sans-serif;' +
                'max-width:352px;box-shadow:0 8px 30px rgba(0,0,0,0.55);');
            p.id = PANEL_ID;
            p.style.display = 'none'; // explicit (mirrors the style attribute) for isVisible()

            var head = el('div',
                'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;');
            var title = el('b', null, 'FX Debug');
            var close = el('button',
                'background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:6px;' +
                'cursor:pointer;padding:2px 8px;font-size:12px;', 'X');
            close.setAttribute('data-fxd', 'close');
            close.setAttribute('title', 'Hide panel (Shift+Alt+D to re-open)');
            head.appendChild(title);
            head.appendChild(close);
            p.appendChild(head);

            if (reducedMotion()) {
                p.appendChild(el('div',
                    'color:#fbbf24;margin-bottom:8px;font-size:11px;',
                    'reduced-motion is ON — triggers run through the degraded path.'));
            }

            // 24 trigger buttons, grouped by event.
            EVENTS.forEach(function (ev) {
                var row = el('div', 'margin-bottom:6px;');
                row.appendChild(el('div',
                    'color:#93c5fd;font-size:11px;margin-bottom:3px;text-transform:uppercase;' +
                    'letter-spacing:0.06em;', ev));
                var btns = el('div', 'display:flex;flex-wrap:wrap;gap:4px;');
                PIECES.forEach(function (pc) {
                    var b = el('button',
                        'background:#111c33;color:#dbeafe;border:1px solid #274b8f;border-radius:6px;' +
                        'cursor:pointer;padding:3px 7px;font-size:11px;font-family:inherit;', pc);
                    b.setAttribute('data-fxd-trigger', pc + '|' + ev);
                    b.setAttribute('title', 'GameBus.emit(' + ev + ', ' + pc + ' payload)');
                    btns.appendChild(b);
                });
                row.appendChild(btns);
                p.appendChild(row);
            });

            // Slow-mo slider.
            var smRow = el('div', 'margin:8px 0 6px;');
            var smHead = el('div', 'color:#93c5fd;font-size:11px;margin-bottom:3px;',
                'SLOW-MO  ');
            var smLabel = el('span', 'color:#e5e7eb;', '100%');
            smHead.appendChild(smLabel);
            smRow.appendChild(smHead);
            var sm = el('input', 'width:100%;');
            sm.setAttribute('type', 'range');
            sm.setAttribute('min', '5');
            sm.setAttribute('max', '100');
            sm.setAttribute('value', '100');
            sm.setAttribute('aria-label', 'Slow-motion factor percent');
            sm.addEventListener('input', function () {
                var pct = Number(sm.value);
                smLabel.textContent = pct + '%';
                setSlowMo(pct / 100);
            });
            smRow.appendChild(sm);
            p.appendChild(smRow);

            // Intensity override.
            var intRow = el('div', 'display:flex;align-items:center;gap:8px;margin-bottom:4px;');
            intRow.appendChild(el('span', 'color:#93c5fd;font-size:11px;', 'INTENSITY'));
            var sel = el('select',
                'background:#111c33;color:#dbeafe;border:1px solid #274b8f;border-radius:6px;' +
                'padding:3px 6px;font-size:11px;font-family:inherit;');
            sel.id = 'fxDebugIntensity';
            [['follow', 'follow settings'], ['full', 'full'], ['low', 'low'], ['off', 'off']]
                .forEach(function (opt) {
                    var o = el('option', null, opt[1]);
                    o.setAttribute('value', opt[0]);
                    sel.appendChild(o);
                });
            sel.addEventListener('change', function () {
                setIntensityOverride(sel.value);
            });
            intRow.appendChild(sel);
            p.appendChild(intRow);

            p.appendChild(el('div', 'color:#6b7280;font-size:10px;margin-top:6px;',
                'Synthetic events flow through GameBus to EffectsManager. ' +
                'Commit is a no-op; the board does not advance.'));

            // Delegated clicks: close + triggers.
            p.addEventListener('click', function (e) {
                var t = e.target;
                if (!t || !t.getAttribute) return;
                if (t.getAttribute('data-fxd') === 'close') { hide(); return; }
                var spec = t.getAttribute('data-fxd-trigger');
                if (spec) {
                    var parts = spec.split('|');
                    trigger(parts[0], parts[1]);
                }
            });

            document.body.appendChild(p);
            _panel = p;
        } catch (e) {
            warn('buildPanel failed: ' + e);
            _panel = null;
        }
        return _panel;
    }

    function syncIntensitySelect() {
        try {
            if (!_panel || !hasDoc()) return;
            var sel = _panel.querySelector('#fxDebugIntensity');
            if (sel) sel.value = _overrideActive ? String(currentOverrideValue()) : 'follow';
        } catch (e) {}
    }

    function currentOverrideValue() {
        try {
            var M = window.effectsManager;
            return (M && typeof M.intensity === 'string') ? M.intensity : 'full';
        } catch (e) { return 'full'; }
    }

    function isVisible() {
        return !!(_panel && _panel.style.display !== 'none');
    }

    // The debug panel is VFX-config tooling: it opens only for admins
    // (see js/admin-gate.js). When AdminGate is absent (e.g. unit tests),
    // the panel keeps its historical behavior.
    function adminBlocked() {
        try {
            if (typeof window !== 'undefined' && window.AdminGate &&
                typeof window.AdminGate.isUnlocked === 'function') {
                return !window.AdminGate.isUnlocked();
            }
        } catch (e) {}
        return false;
    }

    function show() {
        if (adminBlocked()) return false;
        var p = buildPanel();
        if (!p) return false;
        p.style.display = 'block';
        return true;
    }

    function hide() {
        if (!_panel) return true;
        _panel.style.display = 'none';
        return true;
    }

    function toggle() {
        return isVisible() ? hide() : show();
    }

    // ------------------------------------------------------------ reveal wiring
    function enabledByUrl() {
        try {
            if (typeof window !== 'undefined' && window.location && window.location.search &&
                typeof URLSearchParams === 'function') {
                return new URLSearchParams(window.location.search).get('fxdebug') === '1';
            }
        } catch (e) {}
        return false;
    }

    function bindHotkey() {
        try {
            if (!hasDoc() || typeof document.addEventListener !== 'function') return;
            document.addEventListener('keydown', function (e) {
                try {
                    if (!e || !e.shiftKey || !e.altKey || e.ctrlKey || e.metaKey) return;
                    var k = e.key || '';
                    var code = e.code || '';
                    if (k === 'D' || k === 'd' || code === 'KeyD') {
                        var t = e.target;
                        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                                  t.tagName === 'SELECT' || t.isContentEditable)) return;
                        if (typeof e.preventDefault === 'function') e.preventDefault();
                        toggle();
                    }
                } catch (err) {}
            });
        } catch (e) {}
    }

    function init() {
        buildPanel();
        bindHotkey();
        if (enabledByUrl()) show();
    }

    if (typeof window !== 'undefined') {
        window.FxDebug = {
            trigger: trigger,
            setSlowMo: setSlowMo,
            setIntensityOverride: setIntensityOverride,
            toggle: toggle,
            show: show,
            hide: hide,
            isVisible: isVisible,
            PIECES: PIECES.slice(),
            EVENTS: EVENTS.slice()
        };
    }

    try {
        init();
    } catch (e) {
        warn('init failed: ' + e);
    }
})();
