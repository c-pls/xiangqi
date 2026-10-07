/**
 * CheckVFX — Phase 3 check cinematics (AntiGravity Xiangqi).
 *
 * window.CheckVFX exposes one method per check visual; the Phase 3 manager
 * (W1) calls them by name from EFFECTS_CONFIG check blocks:
 *
 *   trembleGeneral(cell, on)            — CSS trembling animation on the general's piece element
 *   sweatDrops(cell, on)                — sweat droplets (cheap DOM, capped at 3)
 *   palaceGlow(side, on)                — red glow on that side's palace tiles
 *   cannonLaserAim(from, to, on)        — dotted red laser line (extends the vfx.js laser approach)
 *   chariotLane(from, to, on)           — glowing red lane along the file/rank, chevrons at the general
 *   horseGhostTrail(cells, on)          — flashing ghost L-shaped trail through the given cells
 *   soldierAim(from, to, on)            — spear lowered toward the general + faint squad silhouette
 *   flyingGeneralDuel(cellA, cellB, on) — lightning bolt linking both generals + cinematic zoom
 *   setDoubleCheck(on)                  — stronger vignette pulse for double check
 *   clearAll()                          — removes every overlay/class this module added (idempotent)
 *
 * Cells are {r, c} (0-based: r 0-9, c 0-8); side is 'red' | 'black'.
 *
 * Design notes:
 * - All motion is CSS keyframes (transform/opacity only, GPU-friendly). The JS
 *   only creates/removes DOM nodes at activation time — zero per-frame JS cost
 *   and near-zero allocation after activation.
 * - Board mapping reuses the vfx.js FX2DEngine.getCoord approach: cell centers
 *   at (5 + c * 11.25)% x (4.444 + r * 10)% of #boardLayer. Cell-anchored DOM
 *   overlays use the same percentages inside #boardLayer; line overlays are
 *   positioned in #boardOuter-relative pixels computed the same way.
 * - Trauma shake + hit-stop stay OFF (binding user decision): impact comes
 *   from easing, layering and anticipation — never screen shake or freezing.
 * - prefers-reduced-motion: every fx-check-* animation is stilled by the media
 *   query in style.css — overlays render as static glows, sweat/bolt/chevron
 *   flicker is frozen, and the cinematic zoom is disabled. (The effects
 *   manager also drops intensity to 'low' under reduced motion, so these
 *   visuals may never be reached in the first place.)
 * - Every method no-ops safely when board elements are missing or cells are
 *   invalid. clearAll() is idempotent and also sweeps any stray nodes.
 *
 * Classic script; assigns explicitly to window. No dependencies.
 */
(function () {
    'use strict';

    // ------------------------------------------------------------- DOM helpers
    function hasDoc() {
        return (typeof document !== 'undefined') && !!document.getElementById;
    }

    function $(id) {
        return hasDoc() ? document.getElementById(id) : null;
    }

    function validCell(cell) {
        return !!cell &&
            typeof cell.r === 'number' && typeof cell.c === 'number' &&
            isFinite(cell.r) && isFinite(cell.c) &&
            cell.r >= 0 && cell.r <= 9 && cell.c >= 0 && cell.c <= 8;
    }

    function validSide(side) {
        return side === 'red' || side === 'black';
    }

    // Piece token element for a cell (same selector as js/app.js).
    function pieceEl(cell) {
        var layer = $('boardLayer');
        if (!layer || !validCell(cell)) return null;
        return layer.querySelector('.piece-wrap[data-row="' + cell.r + '"][data-col="' + cell.c + '"]');
    }

    // Cell-center percentages inside #boardLayer (same constants as
    // vfx.js getCoord and js/app.js triggerSoldierRiverCross).
    function cellPct(cell) {
        return { x: 5 + cell.c * 11.25, y: 4.444 + cell.r * 10 };
    }

    // Cell centers in #boardOuter-relative pixels — the vfx.js
    // FX2DEngine.getCoord mapping, reused verbatim for line overlays.
    function cellPx(r, c) {
        var outer = $('boardOuter');
        var layer = $('boardLayer');
        if (!outer || !layer) return null;
        var b = outer.getBoundingClientRect();
        var l = layer.getBoundingClientRect();
        if (!l.width || !l.height) return null;
        return {
            x: (l.left - b.left) + ((5 + c * 11.25) / 100) * l.width,
            y: (l.top - b.top) + ((4.444 + r * 10) / 100) * l.height
        };
    }

    function removeEl(el) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    // Phase 5 (W2): effect-theme color lookup. Resolves a semantic palette
    // role from the active window.EffectThemes theme, falling back to the
    // authored color when themes are absent or the role is undefined (the
    // default 'ink' theme keeps its palette empty, so fallbacks win and the
    // shipped look is preserved). See js/effect-themes.js for the contract.
    // This module's colors are otherwise CSS-class-driven (style.css
    // fx-check-* rules); those follow themes via :root custom properties.
    function _themeColor(key, fallback) {
        try {
            var T = (typeof window !== 'undefined') ? window.EffectThemes : null;
            var v = (T && typeof T.palette === 'function') ? T.palette()[key] : undefined;
            if (v === undefined || v === null || v === '') return fallback;
            if (Array.isArray(fallback) && !Array.isArray(v)) return fallback;
            return v;
        } catch (e) {
            return fallback;
        }
    }

    // ------------------------------------------------------------- overlay layer
    var LAYER_ID = 'fxCheckLayer';

    // Dedicated overlay container inside #boardOuter (position:relative),
    // z-index 40: above pieces (10), below #fxCanvas (45).
    function fxLayer() {
        var outer = $('boardOuter');
        if (!outer) return null;
        var el = document.getElementById(LAYER_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = LAYER_ID;
            outer.appendChild(el);
        }
        return el;
    }

    // ------------------------------------------------------------- slot registry
    // One active entry per feature; setSlot() clears the previous entry first,
    // so re-calling a method with on=true replaces (never stacks) its overlay.
    var active = {};

    function clearSlot(name) {
        var fn = active[name];
        if (fn) {
            delete active[name];
            try { fn(); } catch (e) { /* cleanup must never throw */ }
        }
    }

    function setSlot(name, cleanup) {
        clearSlot(name);
        if (typeof cleanup === 'function') active[name] = cleanup;
    }

    // ------------------------------------------------------------- line builder
    // A rotated div from point a toward point b. startT/endT are fractions of
    // the segment (0 = at `from`, 1 = at `to`); used to keep lines off piece faces.
    function lineBetween(a, b, className, startT, endT) {
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (!(len > 2)) return null;
        var s = (startT == null) ? 0 : startT;
        var e = (endT == null) ? 1 : endT;
        var el = document.createElement('div');
        el.className = 'fx-check-line ' + className;
        el.style.left = (a.x + dx * s).toFixed(1) + 'px';
        el.style.top = (a.y + dy * s).toFixed(1) + 'px';
        el.style.width = Math.max(1, len * (e - s)).toFixed(1) + 'px';
        el.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
        return { el: el, dx: dx, dy: dy, len: len, angle: Math.atan2(dy, dx), from: a, to: b };
    }

    function pointOn(line, t) {
        return { x: line.from.x + line.dx * t, y: line.from.y + line.dy * t };
    }

    // ------------------------------------------------------------- public API
    window.CheckVFX = {
        version: '3.0.0',

        // --- 1. CSS trembling animation on the general's piece element.
        trembleGeneral: function (cell, on) {
            clearSlot('tremble');
            if (!on || !validCell(cell)) return;
            var el = pieceEl(cell);
            if (!el || !el.classList) return;
            el.classList.add('fx-check-tremble');
            setSlot('tremble', function () { el.classList.remove('fx-check-tremble'); });
        },

        // --- 2. Sweat droplets above the general's cell (cheap DOM, capped at 3).
        sweatDrops: function (cell, on) {
            clearSlot('sweat');
            if (!on || !validCell(cell)) return;
            var layer = $('boardLayer');
            if (!layer) return;
            var wrap = document.createElement('div');
            wrap.className = 'fx-check-sweat';
            var p = cellPct(cell);
            wrap.style.left = p.x + '%';
            wrap.style.top = p.y + '%';
            var offsets = [-15, 2, 17]; // px offsets around the piece
            for (var i = 0; i < offsets.length; i++) {
                var d = document.createElement('span');
                d.className = 'fx-check-sweat-drop';
                d.textContent = '\uD83D\uDCA7';
                d.style.left = offsets[i] + 'px';
                d.style.animationDelay = (i * 0.3) + 's';
                wrap.appendChild(d);
            }
            layer.appendChild(wrap);
            setSlot('sweat', function () { removeEl(wrap); });
        },

        // --- 3. Red glow over that side's 3x3 palace tiles.
        // Black palace: rows 0-2; red palace: rows 7-9; both cols 3-5.
        palaceGlow: function (side, on) {
            clearSlot('palace');
            if (!on || !validSide(side)) return;
            var layer = $('boardLayer');
            if (!layer) return;
            var el = document.createElement('div');
            el.className = 'fx-check-palace';
            el.style.left = '33.125%';   // 5 + 2.5 * 11.25 (half-cell inset from col 3 center)
            el.style.width = '33.75%';  // 3 * 11.25
            el.style.height = '30%';    // 3 * 10
            // Palace rows span r-0.5..r+2.5 in the 4.444 + r*10 mapping:
            // black -> top (4.444 - 5) = -0.556%; red -> top (4.444 + 7*10 - 5) = 69.444%.
            el.style.top = (side === 'red') ? '69.444%' : '-0.556%';
            layer.appendChild(el);
            setSlot('palace', function () { removeEl(el); });
        },

        // --- 4. Dotted red laser line from the cannon to the general.
        // Extends the existing vfx.js playCheckLaserSight approach (same
        // coordinate mapping), rendered as a DOM dotted line with a target
        // reticle so it reads as "aiming" rather than a solid beam.
        cannonLaserAim: function (from, to, on) {
            clearSlot('laser');
            if (!on || !validCell(from) || !validCell(to)) return;
            var a = cellPx(from.r, from.c);
            var b = cellPx(to.r, to.c);
            var fx = fxLayer();
            if (!a || !b || !fx) return;
            var line = lineBetween(a, b, 'fx-check-laser', 0.08, 0.9);
            if (!line) return;
            var ret = document.createElement('div');
            ret.className = 'fx-check-reticle';
            ret.style.left = b.x.toFixed(1) + 'px';
            ret.style.top = b.y.toFixed(1) + 'px';
            fx.appendChild(line.el);
            fx.appendChild(ret);
            setSlot('laser', function () { removeEl(line.el); removeEl(ret); });
        },

        // --- 5. Glowing red lane along the chariot's file/rank with chevron
        // arrows pointing at the general.
        chariotLane: function (from, to, on) {
            clearSlot('lane');
            if (!on || !validCell(from) || !validCell(to)) return;
            var a = cellPx(from.r, from.c);
            var b = cellPx(to.r, to.c);
            var fx = fxLayer();
            if (!a || !b || !fx) return;
            var line = lineBetween(a, b, 'fx-check-lane', 0, 1);
            if (!line) return;
            var els = [line.el];
            fx.appendChild(line.el);
            // Chevron arrows marching toward the general.
            var deg = (line.angle * 180 / Math.PI).toFixed(1);
            var fractions = [0.3, 0.55, 0.8];
            for (var i = 0; i < fractions.length; i++) {
                var pt = pointOn(line, fractions[i]);
                var ch = document.createElement('div');
                ch.className = 'fx-check-chevron';
                ch.textContent = '\u276F';
                ch.style.left = pt.x.toFixed(1) + 'px';
                ch.style.top = pt.y.toFixed(1) + 'px';
                ch.style.transform = 'translate(-50%, -50%) rotate(' + deg + 'deg)';
                ch.style.animationDelay = (i * 0.18) + 's';
                fx.appendChild(ch);
                els.push(ch);
            }
            setSlot('lane', function () {
                for (var j = 0; j < els.length; j++) removeEl(els[j]);
            });
        },

        // --- 6. Flashing ghost L-shaped trail through the given cells.
        // Capped at 6 markers; stagger gives the "gallop path" read.
        horseGhostTrail: function (cells, on) {
            clearSlot('ghost');
            if (!on || !Array.isArray(cells)) return;
            var layer = $('boardLayer');
            if (!layer) return;
            var list = [];
            for (var i = 0; i < cells.length && list.length < 6; i++) {
                if (validCell(cells[i])) list.push(cells[i]);
            }
            if (!list.length) return;
            var els = [];
            for (var k = 0; k < list.length; k++) {
                var g = document.createElement('div');
                g.className = 'fx-check-ghost';
                g.textContent = '\u99AC';
                var p = cellPct(list[k]);
                g.style.left = p.x + '%';
                g.style.top = p.y + '%';
                g.style.animationDelay = (k * 0.16) + 's';
                layer.appendChild(g);
                els.push(g);
            }
            setSlot('ghost', function () {
                for (var j = 0; j < els.length; j++) removeEl(els[j]);
            });
        },

        // --- 7. Spear lowered from the soldier toward the general, plus a
        // faint squad silhouette (3 ghost pawns) behind the soldier.
        soldierAim: function (from, to, on) {
            clearSlot('spear');
            if (!on || !validCell(from) || !validCell(to)) return;
            var a = cellPx(from.r, from.c);
            var b = cellPx(to.r, to.c);
            var layer = $('boardLayer');
            var fx = fxLayer();
            if (!a || !b || !layer || !fx) return;
            var dist = Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
            if (!(dist > 2)) return;
            var ux = (b.x - a.x) / dist;
            var uy = (b.y - a.y) / dist;
            var l = layer.getBoundingClientRect();
            var cw = l.width * 0.1125; // approx cell width in px

            var els = [];

            // Spear shaft: from the soldier toward the general, ~55% of the gap.
            var spear = document.createElement('div');
            spear.className = 'fx-check-line fx-check-spear';
            spear.style.left = a.x.toFixed(1) + 'px';
            spear.style.top = a.y.toFixed(1) + 'px';
            spear.style.width = (dist * 0.55).toFixed(1) + 'px';
            spear.style.transform = 'rotate(' + Math.atan2(b.y - a.y, b.x - a.x) + 'rad)';
            fx.appendChild(spear);
            els.push(spear);

            // Squad silhouette: read the soldier's glyph from its piece element
            // (\u5175 red / \u5352 black); fallback to \u5175.
            var glyph = '\u5175';
            var pel = pieceEl(from);
            if (pel && pel.textContent && pel.textContent.indexOf('\u5352') !== -1) glyph = '\u5352';

            // Three faint pawns in a wedge behind the soldier.
            var px = -uy, py = ux; // perpendicular
            var spots = [
                { bx: -0.85, perp: 0 },
                { bx: -0.5, perp: 0.6 },
                { bx: -0.5, perp: -0.6 }
            ];
            for (var i = 0; i < spots.length; i++) {
                var s = spots[i];
                var sq = document.createElement('div');
                sq.className = 'fx-check-squad';
                sq.textContent = glyph;
                sq.style.left = (a.x + ux * s.bx * cw + px * s.perp * cw).toFixed(1) + 'px';
                sq.style.top = (a.y + uy * s.bx * cw + py * s.perp * cw).toFixed(1) + 'px';
                fx.appendChild(sq);
                els.push(sq);
            }
            setSlot('spear', function () {
                for (var j = 0; j < els.length; j++) removeEl(els[j]);
            });
        },

        // --- 8. Lightning bolt linking both generals + cinematic zoom.
        // cellA = attacking general, cellB = checked general.
        flyingGeneralDuel: function (cellA, cellB, on) {
            clearSlot('duel');
            if (!on || !validCell(cellA) || !validCell(cellB)) return;
            var a = cellPx(cellA.r, cellA.c);
            var b = cellPx(cellB.r, cellB.c);
            var fx = fxLayer();
            var outer = $('boardOuter');
            if (!a || !b || !fx || !outer) return;
            if (typeof document.createElementNS !== 'function') return;

            var els = [];

            // Jagged bolt as an SVG polyline (pixel coords, one-time layout).
            var w = outer.clientWidth || 400;
            var h = outer.clientHeight || 450;
            var svgNS = 'http://www.w3.org/2000/svg';
            var svg = document.createElementNS(svgNS, 'svg');
            svg.setAttribute('class', 'fx-check-bolt-svg');
            svg.setAttribute('width', String(w));
            svg.setAttribute('height', String(h));
            svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
            var pts = [];
            var SEGS = 7;
            for (var i = 0; i <= SEGS; i++) {
                var t = i / SEGS;
                var pxp = a.x + (b.x - a.x) * t;
                var pyp = a.y + (b.y - a.y) * t;
                if (i > 0 && i < SEGS) pxp += (Math.random() - 0.5) * 26; // one-time jitter
                pts.push(pxp.toFixed(1) + ',' + pyp.toFixed(1));
            }
            var bolt = document.createElementNS(svgNS, 'polyline');
            bolt.setAttribute('points', pts.join(' '));
            bolt.setAttribute('class', 'fx-check-bolt');
            // Phase 5 (W2): theme the bolt stroke inline (inline style wins
            // over the .fx-check-bolt CSS rule; fallback = shipped color).
            bolt.style.stroke = _themeColor('checkDanger', '#fef08a');
            svg.appendChild(bolt);
            fx.appendChild(svg);
            els.push(svg);

            // Shockwave rings on both generals.
            var ends = [a, b];
            for (var k = 0; k < ends.length; k++) {
                var flash = document.createElement('div');
                flash.className = 'fx-check-duel-flash';
                flash.style.left = ends[k].x.toFixed(1) + 'px';
                flash.style.top = ends[k].y.toFixed(1) + 'px';
                flash.style.animationDelay = (k * 0.12) + 's';
                fx.appendChild(flash);
                els.push(flash);
            }

            // Cinematic zoom: smooth scale via CSS transition (no shake).
            if (outer.classList) outer.classList.add('fx-check-duel-zoom');

            setSlot('duel', function () {
                for (var j = 0; j < els.length; j++) removeEl(els[j]);
                if (outer.classList) outer.classList.remove('fx-check-duel-zoom');
            });
        },

        // --- 9. Stronger vignette pulse on #checkVignette for double check.
        setDoubleCheck: function (on) {
            var v = $('checkVignette');
            if (!v || !v.classList) return;
            if (on) v.classList.add('fx-check-double');
            else v.classList.remove('fx-check-double');
        },

        // --- 10. Remove every overlay/class this module added. Idempotent.
        clearAll: function () {
            var names = Object.keys(active);
            for (var i = 0; i < names.length; i++) clearSlot(names[i]);

            var v = $('checkVignette');
            if (v && v.classList) v.classList.remove('fx-check-double');

            var outer = $('boardOuter');
            if (outer && outer.classList) outer.classList.remove('fx-check-duel-zoom');

            // Defensive sweep: anything this module may have left behind.
            if (hasDoc()) {
                var stray = document.querySelectorAll(
                    '.fx-check-sweat, .fx-check-palace, .fx-check-ghost, ' +
                    '.fx-check-laser, .fx-check-lane, .fx-check-chevron, ' +
                    '.fx-check-reticle, .fx-check-spear, .fx-check-squad, ' +
                    '.fx-check-bolt-svg, .fx-check-duel-flash'
                );
                for (var s = 0; s < stray.length; s++) removeEl(stray[s]);
                var trembling = document.querySelectorAll('.fx-check-tremble');
                for (var q = 0; q < trembling.length; q++) {
                    if (trembling[q].classList) trembling[q].classList.remove('fx-check-tremble');
                }
            }
        }
    };
})();
