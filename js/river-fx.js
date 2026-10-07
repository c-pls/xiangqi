/**
 * river-fx.js — Phase 5 (W3): animated ink-wash water flow along the river band.
 *
 * window.RiverFX:
 *   splash(cell)        — ripple flourish at a board cell {r, c} (the
 *                         soldierCrossRiver moment; app.js keeps its own
 *                         splash/banner DOM, this adds water ripples)
 *   setIntensity(level) — 'off' | 'low' | 'full'
 *
 * A single canvas overlay sits inside #boardOuter over the river band (between
 * rows 4 and 5), painted UNDER the piece layer. Cheap by design: a dozen
 * drifting ink strokes + a few soft ink clouds per frame, one rAF loop.
 *
 * Intensity gating (documented):
 *   'full' -> animated ambient flow + animated splash ripples.
 *   'low'  -> one static wash frame, no animation loop; splash draws a single
 *             static ring in that frame.
 *   'off'  -> canvas hidden, no loop, splash is a no-op.
 * prefers-reduced-motion: static wash only, no loop, splash is a no-op.
 *
 * The module self-subscribes to GameBus 'soldierCrossRiver'. When #boardOuter
 * (or document/canvas) is unavailable it no-ops cleanly; window.RiverFX is
 * still exposed with inert methods.
 *
 * Initial intensity is read from window.effectsManager when present (the
 * bridge calls setIntensity() on later changes, guarded).
 */
(function () {
    'use strict';

    // River band geometry, in % of #boardOuter. The board grid is viewBox
    // 400x450; the river spans y=200..245 (44.44%..54.44%) and x=20..380.
    // A little bleed keeps the wash soft at the edges.
    var BAND = { left: 4, top: 43.4, width: 92, height: 12.2 };
    var STROKES = 12;
    var CLOUDS = 4;

    var canvas = null;
    var g = null; // 2d context
    var intensity = 'full';
    var reducedMotion = false;
    var rafId = null;
    var ripples = []; // {x, y (band fractions), r, alpha, speed}
    var t0 = 0;
    var dpr = 1;
    var bw = 0, bh = 0; // backing-store size

    function detectReducedMotion() {
        try {
            return !!(window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (e) { return false; }
    }

    function boardOuter() {
        try {
            if (typeof document === 'undefined') return null;
            return document.getElementById('boardOuter');
        } catch (e) { return null; }
    }

    function ensureCanvas() {
        if (canvas) return true;
        try {
            var outer = boardOuter();
            if (!outer || typeof document === 'undefined') return false;
            if (typeof document.createElement !== 'function') return false;
            canvas = document.createElement('canvas');
            canvas.id = 'fxRiverCanvas';
            canvas.style.cssText =
                'position:absolute;' +
                'left:' + BAND.left + '%;top:' + BAND.top + '%;' +
                'width:' + BAND.width + '%;height:' + BAND.height + '%;' +
                'pointer-events:none;';
            // Paint under the piece layer when it exists.
            var layer = null;
            try { layer = outer.querySelector('#boardLayer'); } catch (e) {}
            if (layer && layer.parentNode === outer) outer.insertBefore(canvas, layer);
            else outer.appendChild(canvas);
            try { g = canvas.getContext('2d'); } catch (e) { g = null; }
            if (!g) { canvas = null; return false; }
            sizeCanvas();
            try {
                window.addEventListener('resize', sizeCanvas);
            } catch (e) {}
            return true;
        } catch (e) { return false; }
    }

    function sizeCanvas() {
        try {
            if (!canvas) return;
            dpr = 1;
            try {
                dpr = Math.min(2, window.devicePixelRatio || 1);
            } catch (e) {}
            var w = canvas.clientWidth || 300;
            var h = canvas.clientHeight || 40;
            bw = Math.max(2, Math.round(w * dpr));
            bh = Math.max(2, Math.round(h * dpr));
            if (canvas.width !== bw || canvas.height !== bh) {
                canvas.width = bw;
                canvas.height = bh;
            }
        } catch (e) {}
    }

    // --- painting ----------------------------------------------------------
    function paintWash(time) {
        g.clearRect(0, 0, bw, bh);
        var i, y, amp, phase;
        // Drifting ink strokes.
        for (i = 0; i < STROKES; i++) {
            y = bh * (i + 0.5) / STROKES;
            amp = bh * 0.10;
            phase = i * 1.7;
            var yOff = Math.sin(time * 0.00045 + phase) * amp;
            var alpha = 0.05 + 0.07 * (0.5 + 0.5 * Math.sin(time * 0.0003 + phase * 2));
            g.beginPath();
            g.moveTo(-10, y + yOff);
            g.bezierCurveTo(
                bw * 0.3, y + yOff + Math.sin(time * 0.0006 + phase) * amp * 1.6,
                bw * 0.7, y + yOff - Math.sin(time * 0.0005 + phase + 1) * amp * 1.6,
                bw + 10, y + yOff);
            g.strokeStyle = 'rgba(150,190,215,' + alpha.toFixed(3) + ')';
            g.lineWidth = Math.max(1, dpr * (0.8 + (i % 3) * 0.5));
            g.stroke();
        }
        // Slow ink clouds.
        for (i = 0; i < CLOUDS; i++) {
            var cx = bw * ((time * 0.00002 * (1 + i * 0.3) + i * 0.27) % 1.2 - 0.1);
            var cy = bh * (0.25 + 0.5 * ((i * 0.37) % 1));
            var cr = bh * (0.5 + (i % 2) * 0.35);
            var grad = g.createRadialGradient(cx, cy, 0, cx, cy, cr);
            grad.addColorStop(0, 'rgba(70,105,130,0.055)');
            grad.addColorStop(1, 'rgba(70,105,130,0)');
            g.fillStyle = grad;
            g.beginPath();
            g.arc(cx, cy, cr, 0, Math.PI * 2);
            g.fill();
        }
    }

    function paintRipples(time) {
        for (var i = ripples.length - 1; i >= 0; i--) {
            var rp = ripples[i];
            var age = time - rp.born;
            var life = 1100;
            if (age >= life) { ripples.splice(i, 1); continue; }
            var k = age / life;
            var radius = (0.03 + 0.30 * k) * bw;
            var alpha = 0.35 * (1 - k);
            g.beginPath();
            g.ellipse(rp.x * bw, rp.y * bh, radius, radius * 0.32, 0, 0, Math.PI * 2);
            g.strokeStyle = 'rgba(190,225,245,' + alpha.toFixed(3) + ')';
            g.lineWidth = Math.max(1, dpr * 1.4 * (1 - k));
            g.stroke();
        }
    }

    function frame(time) {
        rafId = null;
        try {
            if (!g) return;
            paintWash(time || 0);
            paintRipples(time || 0);
        } catch (e) {}
        // Keep looping while there is anything animated to show.
        if (intensity === 'full' && !reducedMotion) {
            scheduleFrame();
        } else if (ripples.length) {
            scheduleFrame();
        }
    }

    function scheduleFrame() {
        try {
            if (rafId) return;
            var raf = window.requestAnimationFrame || function (fn) {
                return setTimeout(function () { fn(Date.now()); }, 50);
            };
            rafId = raf(frame);
        } catch (e) {}
    }

    function cancelFrame() {
        try {
            if (!rafId) return;
            var caf = window.cancelAnimationFrame || clearTimeout;
            caf(rafId);
        } catch (e) {}
        rafId = null;
    }

    // --- state -------------------------------------------------------------
    function applyState() {
        try {
            if (!ensureCanvas()) return;
            if (intensity === 'off') {
                canvas.style.display = 'none';
                cancelFrame();
                ripples = [];
                return;
            }
            canvas.style.display = '';
            sizeCanvas();
            cancelFrame();
            if (reducedMotion || intensity === 'low') {
                // One static frame; ripples (if any) drawn once.
                paintWash(1200);
                paintRipples(performanceSafeNow());
            } else {
                scheduleFrame();
            }
        } catch (e) {}
    }

    function performanceSafeNow() {
        try {
            if (typeof performance !== 'undefined' && performance.now) return performance.now();
        } catch (e) {}
        return Date.now();
    }

    function setIntensity(level) {
        if (level !== 'off' && level !== 'low' && level !== 'full') return;
        intensity = level;
        applyState();
    }

    // cell: {r, c} board coords. Band fractions: x from the piece-% formula,
    // y from the row (r=4 -> top edge, r=5 -> bottom edge).
    function splash(cell) {
        try {
            if (intensity === 'off' || reducedMotion) return false;
            if (!ensureCanvas()) return false;
            var c = cell && cell.c;
            var r = cell && cell.r;
            if (typeof c !== 'number' || typeof r !== 'number') return false;
            var pieceLeftPct = 5 + c * 11.25;
            var x = (pieceLeftPct - BAND.left) / BAND.width;
            var y = (r <= 4) ? 0.14 : 0.86;
            x = Math.min(0.98, Math.max(0.02, x));
            var now = performanceSafeNow();
            for (var i = 0; i < 3; i++) {
                ripples.push({ x: x, y: y, born: now + i * 160 });
            }
            if (intensity === 'low') {
                // Single static frame: wash + the first ring.
                paintWash(1200);
                paintRipples(now + 400);
            } else {
                scheduleFrame();
            }
            return true;
        } catch (e) { return false; }
    }

    // --- init --------------------------------------------------------------
    reducedMotion = detectReducedMotion();
    try {
        var em = window.effectsManager;
        if (em && (em.intensity === 'off' || em.intensity === 'low' || em.intensity === 'full')) {
            intensity = em.intensity;
        }
    } catch (e) {}
    // Defer canvas creation until the DOM is ready.
    function boot() {
        try {
            reducedMotion = detectReducedMotion();
            applyState();
        } catch (e) {}
    }
    try {
        if (typeof document !== 'undefined' && document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot);
        } else {
            boot();
        }
    } catch (e) {}

    try {
        if (window.GameBus && typeof window.GameBus.on === 'function') {
            window.GameBus.on('soldierCrossRiver', function (e) {
                try { splash(e && e.to); } catch (err) {}
            });
        }
    } catch (e) {}

    window.RiverFX = {
        splash: splash,
        setIntensity: setIntensity,
        // Test-only introspection.
        _debug: {
            state: function () {
                return {
                    intensity: intensity,
                    reducedMotion: reducedMotion,
                    hasCanvas: !!canvas,
                    rippleCount: ripples.length,
                    loopRunning: !!rafId
                };
            }
        }
    };
})();
