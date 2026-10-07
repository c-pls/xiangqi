/**
 * CheckmateVFX — Phase 4 checkmate finales (AntiGravity Xiangqi).
 *
 * window.CheckmateVFX exposes one method per checkmate visual; the Phase 4
 * manager calls them by name from EFFECTS_CONFIG checkmate blocks. This
 * module mirrors the js/check-vfx.js (Phase 3) pattern exactly:
 *
 * Global:
 *   freezeFlash()            — freeze-frame white impact flash overlay
 *   pushIn(cell)             — camera push-in toward a cell (CSS transform on #boardLayer)
 *   dimBoard(keepCells)      — dim everything except killer + general cells
 *   restoreBoard()           — undo dimBoard + pushIn
 *
 * Per-piece finales:
 *   cannonPalaceExplosion(side) — palace explosion (fireball, debris, shockwave)
 *   cannonFireworks()           — fireworks for the winner (screen space)
 *   chariotGateSmash(side)      — palace gate smash + splinters + dust
 *   chariotCavalrySweep(from,to)— cavalry charge sweep with dust
 *   horseMoonLeap()             — horse silhouette leap against a moon backdrop
 *   horseLightningStrike(side)  — lightning strike on the palace
 *   soldierSpotlight(cell)      — golden spotlight on the tiny soldier
 *   soldierBow()                — other pieces bow
 *   flyingDuelSlash()           — samurai-duel slash line across the screen
 *
 * Closing beats:
 *   crownFall(cell)    — losing general's crown falls
 *   flagLower(cell)    — his flag lowers
 *   palaceCrumble(side)— palace tiles crack/crumble
 *   paintJueSha()      — 「絕殺」 calligraphy painted stroke-by-stroke
 *   celebrate()        — confetti + lanterns for the winner
 *   clearAll()         — removes every visual this module added (idempotent)
 *
 * Cells are {r, c} (0-based: r 0-9, c 0-8); side is 'red' | 'black'.
 * Palace-targeted methods accept an optional side hint; when omitted the
 * module resolves the losing side from the undimmed general on the board
 * (dimBoard runs before the finales, so the losing general is the one NOT
 * dimmed), falling back to the red palace. Every method is safe to call
 * twice and no-ops when board elements are missing.
 *
 * Design notes (same as Phase 3):
 * - All motion is CSS keyframes (transform/opacity only, GPU-friendly). JS
 *   only creates/removes DOM nodes at activation time — zero per-frame JS.
 * - Board mapping reuses the vfx.js / check-vfx.js convention: cell centers
 *   at (5 + c * 11.25)% x (4.444 + r * 10)% of #boardLayer; palace rects use
 *   the same geometry as CheckVFX.palaceGlow.
 * - Trauma shake + hit-stop stay OFF (binding user decision).
 * - prefers-reduced-motion: every fx-mate-* animation is stilled by the
 *   media query in style.css — overlays render as static frames.
 * - clearAll() is idempotent and sweeps any stray nodes/classes.
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
    // FX2DEngine.getCoord mapping, reused verbatim for sweep overlays.
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

    function mkDiv(className) {
        var el = document.createElement('div');
        el.className = className;
        return el;
    }

    // Phase 5 (W2): effect-theme color lookup. Resolves a semantic palette
    // role from the active window.EffectThemes theme, falling back to the
    // authored color when themes are absent or the role is undefined (the
    // default 'ink' theme keeps its palette empty, so fallbacks win and the
    // shipped look is preserved). See js/effect-themes.js for the contract.
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

    // ------------------------------------------------------------- overlay layers
    var LAYER_ID = 'fxMateLayer';
    var SCREEN_ID = 'fxMateScreen';

    // Board-space overlays: inside #boardOuter (position:relative),
    // z-index 41 — above #fxCheckLayer (40), below #fxCanvas (45).
    function mateLayer() {
        var outer = $('boardOuter');
        if (!outer) return null;
        var el = document.getElementById(LAYER_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = LAYER_ID;
        }
        // Re-attach if a previous clearAll() detached the container.
        if (!el.parentNode) outer.appendChild(el);
        return el;
    }

    // Screen-space overlays: fixed full-viewport container for flashes,
    // moon backdrop, slash, fireworks, JueSha painting and celebration.
    // z-index 90: above the board, below game-over modals.
    function mateScreen() {
        if (!hasDoc() || !document.body) return null;
        var el = document.getElementById(SCREEN_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = SCREEN_ID;
        }
        // Re-attach if a previous clearAll() detached the container.
        if (!el.parentNode) document.body.appendChild(el);
        return el;
    }

    // ------------------------------------------------------------- slot registry
    // One active entry per feature; setSlot() clears the previous entry first,
    // so re-calling a method replaces (never stacks) its overlay.
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

    // Registry of every overlay node this module created, so clearAll can
    // sweep strays even if a slot cleanup missed one.
    var createdNodes = [];

    function track(el) {
        if (el) createdNodes.push(el);
        return el;
    }

    function untrackAll() {
        for (var i = 0; i < createdNodes.length; i++) removeEl(createdNodes[i]);
        createdNodes = [];
    }

    // ------------------------------------------------------------- palace helpers
    // Palace rect geometry (percentages inside #boardLayer), identical to
    // CheckVFX.palaceGlow: black palace rows 0-2, red palace rows 7-9.
    function palaceRect(side) {
        return {
            left: 33.125, width: 33.75, height: 30,
            top: (side === 'red') ? 69.444 : -0.556
        };
    }

    // Losing side: the general that is NOT dimmed (dimBoard runs before the
    // finales, keeping the killer + losing general bright). Falls back to
    // any general found, then to 'red'.
    function loserSide() {
        var layer = $('boardLayer');
        if (!layer || typeof layer.querySelectorAll !== 'function') return 'red';
        var els = layer.querySelectorAll('.piece-wrap');
        var fallback = null;
        for (var i = 0; i < els.length; i++) {
            var t = els[i].textContent || '';
            var side = (t.indexOf('\u5E25') !== -1) ? 'red' :
                       (t.indexOf('\u5C07') !== -1) ? 'black' : null;
            if (!side) continue;
            var dimmed = els[i].classList && els[i].classList.contains('fx-mate-dimmed');
            if (!dimmed) return side;
            if (!fallback) fallback = side;
        }
        return fallback || 'red';
    }

    function resolveSide(hint) {
        return validSide(hint) ? hint : loserSide();
    }

    // Position a board-space zone div over a palace.
    function palaceZone(side) {
        var layer = mateLayer();
        if (!layer) return null;
        var r = palaceRect(resolveSide(side));
        var z = mkDiv('fx-mate-zone');
        z.style.left = r.left + '%';
        z.style.top = r.top + '%';
        z.style.width = r.width + '%';
        z.style.height = r.height + '%';
        return z;
    }

    // The losing general's piece element: explicit cell first, then the
    // undimmed general, then any general.
    function generalEl(cell) {
        if (validCell(cell)) {
            var at = pieceEl(cell);
            if (at) return at;
        }
        var layer = $('boardLayer');
        if (!layer || typeof layer.querySelectorAll !== 'function') return null;
        var els = layer.querySelectorAll('.piece-wrap');
        var fallback = null;
        for (var i = 0; i < els.length; i++) {
            var t = els[i].textContent || '';
            if (t.indexOf('\u5E25') === -1 && t.indexOf('\u5C07') === -1) continue;
            if (!fallback) fallback = els[i];
            if (els[i].classList && !els[i].classList.contains('fx-mate-dimmed')) return els[i];
        }
        return fallback;
    }

    // The killer soldier's cell for the spotlight: explicit cell first, then
    // an undimmed soldier piece, then board center.
    function soldierCell(cell) {
        if (validCell(cell)) return cell;
        var layer = $('boardLayer');
        if (layer && typeof layer.querySelectorAll === 'function') {
            var els = layer.querySelectorAll('.piece-wrap');
            for (var i = 0; i < els.length; i++) {
                var t = els[i].textContent || '';
                if (t.indexOf('\u5175') === -1 && t.indexOf('\u5352') === -1) continue;
                if (els[i].classList && els[i].classList.contains('fx-mate-dimmed')) continue;
                var r = els[i].getAttribute && els[i].getAttribute('data-row');
                var c = els[i].getAttribute && els[i].getAttribute('data-col');
                if (r != null && c != null) return { r: +r, c: +c };
            }
        }
        return { r: 5, c: 4 };
    }

    // Jagged SVG polyline (pixel coords, one-time layout) — shared by the
    // lightning strike and gate-smash impact cracks.
    function jaggedBolt(fx, a, b, className, jitter) {
        if (typeof document.createElementNS !== 'function') return null;
        var outer = $('boardOuter');
        var w = (outer && outer.clientWidth) || 400;
        var h = (outer && outer.clientHeight) || 450;
        var svgNS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('class', 'fx-mate-bolt-svg');
        svg.setAttribute('width', String(w));
        svg.setAttribute('height', String(h));
        svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        var pts = [];
        var SEGS = 8;
        for (var i = 0; i <= SEGS; i++) {
            var t = i / SEGS;
            var px = a.x + (b.x - a.x) * t;
            var py = a.y + (b.y - a.y) * t;
            if (i > 0 && i < SEGS) px += (Math.random() - 0.5) * (jitter || 30); // one-time jitter
            pts.push(px.toFixed(1) + ',' + py.toFixed(1));
        }
        var bolt = document.createElementNS(svgNS, 'polyline');
        bolt.setAttribute('points', pts.join(' '));
        bolt.setAttribute('class', className || 'fx-mate-bolt');
        svg.appendChild(bolt);
        fx.appendChild(svg);
        return track(svg);
    }

    // ------------------------------------------------------------- public API
    window.CheckmateVFX = {
        version: '4.0.0',

        // === GLOBAL ===

        // --- Freeze-frame + white impact flash overlay (screen space).
        // The brief full-white hold IS the freeze-frame beat: no shake,
        // no hit-stop — impact from the flash and its decay.
        freezeFlash: function () {
            clearSlot('flash');
            var scr = mateScreen();
            if (!scr) return;
            var flash = track(mkDiv('fx-mate-flash'));
            scr.appendChild(flash);
            setSlot('flash', function () { removeEl(flash); });
        },

        // --- Camera push-in toward a cell: CSS scale transform on #boardLayer
        // (not #boardOuter, so it never fights the outer cinematic zooms).
        // Transform-origin is set from the cell so the zoom centers on it.
        pushIn: function (cell) {
            clearSlot('push');
            var layer = $('boardLayer');
            if (!layer || !layer.classList) return;
            var c = validCell(cell) ? cell : { r: 4.5, c: 4 };
            var p = cellPct(c);
            layer.style.transformOrigin = p.x.toFixed(2) + '% ' + p.y.toFixed(2) + '%';
            layer.classList.add('fx-mate-pushin');
            setSlot('push', function () {
                layer.classList.remove('fx-mate-pushin');
                layer.style.transformOrigin = '';
            });
        },

        // --- Dim everything except the keeper cells (killer piece + losing
        // general). A dark veil covers the board layer; keepers are lifted
        // above it with a glow ring.
        dimBoard: function (keepCells) {
            clearSlot('dim');
            var layer = $('boardLayer');
            if (!layer || typeof layer.querySelectorAll !== 'function') return;
            var keep = {};
            if (Array.isArray(keepCells)) {
                for (var i = 0; i < keepCells.length; i++) {
                    if (validCell(keepCells[i])) keep[keepCells[i].r + ',' + keepCells[i].c] = true;
                }
            }
            var veil = track(mkDiv('fx-mate-dimveil'));
            layer.appendChild(veil);
            var kept = [];
            var els = layer.querySelectorAll('.piece-wrap');
            for (var k = 0; k < els.length; k++) {
                var el = els[k];
                var r = el.getAttribute && el.getAttribute('data-row');
                var cc = el.getAttribute && el.getAttribute('data-col');
                if (r != null && cc != null && keep[r + ',' + cc]) {
                    if (el.classList) { el.classList.add('fx-mate-keep'); kept.push(el); }
                } else if (el.classList) {
                    el.classList.add('fx-mate-dimmed');
                }
            }
            setSlot('dim', function () {
                removeEl(veil);
                for (var j = 0; j < kept.length; j++) {
                    if (kept[j].classList) kept[j].classList.remove('fx-mate-keep');
                }
                var dimmed = layer.querySelectorAll('.fx-mate-dimmed');
                for (var q = 0; q < dimmed.length; q++) {
                    if (dimmed[q].classList) dimmed[q].classList.remove('fx-mate-dimmed');
                }
            });
        },

        // --- Undo dimBoard + pushIn.
        restoreBoard: function () {
            clearSlot('dim');
            clearSlot('push');
        },

        // === PER-PIECE FINALES ===

        // --- Cannon finale A: the palace explodes — fireball (additive
        // screen blend), debris, shockwave ring, smoke.
        cannonPalaceExplosion: function (side) {
            clearSlot('cannonBoom');
            var layer = mateLayer();
            if (!layer) return;
            var zone = track(palaceZone(side));
            if (!zone) return;
            layer.appendChild(zone);
            var els = [];

            var fire = mkDiv('fx-mate-fireball');
            zone.appendChild(fire); els.push(track(fire));

            var wave = mkDiv('fx-mate-shockwave');
            zone.appendChild(wave); els.push(track(wave));

            for (var i = 0; i < 10; i++) {
                var d = mkDiv('fx-mate-debris');
                var ang = (i / 10) * Math.PI * 2 + Math.random() * 0.5; // one-time spread
                var dist = 60 + Math.random() * 90;
                d.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(0) + 'px');
                d.style.setProperty('--dy', (Math.sin(ang) * dist - 30).toFixed(0) + 'px');
                d.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
                zone.appendChild(d); els.push(track(d));
            }
            for (var s = 0; s < 4; s++) {
                var smoke = mkDiv('fx-mate-smoke');
                smoke.style.left = (20 + s * 20) + '%';
                smoke.style.animationDelay = (0.25 + s * 0.15).toFixed(2) + 's';
                zone.appendChild(smoke); els.push(track(smoke));
            }
            setSlot('cannonBoom', function () { removeEl(zone); });
        },

        // --- Cannon finale B: fireworks for the winner (screen space).
        cannonFireworks: function () {
            clearSlot('fireworks');
            var scr = mateScreen();
            if (!scr) return;
            var wrap = track(mkDiv('fx-mate-fireworks'));
            scr.appendChild(wrap);
            var spots = [
                [20, 30], [50, 20], [80, 32], [32, 48], [68, 50], [50, 62]
            ];
            var colors = _themeColor('celebration', ['#ffd34d', '#ff6b6b', '#7dd3fc', '#f0abfc', '#a3e635']);
            for (var b = 0; b < spots.length; b++) {
                var burst = mkDiv('fx-mate-burst');
                burst.style.left = spots[b][0] + '%';
                burst.style.top = spots[b][1] + '%';
                burst.style.animationDelay = (b * 0.28).toFixed(2) + 's';
                var flash = mkDiv('fx-mate-burstflash');
                flash.style.background = colors[b % colors.length];
                burst.appendChild(flash);
                for (var i = 0; i < 12; i++) {
                    var sp = mkDiv('fx-mate-spark');
                    var ang = (i / 12) * Math.PI * 2;
                    var dist = 46 + (b % 3) * 14;
                    sp.style.background = colors[(b + i) % colors.length];
                    sp.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(0) + 'px');
                    sp.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(0) + 'px');
                    sp.style.animationDelay = (b * 0.28).toFixed(2) + 's';
                    burst.appendChild(sp);
                }
                wrap.appendChild(burst);
            }
            setSlot('fireworks', function () { removeEl(wrap); });
        },

        // --- Chariot finale A: palace gate smash — doors burst open,
        // splinters fly, dust billows, impact flash.
        chariotGateSmash: function (side) {
            clearSlot('gatesmash');
            var layer = mateLayer();
            if (!layer) return;
            var zone = track(palaceZone(side));
            if (!zone) return;
            layer.appendChild(zone);

            var gate = mkDiv('fx-mate-gate');
            var dl = mkDiv('fx-mate-gatedoor-l');
            var dr = mkDiv('fx-mate-gatedoor-r');
            gate.appendChild(dl); gate.appendChild(dr);
            zone.appendChild(gate); track(gate);

            var flash = mkDiv('fx-mate-gateflash');
            zone.appendChild(flash); track(flash);

            // Shockwave ring radiating from the impact.
            var shock = mkDiv('fx-mate-shockwave');
            shock.style.left = '50%'; shock.style.top = '62%';
            zone.appendChild(shock); track(shock);

            for (var i = 0; i < 26; i++) {
                var sp = mkDiv('fx-mate-splinter');
                var ang = (Math.PI * 1.1) + (i / 26) * Math.PI * 0.8; // wider upward fan
                var dist = 70 + Math.random() * 130;
                sp.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(0) + 'px');
                sp.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(0) + 'px');
                sp.style.setProperty('--rot', ((Math.random() * 540) - 270).toFixed(0) + 'deg');
                sp.style.left = '50%'; sp.style.top = '62%';
                sp.style.animationDelay = (0.15 + Math.random() * 0.2).toFixed(2) + 's';
                zone.appendChild(sp); track(sp);
            }
            for (var dI = 0; dI < 9; dI++) {
                var dust = mkDiv('fx-mate-dust');
                dust.style.left = (8 + dI * 11) + '%';
                dust.style.top = '55%';
                dust.style.animationDelay = (0.2 + dI * 0.08).toFixed(2) + 's';
                zone.appendChild(dust); track(dust);
            }
            setSlot('gatesmash', function () { removeEl(zone); });
        },

        // --- Chariot finale B: cavalry charge sweep with dust. Optional
        // from/to cells; defaults to a full-width charge along the river.
        chariotCavalrySweep: function (from, to) {
            clearSlot('sweep');
            var fx = mateLayer();
            var outer = $('boardOuter');
            if (!fx || !outer) return;
            var a = (validCell(from) && validCell(to)) ? cellPx(from.r, from.c) : null;
            var b = (validCell(from) && validCell(to)) ? cellPx(to.r, to.c) : null;
            var wrap = track(mkDiv('fx-mate-sweep'));
            fx.appendChild(wrap);

            var N = 6;
            for (var i = 0; i < N; i++) {
                var horse = mkDiv('fx-mate-rider');
                horse.textContent = '\u99AC';
                horse.style.animationDelay = (i * 0.16).toFixed(2) + 's';
                horse.style.top = (28 + (i % 3) * 11) + '%';
                // Back wave rides slightly smaller and dimmer for depth.
                if (i >= 3) { horse.style.fontSize = '46px'; horse.style.opacity = '0.85'; }
                wrap.appendChild(horse); track(horse);
                for (var p = 0; p < 6; p++) {
                    var dust = mkDiv('fx-mate-dust');
                    dust.style.animationDelay = (i * 0.16 + 0.3 + p * 0.22).toFixed(2) + 's';
                    dust.style.top = (34 + (i % 3) * 11) + '%';
                    dust.style.left = (6 + p * 17) + '%';
                    wrap.appendChild(dust); track(dust);
                }
            }
            // If a real from/to was given, tilt the charge along that line.
            if (a && b && b.x !== a.x) {
                var deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
                wrap.style.transform = 'rotate(' + deg.toFixed(1) + 'deg)';
                wrap.style.transformOrigin = '0 50%';
            }
            setSlot('sweep', function () { removeEl(wrap); });
        },

        // --- Chariot finale: fullscreen katana slash. A white-hot blade of
        // light cuts diagonally across the screen — wide glow, thin core,
        // impact flash, and a lingering afterimage. Screen space.
        katanaSlash: function () {
            clearSlot('katana');
            var scr = mateScreen();
            if (!scr) return;
            var wrap = track(mkDiv('fx-mate-katana'));
            wrap.appendChild(mkDiv('fx-mate-katana-veil'));
            wrap.appendChild(mkDiv('fx-mate-katana-glow'));
            wrap.appendChild(mkDiv('fx-mate-katana-core'));
            wrap.appendChild(mkDiv('fx-mate-katana-flash'));
            wrap.appendChild(mkDiv('fx-mate-katana-after'));
            scr.appendChild(wrap);
            setSlot('katana', function () { removeEl(wrap); });
        },

        // --- Horse finale A: horse silhouette leap against a moon backdrop
        // (screen space).
        horseMoonLeap: function () {
            clearSlot('moonleap');
            var scr = mateScreen();
            if (!scr) return;
            var night = track(mkDiv('fx-mate-night'));
            var moon = mkDiv('fx-mate-moon');
            var horse = mkDiv('fx-mate-leaper');
            horse.textContent = '\u99AC';
            night.appendChild(moon);
            night.appendChild(horse);
            scr.appendChild(night);
            setSlot('moonleap', function () { removeEl(night); });
        },

        // --- Horse finale B: lightning strike on the palace.
        horseLightningStrike: function (side) {
            clearSlot('horsestrike');
            var fx = mateLayer();
            var outer = $('boardOuter');
            if (!fx || !outer) return;
            var r = palaceRect(resolveSide(side));
            var layer = $('boardLayer');
            var l = layer && layer.getBoundingClientRect ? layer.getBoundingClientRect() : null;
            var b = outer.getBoundingClientRect();
            if (!l || !l.width) return;
            // Palace center in #boardOuter-relative pixels.
            var cx = (l.left - b.left) + ((r.left + r.width / 2) / 100) * l.width;
            var cy = (l.top - b.top) + ((r.top + r.height / 2) / 100) * l.height;
            var els = [];
            var dark = track(mkDiv('fx-mate-stormdark'));
            fx.appendChild(dark); els.push(dark);
            var bolt = jaggedBolt(fx, { x: cx + 20, y: -20 }, { x: cx, y: cy }, 'fx-mate-bolt', 44);
            if (bolt) els.push(bolt);
            var impact = track(mkDiv('fx-mate-strikeimpact'));
            impact.style.left = cx.toFixed(1) + 'px';
            impact.style.top = cy.toFixed(1) + 'px';
            impact.style.animationDelay = '0.18s';
            fx.appendChild(impact); els.push(impact);
            var wave = track(mkDiv('fx-mate-shockwave'));
            wave.style.left = cx.toFixed(1) + 'px';
            wave.style.top = cy.toFixed(1) + 'px';
            wave.style.animationDelay = '0.22s';
            fx.appendChild(wave); els.push(wave);
            setSlot('horsestrike', function () {
                for (var i = 0; i < els.length; i++) removeEl(els[i]);
            });
        },

        // --- Soldier finale A: golden spotlight on the tiny soldier.
        soldierSpotlight: function (cell) {
            clearSlot('spotlight');
            var layer = $('boardLayer');
            if (!layer) return;
            var c = soldierCell(cell);
            var p = cellPct(c);
            var spot = track(mkDiv('fx-mate-spotlight'));
            spot.style.left = p.x + '%';
            spot.style.top = p.y + '%';
            layer.appendChild(spot);
            setSlot('spotlight', function () { removeEl(spot); });
        },

        // --- Soldier finale B: the other pieces bow to the tiny soldier.
        // Every piece except the keepers leans forward in a staggered bow.
        soldierBow: function () {
            clearSlot('bow');
            var layer = $('boardLayer');
            if (!layer || typeof layer.querySelectorAll !== 'function') return;
            var els = layer.querySelectorAll('.piece-wrap');
            var bowed = [];
            var n = 0;
            for (var i = 0; i < els.length; i++) {
                var el = els[i];
                if (!el.classList) continue;
                if (el.classList.contains('fx-mate-keep')) continue;
                el.classList.add('fx-mate-bow');
                el.style.animationDelay = ((n % 10) * 0.06).toFixed(2) + 's';
                bowed.push(el);
                n++;
            }
            if (!bowed.length) return;
            setSlot('bow', function () {
                for (var j = 0; j < bowed.length; j++) {
                    if (bowed[j].classList) bowed[j].classList.remove('fx-mate-bow');
                    bowed[j].style.animationDelay = '';
                }
            });
        },

        // --- Flying-general finale: samurai-duel slash line across the
        // screen — a bright diagonal draw, white flash, fade.
        flyingDuelSlash: function () {
            clearSlot('slash');
            var scr = mateScreen();
            if (!scr) return;
            var wrap = track(mkDiv('fx-mate-slashwrap'));
            var line = mkDiv('fx-mate-slashline');
            var flash = mkDiv('fx-mate-slashflash');
            wrap.appendChild(line);
            wrap.appendChild(flash);
            scr.appendChild(wrap);
            setSlot('slash', function () { removeEl(wrap); });
        },

        // === CLOSING BEATS ===

        // --- The losing general's crown falls.
        crownFall: function (cell) {
            clearSlot('crown');
            var gel = generalEl(cell);
            if (!gel || !gel.appendChild) return;
            var crown = track(mkDiv('fx-mate-crown'));
            crown.textContent = '\uD83D\uDC51';
            gel.appendChild(crown);
            setSlot('crown', function () { removeEl(crown); });
        },

        // --- His flag lowers beside him.
        flagLower: function (cell) {
            clearSlot('flag');
            var layer = $('boardLayer');
            if (!layer) return;
            var gel = generalEl(cell);
            var c = null;
            if (gel && gel.getAttribute) {
                var r = gel.getAttribute('data-row');
                var cc = gel.getAttribute('data-col');
                if (r != null && cc != null) c = { r: +r, c: +cc };
            }
            if (!c && validCell(cell)) c = cell;
            if (!c) return;
            var p = cellPct(c);
            var flag = track(mkDiv('fx-mate-flag'));
            flag.style.left = 'calc(' + p.x + '% + 26px)';
            flag.style.top = p.y + '%';
            var pole = mkDiv('fx-mate-flagpole');
            var cloth = mkDiv('fx-mate-flagcloth');
            flag.appendChild(pole);
            flag.appendChild(cloth);
            layer.appendChild(flag);
            setSlot('flag', function () { removeEl(flag); });
        },

        // --- Palace tiles crack and crumble: crack lines drawn over the
        // palace, tile fragments falling, dust.
        palaceCrumble: function (side) {
            clearSlot('crumble');
            var layer = mateLayer();
            if (!layer) return;
            var zone = track(palaceZone(side));
            if (!zone) return;
            layer.appendChild(zone);

            var cracks = mkDiv('fx-mate-cracks');
            var NS = 'http://www.w3.org/2000/svg';
            if (typeof document.createElementNS === 'function') {
                var svg = document.createElementNS(NS, 'svg');
                svg.setAttribute('class', 'fx-mate-cracksvg');
                svg.setAttribute('viewBox', '0 0 100 100');
                svg.setAttribute('preserveAspectRatio', 'none');
                var paths = [
                    '8,4 30,34 26,62 44,92',
                    '92,10 70,40 76,68 58,96',
                    '48,0 52,30 40,55 54,88'
                ];
                for (var i = 0; i < paths.length; i++) {
                    var pl = document.createElementNS(NS, 'polyline');
                    pl.setAttribute('points', paths[i]);
                    pl.setAttribute('class', 'fx-mate-crackline');
                    pl.style.animationDelay = (i * 0.2).toFixed(1) + 's';
                    svg.appendChild(pl);
                }
                cracks.appendChild(svg);
            }
            zone.appendChild(cracks); track(cracks);

            for (var t = 0; t < 8; t++) {
                var tile = mkDiv('fx-mate-tile');
                tile.style.left = (8 + (t % 4) * 24) + '%';
                tile.style.top = (10 + Math.floor(t / 4) * 34) + '%';
                tile.style.setProperty('--rot', ((Math.random() * 160) - 80).toFixed(0) + 'deg');
                tile.style.setProperty('--fall', (70 + Math.random() * 60).toFixed(0) + 'px');
                tile.style.animationDelay = (0.3 + t * 0.09).toFixed(2) + 's';
                zone.appendChild(tile); track(tile);
            }
            for (var dI = 0; dI < 4; dI++) {
                var dust = mkDiv('fx-mate-dust');
                dust.style.left = (20 + dI * 20) + '%';
                dust.style.top = '70%';
                dust.style.animationDelay = (0.5 + dI * 0.12).toFixed(2) + 's';
                zone.appendChild(dust); track(dust);
            }
            setSlot('crumble', function () { removeEl(zone); });
        },

        // --- 「絕殺」 calligraphy painted stroke-by-stroke: each character is
        // revealed by a brush wipe (staggered), then a 勝 seal slams down.
        // The scroll is themed by the winning side: warm rice paper + crimson
        // seal for Red, dark ink paper + moon-white brush + indigo seal for
        // Black. `side` is 'red' | 'black'; defaults to 'red'.
        paintJueSha: function (side) {
            clearSlot('juesha');
            var scr = mateScreen();
            if (!scr) return;
            var wrap = track(mkDiv('fx-mate-juesha'));
            var paper = mkDiv('fx-mate-jzpaper');
            if (side === 'black') paper.classList.add('fx-mate-jzpaper-black');
            else paper.classList.add('fx-mate-jzpaper-red');
            var c1 = mkDiv('fx-mate-jzchar');
            c1.textContent = '\u7D55';
            var c2 = mkDiv('fx-mate-jzchar fx-mate-jzchar-2');
            c2.textContent = '\u6BBA';
            var seal = mkDiv('fx-mate-jzseal');
            seal.textContent = '\u52DD';
            paper.appendChild(c1);
            paper.appendChild(c2);
            paper.appendChild(seal);
            wrap.appendChild(paper);
            scr.appendChild(wrap);
            setSlot('juesha', function () { removeEl(wrap); });
        },

        // --- Confetti + lanterns for the winner (screen space, self-owned
        // fx-mate- nodes — the legacy app.js confetti/lantern loops are
        // inline one-offs, not reusable helpers, so this module renders its
        // own and never touches app.js).
        celebrate: function () {
            clearSlot('celebrate');
            var scr = mateScreen();
            if (!scr) return;
            var wrap = track(mkDiv('fx-mate-celebrate'));
            scr.appendChild(wrap);
            var colors = _themeColor('celebration', ['#facc15', '#ef4444', '#3b82f6', '#22c55e', '#f0abfc', '#fb923c']);
            for (var i = 0; i < 44; i++) {
                var conf = mkDiv('fx-mate-confetti');
                conf.style.left = (Math.random() * 100).toFixed(1) + 'vw';
                conf.style.background = colors[i % colors.length];
                conf.style.animationDuration = (2.4 + Math.random() * 2.2).toFixed(2) + 's';
                conf.style.animationDelay = (Math.random() * 1.6).toFixed(2) + 's';
                if (i % 3 === 0) conf.style.borderRadius = '50%';
                wrap.appendChild(conf); track(conf);
            }
            for (var l = 0; l < 8; l++) {
                var lan = mkDiv('fx-mate-lantern');
                lan.textContent = '\uD83C\uDFF8';
                lan.style.left = (6 + l * 12).toFixed(1) + 'vw';
                lan.style.animationDuration = (5 + Math.random() * 3).toFixed(2) + 's';
                lan.style.animationDelay = (l * 0.35).toFixed(2) + 's';
                wrap.appendChild(lan); track(lan);
            }
            setSlot('celebrate', function () { removeEl(wrap); });
        },

        // --- Remove every overlay/class this module added. Idempotent.
        clearAll: function () {
            var names = Object.keys(active);
            for (var i = 0; i < names.length; i++) clearSlot(names[i]);

            // Defensive sweep: any overlay node this module created.
            untrackAll();

            var layer = $('boardLayer');
            if (layer && layer.classList) {
                layer.classList.remove('fx-mate-pushin');
                layer.style.transformOrigin = '';
            }

            if (hasDoc() && typeof document.querySelectorAll === 'function') {
                // Strip per-piece classes this module adds (never the nodes).
                var cls = document.querySelectorAll('.fx-mate-dimmed, .fx-mate-keep, .fx-mate-bow');
                for (var c = 0; c < cls.length; c++) {
                    if (cls[c].classList) {
                        cls[c].classList.remove('fx-mate-dimmed');
                        cls[c].classList.remove('fx-mate-keep');
                        cls[c].classList.remove('fx-mate-bow');
                    }
                    if (cls[c].style) cls[c].style.animationDelay = '';
                }
                // Stray overlay nodes by class (belt and braces).
                var stray = document.querySelectorAll(
                    '.fx-mate-flash, .fx-mate-dimveil, .fx-mate-zone, .fx-mate-fireworks, ' +
                    '.fx-mate-gate, .fx-mate-sweep, .fx-mate-night, .fx-mate-stormdark, ' +
                    '.fx-mate-strikeimpact, .fx-mate-spotlight, .fx-mate-slashwrap, ' +
                    '.fx-mate-crown, .fx-mate-flag, .fx-mate-juesha, .fx-mate-celebrate, ' +
                    '.fx-mate-bolt-svg'
                );
                for (var s = 0; s < stray.length; s++) removeEl(stray[s]);
            }

            // Drop the (now empty) containers too, so nothing lingers in DOM.
            removeEl($(LAYER_ID));
            removeEl($(SCREEN_ID));
        }
    };
})();
