/**
 * EffectsManager — Phase 1 real implementation (replaces the dead EffectsBridge skeleton).
 *
 * Listens on window.GameBus and routes capture events to the AAA engine with
 * intensity gating ('off' | 'low' | 'full'). Owns a simple FIFO effects queue
 * and a skipAll() escape hatch.
 *
 * CRITICAL INVARIANT: the `commit` callback carried by every 'capture' event
 * must be invoked EXACTLY ONCE on every code path. Missing it soft-locks the
 * game (app.js isAnimating never clears); double-calling corrupts game state.
 * Every path below funnels through a once-guarded `finish()` closure.
 *
 * Game logic must never import this file — it self-instantiates at load and
 * exposes only window.effectsManager. Classic script; assign explicitly to window.
 *
 * Phase 1 scope: only 'capture' is handled. 'move', 'check', 'checkmate' and
 * 'soldierCrossRiver' have explicit no-op stubs (resolved in Phases 3/4);
 * app.js keeps its existing direct calls for those in Phase 1.
 *
 * Phase 3: 'check' is now manager-owned (banner + config-driven cinematic via
 * window.CheckVFX, heartbeat via window.audioManager). 'check' is fire-and-forget:
 * app.js emits it inside commitMove() AFTER game.makeMove() has already landed
 * the move — the event carries no commit callback and the game never waits on
 * the effects. 'move' and 'checkmate' stop the check heartbeat; 'soldierCrossRiver'
 * is owned by js/river-fx.js (Phase 5, self-subscribed). app.js routes checks
 * through the bus with legacy direct calls as fallback.
 *
 * Phase 5 (W3): haptics (navigator.vibrate, guarded) on capture/check/checkmate;
 * announcer popups and sting removed per user request;
 * idle ambience body class (fx-idle-on) toggled per intensity; MusicEngine
 * reset on new game.
 *
 * Phase 4: 'checkmate' is now manager-owned (finale via window.CheckmateVFX,
 * slow-mo via window.SlowMo, game-over modal via window.app). Like 'check' it
 * is fire-and-forget: app.js emits it inside commitMove() AFTER game.makeMove()
 * has already landed the move, so the event carries no commit callback and the
 * game never waits on the effects. The handler stops the check heartbeat first
 * (the old subscription's job), stores the event for the modal's slow-mo
 * replay button, and shows the game-over modal exactly once per run.
 * skipAll() also resets slow-mo and clears checkmate visuals; notifyNewGame()
 * resets slow-mo. When window.CheckmateVFX is absent the handler falls back to
 * the legacy app.js checkmate sequence (graceful degradation until W2's module
 * lands); when window.SlowMo is absent the slow-mo beats are skipped.
 *
 * Binding user decisions honored: trauma shake + hit-stop stay OFF permanently
 * (that code is untouched here and elsewhere).
 */
(function () {
    'use strict';

    var INTENSITIES = ['off', 'low', 'full'];
    var STORAGE_KEY = 'ag_fx_intensity';

    // Phase 2: piece key -> AAAEngine cinematic capture method. Every method
    // accepts a trailing { muteInternalAudio: true } opt (harmless if ignored).
    // (W1 correction: these are the AAAEngine play*Capture names; the
    // playChariotCharge-style names are FX2DEngine sub-methods.)
    var ENGINE_METHODS = {
        C: 'playCannonCapture',
        R: 'playChariotCapture',
        H: 'playHorseCapture',
        E: 'playElephantCapture',
        A: 'playAdvisorCapture',
        P: 'playSoldierCapture',
        K: 'playGeneralCapture'
    };

    // Phase 2: a "full" capture config is one with a non-empty phases array
    // (placeholders have phases: []). Only full configs take the cinematic path.
    function _captureConfigFor(key) {
        var pieces = window.EFFECTS_CONFIG && window.EFFECTS_CONFIG.pieces;
        var entry = pieces && pieces[key];
        var cap = entry && entry.capture;
        if (cap && Array.isArray(cap.phases) && cap.phases.length > 0) return cap;
        return null;
    }

    class EffectsManager {
        constructor() {
            this._queue = [];           // FIFO of capture events waiting behind the in-flight one
            this._inFlight = false;     // true while a capture effect's commit is still pending
            this._pendingCommit = null; // once-guarded finish() for the in-flight capture
            this._mateTimers = [];        // Phase 4: tracked checkmate-phase timeouts (cleared by skipAll/new game)
            this._mateRunId = 0;         // Phase 4: invalidates stale checkmate phases on abort/new game
            this._mateModalShown = false; // Phase 4: the game-over modal shows exactly once per checkmate run
            this._mateInFlight = false;  // Phase 4: true while a manager-owned checkmate finale is running
            this._mateModalPending = false; // true while the post-finale modal delay is armed
            this._mateWasSkipped = false; // Phase 4: set when skipAll() aborts a finale (modal still shows)
            this._lastMateEvent = null;  // Phase 4: last checkmate event (modal "Replay last move in slow-mo")
            this._mateWinnerSide = 'red'; // last checkmate's winning side ('red'|'black'); themes the victory scroll
            this.intensity = 'full';
            this._moveCount = 0;        // Phase 2: counts GameBus 'move' events for announcer moveNumbers
            this._popups = [];          // Phase 2: live announcement popup elements (dismissed by skipAll)
            this._checkGen = 0;         // invalidates stale check phases when check visuals are cleared

            // Resolve intensity: stored value wins; otherwise honor reduced-motion.
            var stored = null;
            try {
                stored = (window.localStorage) ? window.localStorage.getItem(STORAGE_KEY) : null;
            } catch (e) { stored = null; }
            if (INTENSITIES.indexOf(stored) !== -1) {
                this.intensity = stored;
            } else if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                this.intensity = 'low';
            }

            // Phase 5 (W3): idle ambience body class (subtle piece breathing +
            // banner flutter; additive keyframes in style.css). Re-evaluated on
            // intensity changes and when the OS reduced-motion setting changes.
            this._applyIdleClass();
            try {
                var selfIdle = this;
                var rmq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
                if (rmq) {
                    var rmHandler = function () { selfIdle._applyIdleClass(); };
                    if (typeof rmq.addEventListener === 'function') rmq.addEventListener('change', rmHandler);
                    else if (typeof rmq.addListener === 'function') rmq.addListener(rmHandler);
                }
            } catch (e) { /* reduced-motion live updates unavailable — non-fatal */ }

            // Subscribe (guard: event-bus.js is expected to load before this file,
            // but never hard-fail if it didn't).
            if (window.GameBus) {
                window.GameBus.on('capture', (e) => this._onCapture(e));
                // Phase 2: count moves so announceForCapture gets a moveNumber.
                // app.js emits 'move' in executeMove BEFORE the 'capture' emit for the
                // same move, so the count at capture-receipt time is the 1-based move
                // index; only strict adjacency (cur === prev+1) is used. (Undo does
                // not emit; the counter won't decrement on undo — documented.)
                // Phase 3: a 'move' also ends any check ambience (heartbeat off)
                // and clears check visuals — escaping check (or any non-check
                // move) must not leave the laser/tremble/palace overlays on
                // the board. A fresh 'check'/'checkmate' emitted later in the
                // same commit re-renders as needed (both handlers
                // clear-then-render, and clearAll is idempotent).
                window.GameBus.on('move', (e) => { this._moveCount++; this._stopCheckAmbience(); this._clearCheckVFX(); });
                // Phase 3: check cinematics are fully manager-owned (fire-and-forget;
                // the event carries no commit callback — see _onCheck).
                window.GameBus.on('check', (e) => this._onCheck(e));
                // Phase 4: checkmate finales are fully manager-owned
                // (fire-and-forget; see _onCheckmate). The handler stops the
                // Phase-3 check heartbeat itself.
                window.GameBus.on('checkmate', (e) => this._onCheckmate(e));
                window.GameBus.on('soldierCrossRiver', (e) => { /* Phase 5 (W3): owned by js/river-fx.js (self-subscribed) */ });
            } else {
                console.warn('[EffectsManager] window.GameBus not found at load; effects events will not be received.');
            }

            this._bindUi();
        }

        // ---------------------------------------------------------- intensity
        setIntensity(level) {
            if (INTENSITIES.indexOf(level) === -1) {
                console.warn('[EffectsManager] invalid intensity "' + level + '"; expected one of: ' + INTENSITIES.join(', '));
                return;
            }
            // Phase 4 (F4-RESTORE-01): an intensity change mid-finale must
            // restore normal time — reset slow-mo if it is currently active.
            try {
                if (window.SlowMo && typeof window.SlowMo.isActive === 'function' && window.SlowMo.isActive()) {
                    this._slowMoReset();
                }
            } catch (e) { /* slow-mo unavailable — non-fatal */ }
            this.intensity = level;
            // Phase 5 (W3): idle ambience follows intensity (documented in
            // _applyIdleClass); the river wash follows too.
            this._applyIdleClass();
            try {
                if (window.RiverFX && typeof window.RiverFX.setIntensity === 'function') {
                    window.RiverFX.setIntensity(level);
                }
            } catch (e) { /* river fx unavailable — non-fatal */ }
            try {
                if (window.localStorage) window.localStorage.setItem(STORAGE_KEY, level);
            } catch (e) { /* storage unavailable (private mode, sandbox) — non-fatal */ }
            var sel = (typeof document !== 'undefined') ? document.getElementById('fxIntensity') : null;
            if (sel && sel.value !== level) sel.value = level;
        }

        /**
         * Phase 5 (W3): idle ambience toggle. Adds/removes the `fx-idle-on`
         * body class that drives the additive idle keyframes in style.css
         * (subtle piece breathing + check-banner flutter).
         *
         * Documented choice: idle animations are ON at 'full' and 'low'
         * (they are subtle and cheap), OFF at 'off', and forced off under
         * prefers-reduced-motion regardless of intensity.
         */
        _applyIdleClass() {
            try {
                if (typeof document === 'undefined') return;
                var reduced = false;
                try {
                    reduced = !!(window.matchMedia &&
                        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
                } catch (e) {}
                var on = this.intensity !== 'off' && !reduced;
                if (document.body) document.body.classList.toggle('fx-idle-on', on);
            } catch (e) {}
        }

        /**
         * Phase 5 (W3): haptic pulse. Guarded navigator.vibrate — may not
         * exist (desktop browsers); never throws. Call sites place this after
         * the intensity-'off' early returns, so 'off' stays fully silent.
         */
        _haptic(pattern) {
            try {
                if (typeof navigator !== 'undefined' && navigator &&
                    typeof navigator.vibrate === 'function') {
                    navigator.vibrate(pattern);
                }
            } catch (e) { /* haptics unavailable — non-fatal */ }
        }

        // ---------------------------------------------------------- announcer
        /**
         * Phase 2: start-of-game hook. Resets window.Announcer's per-game capture
         * history (FIRST BLOOD / DOUBLE KILL / CANNON MASTER / REVENGE!) so it never
         * leaks across games, and resets the move counter feeding moveNumbers.
         * Call site: app.js resetGame().
         */
        notifyNewGame(gameId) {
            this._moveCount = 0;
            // Phase 3: a new game ends any lingering check ambience/visuals.
            this._clearCheckVFX();
            this._stopCheckAmbience();
            // A new game also wipes any checkmate-finale overlays left on the
            // board (palace cracks, banner, confetti...) — otherwise a rematch
            // starts with the previous game's destruction still visible.
            this._callMateVFX('clearAll', []);
            // Phase 4: a new game resets slow-mo and abandons any in-flight
            // checkmate finale (stale phases no-op via the run id).
            this._slowMoReset();
            this._mateRunId++;
            this._clearMateTimers();
            this._mateInFlight = false;
            this._mateModalShown = false;
            this._mateModalPending = false;
            this._lastMateEvent = null;
            this._mateWinnerSide = 'red';
            // Phase 5 (W3): a new game settles the background music back to
            // baseline intensity (it keeps playing).
            try {
                if (window.MusicEngine && typeof window.MusicEngine.reset === 'function') {
                    window.MusicEngine.reset();
                }
            } catch (err) { /* music unavailable — non-fatal */ }
            if (window.Announcer && typeof window.Announcer.reset === 'function') {
                try { window.Announcer.reset(gameId); } catch (err) {
                    console.error('[EffectsManager] Announcer.reset failed:', err);
                }
            }
        }

        // ---------------------------------------------------------- UI binding
        _bindUi() {
            if (typeof document === 'undefined') return;
            var sel = document.getElementById('fxIntensity');
            if (sel) {
                if (sel.value !== this.intensity) sel.value = this.intensity;
                sel.addEventListener('change', () => this.setIntensity(sel.value));
            }
            var skipBtn = document.getElementById('fxSkipBtn');
            if (skipBtn) {
                skipBtn.addEventListener('click', () => this.skipAll());
            }
        }

        // ---------------------------------------------------------- queue
        _onCapture(event) {
            // Announcer popups (FIRST BLOOD! / DOUBLE KILL! / CANNON MASTER! /
            // REVENGE!) removed per user request (2026-10-06): captures play
            // their cinematics with no toast. js/announcer.js is intentionally
            // left untouched (pure logic, frozen contract, no DOM) in case the
            // feature is ever wanted back.
            // FIFO: a second capture arriving mid-effect waits its turn.
            if (this._inFlight) {
                this._queue.push(event);
                return;
            }
            this._runCapture(event);
        }

        _drain() {
            if (this._inFlight) return;
            var next = this._queue.shift();
            if (next) this._runCapture(next);
        }

        /**
         * Immediately abandon all effects and land every pending move.
         * Invokes the in-flight capture commit (once-guarded) plus the commit
         * of each queued capture, so no move is left uncommitted.
         */
        skipAll() {
            // Drop everything waiting behind the in-flight capture.
            var queued = this._queue.splice(0);

            // Kill the in-flight AAA timeline, if it exposes one.
            if (window.aaaEngine && window.aaaEngine.activeTimeline && typeof window.aaaEngine.activeTimeline.kill === 'function') {
                try { window.aaaEngine.activeTimeline.kill(); } catch (err) {
                    console.error('[EffectsManager] skipAll: activeTimeline.kill failed:', err);
                }
            }

            // Kill in-flight GSAP timelines (guard for environments without gsap).
            if (typeof gsap !== 'undefined' && gsap && gsap.globalTimeline && typeof gsap.globalTimeline.getChildren === 'function') {
                try {
                    gsap.globalTimeline.getChildren().forEach(function (t) {
                        try { if (t && typeof t.kill === 'function') t.kill(); } catch (e) {}
                    });
                } catch (err) {
                    console.error('[EffectsManager] skipAll: gsap kill failed:', err);
                }
            }

            // Clear 2D particles if available.
            if (window.aaaEngine && window.aaaEngine.fx2d && typeof window.aaaEngine.fx2d.clear === 'function') {
                try { window.aaaEngine.fx2d.clear(); } catch (err) {
                    console.error('[EffectsManager] skipAll: fx2d.clear failed:', err);
                }
            }

            // Phase 3: clear check visuals and stop the check heartbeat.
            this._clearCheckVFX();
            this._stopCheckAmbience();

            // Phase 4: reset slow-mo, clear checkmate visuals, and abandon any
            // in-flight checkmate finale. A skipped finale still ends at the
            // game-over modal below — the game is over; the modal is the
            // terminal state.
            this._slowMoReset();
            this._callMateVFX('clearAll', []);
            this._mateRunId++;
            this._clearMateTimers();
            this._mateWasSkipped = this._mateInFlight;
            this._mateInFlight = false;

            // Phase 2: dismiss any visible announcement popups immediately.
            if (this._popups && this._popups.length) {
                this._popups.forEach(function (el) { try { el.remove(); } catch (e) {} });
                this._popups = [];
            }

            // Immediately invoke the pending in-flight capture commit (once-guarded).
            var pending = this._pendingCommit;
            this._pendingCommit = null;
            if (typeof pending === 'function') {
                try { pending(); } catch (err) {
                    console.error('[EffectsManager] skipAll: pending commit failed:', err);
                }
            }

            // Commit queued captures too — their effects are skipped, never their state updates.
            queued.forEach(function (ev) {
                if (ev && typeof ev.commit === 'function') {
                    try { ev.commit(); } catch (err) {
                        console.error('[EffectsManager] skipAll: queued commit failed:', err);
                    }
                }
            });

            // Phase 4: a skipped checkmate finale still lands on the game-over
            // modal — the game is over; the modal is the terminal state.
            if (this._mateWasSkipped) {
                this._mateWasSkipped = false;
                this._showMateModal();
            }
        }

        // (Announcer popup renderer removed per user request — see _onCapture.)

        // ---------------------------------------------------------- capture
        _runCapture(event) {
            var e = event || {};
            if (typeof e.commit !== 'function') {
                console.error('[EffectsManager] capture event without a commit callback — ignoring.');
                return;
            }

            this._inFlight = true;
            var committed = false;
            var self = this;
            // finish(): the ONLY way commit() is invoked — once-guarded.
            var finish = function () {
                if (committed) return;
                committed = true;
                self._pendingCommit = null;
                self._inFlight = false;
                try { e.commit(); } catch (err) {
                    console.error('[EffectsManager] capture commit threw:', err);
                }
                self._drain();
            };
            this._pendingCommit = finish;

            var attacker = e.attacker;
            var from = e.from;
            var to = e.to;
            var targetEl = e.targetEl;
            var movingPieceEl = e.movingPieceEl;

            // 'off': no effects at all — commit immediately.
            if (this.intensity === 'off') {
                finish();
                return;
            }

            // Phase 5 (W3): haptics — a short ~40ms pulse on every capture
            // (low + full; 'off' returned above). Guarded, never throws.
            this._haptic(40);

            // (Announcer popups removed per user request — see _onCapture.)

            // No AAA engine (should not happen in production): never soft-lock.
            if (!window.aaaEngine) {
                setTimeout(finish, 150);
                return;
            }

            // 'low': no visuals, no audio (no neutral capture asset exists;
            // playing a synth blip here would warn every capture), brief pause, then commit.
            if (this.intensity === 'low') {
                setTimeout(finish, 250);
                return;
            }

            // 'full': route through the AAA engine. Any engine exception must
            // still land the commit, so the dispatch is wrapped in try/catch.
            //
            // Phase 2: generic config-driven dispatch. A piece takes the cinematic
            // path when EFFECTS_CONFIG holds a full capture block for it
            // (non-empty phases array); otherwise it falls back to the legacy path.
            try {
                var key = (attacker || '').toUpperCase();
                var methodName = ENGINE_METHODS[key];
                var cfg = _captureConfigFor(key);
                // Phase 3: flying-general duel variant — a general (K) capturing
                // the enemy general along their shared file is the flying-general
                // rule (legal per the shared rules change); it plays the duel
                // cinematic (window.CheckVFX, W3) as the capture variant instead
                // of the standard K capture. Detection uses only event data
                // (from/to/victim) — no game-logic change.
                var duel = this._flyingGeneralDuelCells(e);
                if (duel) {
                    if (this._callCheckVFX('flyingGeneralDuel', [duel.a, duel.b, true])) {
                        // The K capture config's phase audio still scores the duel;
                        // the duel owns the visuals, so the AAA engine is bypassed.
                        (cfg && cfg.phases || []).forEach(function (p) {
                            if (p && p.audio && window.audioManager && typeof window.audioManager.play === 'function') {
                                setTimeout(function () {
                                    try { window.audioManager.play(p.audio); } catch (err) {}
                                }, p.t || 0);
                            }
                        });
                        var duelMs = (cfg && cfg.durationMs) || 2000;
                        setTimeout(function () {
                            self._callCheckVFX('flyingGeneralDuel', [duel.a, duel.b, false]);
                        }, duelMs);
                        setTimeout(finish, duelMs);
                        return;
                    }
                    console.warn('[EffectsManager] flying-general duel detected but CheckVFX.flyingGeneralDuel is unavailable; using the standard K capture.');
                }
                if (methodName && cfg && typeof window.aaaEngine[methodName] === 'function') {
                    // Cinematic path: schedule phase audio from EFFECTS_CONFIG,
                    // then run the cinematic sequence with internal audio muted.
                    cfg.phases.forEach(function (p) {
                        if (p && p.audio && window.audioManager && typeof window.audioManager.play === 'function') {
                            setTimeout(function () {
                                try { window.audioManager.play(p.audio); } catch (err) {}
                            }, p.t || 0);
                        }
                    });
                    window.aaaEngine[methodName](from, to, targetEl, movingPieceEl, finish, { muteInternalAudio: true });
                } else {
                    if (methodName && !cfg) {
                        console.warn('[EffectsManager] no full capture config for piece "' + key + '"; using legacy path.');
                    }
                    // Legacy path, unchanged.
                    window.aaaEngine.playCapture(attacker, from, to, targetEl, movingPieceEl, finish);
                }
            } catch (err) {
                console.error('[EffectsManager] capture effect failed; committing immediately:', err);
                setTimeout(finish, 150);
            }
        }

        // ---------------------------------------------------------- check (Phase 3)
        /**
         * Phase 3: manager-owned check cinematics.
         *
         * COMMIT SEMANTICS (verified in js/app.js): the 'check' event is
         * fire-and-forget. app.js emits it inside commitMove() AFTER
         * game.makeMove() has already landed the move — the event carries no
         * commit callback and the game never waits on check effects. So this
         * handler is pure presentation: it must never hold game state, never
         * delay a move, and never throw (the whole body is try/caught and every
         * external call is guarded).
         *
         * Intensity gating:
         *   'off'  -> clear lingering visuals/ambience, then return
         *             (no new visuals, no audio).
         *   'low'  -> banner + sound only (app's triggerCheckBanner + heartbeat).
         *   'full' -> banner + config-driven CheckVFX sequence (or a default
         *             threat beat when EFFECTS_CONFIG has no full check block).
         */
        _onCheck(event) {
            try {
                var e = event || {};

                // 'off': no visuals, no audio — and silence any lingering check ambience.
                if (this.intensity === 'off') {
                    this._clearCheckVFX();
                    this._stopCheckAmbience();
                    return;
                }

                // Phase 5 (W3): haptics — double pulse on check (low + full).
                this._haptic([30, 60, 30]);

                var pieceKey = (e.pieceKey != null) ? String(e.pieceKey) : '';
                var side = e.side || null;
                var generalCell = e.generalCell || null;
                var checkerPos = e.checkingPos || e.to || null;

                // A new check supersedes any in-progress check visuals.
                this._clearCheckVFX();

                // Double-check stacking: the checker list wins, then the
                // explicit count, then 1. At >=2 the heartbeat escalates
                // (sound — allowed at Low); the vignette escalation below is
                // Full-only so Low stays banner + sound.
                var count = 1;
                if (Array.isArray(e.checkingPieces)) {
                    count = e.checkingPieces.length;
                } else if (typeof e.checkCount === 'number' && e.checkCount > 0) {
                    count = Math.floor(e.checkCount);
                }
                var isDouble = count >= 2;
                // Explicitly reset to 'normal' on single check — the level
                // would otherwise latch on 'high' after any double-check.
                try {
                    if (window.audioManager && typeof window.audioManager.setHeartbeatIntensity === 'function') {
                        window.audioManager.setHeartbeatIntensity(isDouble ? 'high' : 'normal');
                    }
                } catch (err) {}

                // Banner + check sting (app-owned DOM/sound), then the tension
                // heartbeat that runs until the next move or checkmate.
                this._showCheckBanner(pieceKey);
                this._startHeartbeat();

                // 'low': banner + sound only — no CheckVFX visuals.
                if (this.intensity === 'low') return;

                // Full only: double-check vignette escalation (reset on single).
                this._callCheckVFX('setDoubleCheck', [isDouble]);

                // 'full': config-driven when EFFECTS_CONFIG carries a full check
                // block (non-empty phases); otherwise the default threat beat.
                var ctx = {
                    pieceKey: pieceKey, side: side, generalCell: generalCell,
                    checkerPos: checkerPos, from: e.from || null, to: e.to || null
                };
                var cfg = this._checkConfigFor(pieceKey);
                if (cfg) this._runCheckConfig(cfg, ctx);
                else this._runDefaultCheck(pieceKey, ctx);
            } catch (err) {
                console.error('[EffectsManager] check handling failed:', err);
            }
        }

        // Phase-2 contract applied to check blocks: a "full" check config has a
        // non-empty phases array (placeholders like { durationMs, note } do not).
        _checkConfigFor(key) {
            try {
                var pieces = window.EFFECTS_CONFIG && window.EFFECTS_CONFIG.pieces;
                var entry = pieces && pieces[key];
                var chk = entry && entry.check;
                if (chk && Array.isArray(chk.phases) && chk.phases.length > 0) return chk;
            } catch (err) {}
            return null;
        }

        // App-owned check banner (「將軍!」 seal + vignette + legacy check sting).
        // The legacy soundFx.playCheck maps C/R/H/P -> piece stings and anything
        // else -> general_check; 'flyingGeneral' is a general giving check.
        _showCheckBanner(pieceKey) {
            try {
                var bannerType = 'G';
                if (pieceKey === 'C' || pieceKey === 'R' || pieceKey === 'H' || pieceKey === 'P') {
                    bannerType = pieceKey;
                } else if (pieceKey === 'flyingGeneral') {
                    bannerType = 'K';
                }
                if (window.app && typeof window.app.triggerCheckBanner === 'function') {
                    window.app.triggerCheckBanner(bannerType);
                }
            } catch (err) {
                console.error('[EffectsManager] check banner failed:', err);
            }
        }

        _runCheckConfig(cfg, ctx) {
            var self = this;
            var gen = this._checkGen;
            (cfg.phases || []).forEach(function (p) {
                if (!p) return;
                var delay = (typeof p.t === 'number' && p.t >= 0) ? p.t : 0;
                setTimeout(function () {
                    // Superseded: a newer check, an escape move, or checkmate
                    // cleared the visuals after this phase was scheduled — do
                    // not re-add stale overlays/audio.
                    if (gen !== self._checkGen) return;
                    try {
                        // Audio is optional per phase (Phase-2 contract); when
                        // present it must be an exact vfx.js sfx key.
                        if (p.audio && window.audioManager && typeof window.audioManager.play === 'function') {
                            window.audioManager.play(p.audio);
                        }
                        if (p.visual) self._runCheckVisual(p.visual, ctx);
                    } catch (err) {
                        console.error('[EffectsManager] check phase failed:', err);
                    }
                }, delay);
            });
        }

        // Default full-intensity threat beat for pieces without a full check
        // config (incl. 'flyingGeneral' if its config entry is ever removed).
        _runDefaultCheck(pieceKey, ctx) {
            var aimVisuals = {
                C: 'cannonLaserAim', R: 'chariotLane', H: 'horseGhostTrail',
                P: 'soldierAim', flyingGeneral: 'flyingGeneralDuel'
            };
            if (ctx.generalCell) this._callCheckVFX('trembleGeneral', [ctx.generalCell, true]);
            this._callCheckVFX('palaceGlow', [ctx.side || 'red', true]);
            var visual = aimVisuals[pieceKey];
            if (visual) this._runCheckVisual(visual, ctx);
        }

        // Dispatch one config visual name to window.CheckVFX (W3, Phase 3).
        // Every call is guarded; unknown names warn instead of throwing.
        _runCheckVisual(name, ctx) {
            ctx = ctx || {};
            var from = ctx.checkerPos || null;
            var to = ctx.generalCell || null;
            try {
                switch (name) {
                    case 'trembleGeneral':
                    case 'sweatDrops':
                        if (to) this._callCheckVFX(name, [to, true]);
                        break;
                    case 'palaceGlow':
                        this._callCheckVFX(name, [ctx.side || 'red', true]);
                        break;
                    case 'cannonLaserAim':
                        if (from && to) {
                            if (!this._callCheckVFX(name, [from, to, true])) {
                                // Formalize the legacy laser sightline through the
                                // config path until CheckVFX owns this visual.
                                if (window.vfxEngine && typeof window.vfxEngine.playCheckThreat === 'function') {
                                    window.vfxEngine.playCheckThreat(from, to, 'C');
                                }
                            }
                        }
                        break;
                    case 'chariotLane':
                    case 'soldierAim':
                        if (from && to) this._callCheckVFX(name, [from, to, true]);
                        break;
                    case 'horseGhostTrail':
                        this._callCheckVFX(name, [this._horseTrailCells(ctx), true]);
                        break;
                    case 'flyingGeneralDuel':
                        if (from && to) this._callCheckVFX(name, [from, to, true]);
                        break;
                    case 'clearAll':
                        // Ends a config-driven cinematic (e.g. the flyingGeneral
                        // duel at t=1450); idempotent in CheckVFX.
                        this._callCheckVFX('clearAll', []);
                        break;
                    default:
                        console.warn('[EffectsManager] unknown check visual "' + name + '"');
                }
            } catch (err) {
                console.error('[EffectsManager] check visual "' + name + '" failed:', err);
            }
        }

        // Guarded CheckVFX call. Returns true when the method existed and ran.
        _callCheckVFX(name, args) {
            try {
                var vfx = window.CheckVFX;
                if (vfx && typeof vfx[name] === 'function') {
                    vfx[name].apply(vfx, args || []);
                    return true;
                }
            } catch (err) {
                console.error('[EffectsManager] CheckVFX.' + name + ' failed:', err);
            }
            return false;
        }

        _clearCheckVFX() {
            // Bump the generation so phased check timeouts scheduled by an
            // older _runCheckConfig no-op instead of re-adding stale visuals
            // (e.g. a fast escape move landing mid-cinematic).
            this._checkGen++;
            this._callCheckVFX('clearAll', []);
        }

        // Horse ghost-trail path, derived from from/to in the manager.
        // Presentation math, not game logic: a horse's L-path bends at the
        // orthogonally adjacent "leg" cell along the longer axis.
        _horseTrailCells(ctx) {
            var cells = [];
            var hf = (ctx && ctx.from) || null;
            var ht = (ctx && (ctx.checkerPos || ctx.to)) || null;
            function isCell(c) {
                return c && typeof c.r === 'number' && typeof c.c === 'number';
            }
            if (isCell(hf)) cells.push({ r: hf.r, c: hf.c });
            var elbow = null;
            if (isCell(hf) && isCell(ht)) {
                var dr = ht.r - hf.r, dc = ht.c - hf.c;
                var adr = Math.abs(dr), adc = Math.abs(dc);
                if (adr === 2 && adc === 1) elbow = { r: hf.r + (dr > 0 ? 1 : -1), c: hf.c };
                else if (adr === 1 && adc === 2) elbow = { r: hf.r, c: hf.c + (dc > 0 ? 1 : -1) };
            }
            if (elbow) cells.push(elbow);
            if (isCell(ht)) cells.push({ r: ht.r, c: ht.c });
            return cells;
        }

        // Phase 3: flying-general duel detection for captures. A general (K)
        // capturing the enemy general along their shared file is the
        // flying-general rule (legal per the shared rules change); it plays
        // the duel cinematic as the capture variant. Event data only.
        _flyingGeneralDuelCells(e) {
            try {
                e = e || {};
                var attacker = String(e.attacker || '').toUpperCase();
                var victim = (e.victim != null) ? String(e.victim).toUpperCase() : '';
                var from = e.from, to = e.to;
                if (attacker === 'K' && victim === 'K' &&
                    from && to &&
                    typeof from.c === 'number' && typeof to.c === 'number' &&
                    from.c === to.c) {
                    return { a: { r: from.r, c: from.c }, b: { r: to.r, c: to.c } };
                }
            } catch (err) {
                console.error('[EffectsManager] flying-general duel detection failed:', err);
            }
            return null;
        }

        // Check heartbeat (W2, Phase 3 — all guarded until it lands). The
        // heartbeat starts on check and stops on the next 'move'/'checkmate',
        // skipAll(), a new game, or intensity 'off'.
        _startHeartbeat() {
            try {
                if (window.audioManager && typeof window.audioManager.startHeartbeat === 'function') {
                    window.audioManager.startHeartbeat();
                }
            } catch (err) {
                console.error('[EffectsManager] startHeartbeat failed:', err);
            }
        }

        _stopCheckAmbience() {
            try {
                if (window.audioManager && typeof window.audioManager.stopHeartbeat === 'function') {
                    window.audioManager.stopHeartbeat();
                }
            } catch (err) {
                console.error('[EffectsManager] stopHeartbeat failed:', err);
            }
        }

        // ---------------------------------------------------------- checkmate (Phase 4)
        /**
         * Phase 4: manager-owned checkmate finales.
         *
         * COMMIT SEMANTICS (verified in js/app.js): like 'check', 'checkmate' is
         * fire-and-forget. app.js emits it inside commitMove() AFTER
         * game.makeMove() has already landed the move — the event carries no
         * commit callback and the game never waits on the effects. So this
         * handler is pure presentation: it must never hold game state and never
         * throw (the whole body is try/caught and every external call is
         * guarded). The terminal state — the game-over modal — is shown exactly
         * once per run via _showMateModal().
         *
         * Intensity gating:
         *   'off'  -> zero visuals; the game-over modal shows immediately.
         *   'low'  -> shortened beats only: freeze-flash + dim + calligraphy +
         *             modal (no per-piece spectacle, no slow-mo; the victory
         *             fanfare is auto-played by window.SlowMo).
         *   'full' -> global sequence (freeze-frame + impact flash -> slow-mo
         *             ramp -> camera push-in on the losing general -> dim
         *             everything except killer piece + general), then the
         *             config-driven per-piece finale (EFFECTS_CONFIG checkmate
         *             blocks, closing beats included), then slow-mo ramp-up,
         *             board restore, and the modal.
         *
         * When window.CheckmateVFX is absent (W2's Phase-4 module), the handler
         * falls back to the legacy app.js checkmate sequence; when window.SlowMo
         * is absent (W3's Phase-4 module), the slow-mo beats are skipped.
         */
        _onCheckmate(event) {
            try {
                // The old subscription's job, preserved: the check heartbeat
                // always stops on checkmate.
                this._stopCheckAmbience();
                // A new checkmate supersedes any lingering check visuals.
                this._clearCheckVFX();

                var e = event || {};
                // Stored for the game-over modal's "Replay last move in
                // slow-mo" button (app.js reads it via getLastCheckmateEvent).
                this._lastMateEvent = e;
                // The victory scroll is themed by the winning side.
                this._mateWinnerSide = (e && (e.winnerSide === 'black' || e.winnerSide === 'red')) ? e.winnerSide : 'red';
                // Fresh run: reset the once-guard and invalidate stale phases.
                this._mateModalShown = false;
                this._mateModalPending = false;
                this._mateWasSkipped = false;
                this._mateRunId++;
                this._clearMateTimers();

                // 'off': zero visuals — terminal state immediately.
                if (this.intensity === 'off') {
                    this._showMateModal();
                    return;
                }

                // Phase 5 (W3): haptics — longer pattern on checkmate
                // (low + full; 'off' returned above).
                this._haptic([60, 80, 60, 80, 120]);

                // Graceful degradation until W2's module lands.
                if (!window.CheckmateVFX) {
                    console.warn('[EffectsManager] window.CheckmateVFX not found; using legacy checkmate visuals.');
                    this._legacyCheckmateFallback(e);
                    return;
                }

                if (this.intensity === 'low') this._runMateLow(e);
                else this._runMateFull(e);
            } catch (err) {
                console.error('[EffectsManager] checkmate handling failed:', err);
                // Never strand the game without its terminal state.
                try { this._showMateModal(); } catch (e2) {}
            }
        }

        /**
         * Phase 4: the most recent checkmate event, for the game-over modal's
         * "Replay last move in slow-mo" button. Returns the stored event object
         * or null when no checkmate has run since the last new game.
         */
        getLastCheckmateEvent() {
            return this._lastMateEvent || null;
        }

        // Low-intensity mate: shortened beats only — freeze-flash + dim +
        // calligraphy + modal. No per-piece spectacle, no slow-mo. (The victory
        // fanfare is auto-played by window.SlowMo on the 'checkmate' event.)
        _runMateLow(e) {
            var self = this;
            this._mateInFlight = true;
            this._callMateVFX('freezeFlash', []);
            this._callMateVFX('dimBoard', [this._mateKeepCells(e)]);
            this._later(700, function () {
                self._callMateVFX('paintJueSha', []);
            });
            this._later(1600, function () {
                self._callMateVFX('restoreBoard', []);
                self._mateInFlight = false;
            });
            // Let the banner breathe before the modal lands.
            this._mateModalPending = true;
            this._later(1600 + 2200, function () {
                self._showMateModal();
            });
        }

        // Full-intensity mate: global sequence -> config-driven per-piece
        // finale (EFFECTS_CONFIG checkmate blocks, closing beats included) ->
        // slow-mo ramp-up, board restore, modal.
        _runMateFull(e) {
            var self = this;
            this._mateInFlight = true;
            var move = (e && e.move) || {};
            var killerCell = move.to || null;
            var generalCell = (e && e.losingGeneralCell) || null;
            // Camera push-in targets the doomed general; when the general was
            // captured off the board (flying-general mate), the capture square.
            var pushCell = generalCell || killerCell || null;

            // --- global sequence (manager-owned; the checkmate config blocks
            // document that it runs first) ---
            this._callMateVFX('freezeFlash', []);
            this._slowMoBegin({ minScale: 0.25, downMs: 600 });
            if (pushCell) this._callMateVFX('pushIn', [pushCell]);
            this._later(500, function () {
                self._callMateVFX('dimBoard', [self._mateKeepCells(e)]);
            });

            // --- config-driven per-piece finale ---
            // Lead-in lets the global beats land before config t=0 fires.
            var leadMs = 900;
            var cfg = this._mateConfigFor(e && e.pieceKey);
            if (cfg) {
                this._runMateConfig(cfg, leadMs);
                var totalMs = leadMs +
                    ((typeof cfg.durationMs === 'number' && cfg.durationMs > 0) ? cfg.durationMs : 5000);
                this._later(totalMs, function () {
                    self._endMateFull();
                });
            } else {
                // No full checkmate config (E/A placeholders, unknown piece):
                // the closing beats carry the finale on a compact timeline.
                this._runDefaultMateFinale(leadMs);
            }
        }

        // Config-driven finale: each phase's visual dispatches to CheckmateVFX
        // and its audio to the audio manager. Either may be absent on a phase
        // (audio-only / visual-only beats) — same contract as capture/check.
        _runMateConfig(cfg, leadMs) {
            var self = this;
            (cfg.phases || []).forEach(function (p) {
                if (!p) return;
                var delay = leadMs + ((typeof p.t === 'number' && p.t >= 0) ? p.t : 0);
                self._later(delay, function () {
                    if (p.audio && window.audioManager && typeof window.audioManager.play === 'function') {
                        try { window.audioManager.play(p.audio); } catch (err) {}
                    }
                    if (p.visual) self._callMateVFX(p.visual, []);
                });
            });
        }

        // Default finale when no full checkmate config exists: closing beats
        // only, on a compact timeline.
        _runDefaultMateFinale(leadMs) {
            var self = this;
            this._later(leadMs, function () { self._callMateVFX('crownFall', []); });
            this._later(leadMs + 400, function () { self._callMateVFX('flagLower', []); });
            this._later(leadMs + 800, function () { self._callMateVFX('palaceCrumble', []); });
            this._later(leadMs + 1200, function () {
                self._callMateVFX('paintJueSha', []);
            });
            this._later(leadMs + 1900, function () { self._callMateVFX('celebrate', []); });
            this._later(leadMs + 2500, function () { self._endMateFull(); });
        }

        // Closing: slow-mo ramps back up, the board is restored, then — after
        // a beat for the banner and celebration to linger — the game-over
        // modal shows (exactly once per run).
        _endMateFull() {
            var self = this;
            this._slowMoEnd({ upMs: 800 });
            this._callMateVFX('restoreBoard', []);
            this._mateInFlight = false;
            this._mateModalPending = true;
            this._later(2200, function () {
                self._showMateModal();
            });
        }

        // Phase-2 contract applied to checkmate blocks: a "full" checkmate
        // config has a non-empty phases array (E/A placeholders do not).
        // K maps to flyingGeneral — generals mate only via the flying capture.
        _mateConfigFor(key) {
            try {
                if (key === 'K') key = 'flyingGeneral';
                var pieces = window.EFFECTS_CONFIG && window.EFFECTS_CONFIG.pieces;
                var entry = pieces && pieces[key];
                var mate = entry && entry.checkmate;
                if (mate && Array.isArray(mate.phases) && mate.phases.length > 0) return mate;
            } catch (err) {}
            return null;
        }

        // Cells that stay lit through the mate: the killer piece's square and
        // the doomed general's square (when the general is still on the board).
        _mateKeepCells(e) {
            var cells = [];
            try {
                var move = (e && e.move) || {};
                if (move.to && typeof move.to.r === 'number' && typeof move.to.c === 'number') {
                    cells.push({ r: move.to.r, c: move.to.c });
                }
                var g = e && e.losingGeneralCell;
                if (g && typeof g.r === 'number' && typeof g.c === 'number') {
                    cells.push({ r: g.r, c: g.c });
                }
            } catch (err) {}
            return cells;
        }

        // Legacy fallback when window.CheckmateVFX is absent: delegate to the
        // app's own checkmate sequence, which ends at the game-over modal.
        // Mirrors the pre-Phase-4 per-reason behavior (victory sting + modal
        // for the flying-general mate).
        _legacyCheckmateFallback(e) {
            var reason = (e && e.reason) || 'checkmate';
            try {
                if (reason === 'general_captured') {
                    try {
                        if (window.soundFx && typeof window.soundFx.playVictory === 'function') {
                            window.soundFx.playVictory();
                        }
                    } catch (err2) {}
                    var self = this;
                    setTimeout(function () { self._showMateModal(); }, 600);
                    return;
                }
                if (window.app && typeof window.app.playCheckmateClimaxSequence === 'function' &&
                    e && e.move) {
                    window.app.playCheckmateClimaxSequence(e.move);
                    return;
                }
            } catch (err) {
                console.error('[EffectsManager] legacy checkmate fallback failed:', err);
            }
            this._showMateModal();
        }

        // The terminal state: the game-over modal, exactly once per run.
        _showMateModal() {
            if (this._mateModalShown) return;
            this._mateModalShown = true;
            this._mateModalPending = false;
            this._mateInFlight = false;
            try {
                if (window.app && typeof window.app.showGameOverModal === 'function') {
                    window.app.showGameOverModal();
                }
            } catch (err) {
                console.error('[EffectsManager] showGameOverModal failed:', err);
            }
        }

        // Guarded CheckmateVFX call (W2, Phase 4). Returns true when the
        // method existed and ran.
        _callMateVFX(name, args) {
            try {
                var vfx = window.CheckmateVFX;
                if (vfx && typeof vfx[name] === 'function') {
                    // The victory scroll takes the winning side for theming.
                    if (name === 'paintJueSha' && (!args || args.length === 0)) {
                        args = [this._mateWinnerSide || 'red'];
                    }
                    vfx[name].apply(vfx, args || []);
                    return true;
                }
            } catch (err) {
                console.error('[EffectsManager] CheckmateVFX.' + name + ' failed:', err);
            }
            return false;
        }

        // Tracked timeout for checkmate phases: stale phases (from a run that
        // was skipped or superseded by a new game) no-op via the run id.
        _later(ms, fn) {
            var self = this;
            var runId = this._mateRunId;
            var id = setTimeout(function () {
                var i = self._mateTimers.indexOf(id);
                if (i !== -1) self._mateTimers.splice(i, 1);
                if (runId !== self._mateRunId) return;
                try { fn(); } catch (err) {
                    console.error('[EffectsManager] checkmate phase failed:', err);
                }
            }, ms);
            this._mateTimers.push(id);
            return id;
        }

        _clearMateTimers() {
            var timers = this._mateTimers || [];
            this._mateTimers = [];
            timers.forEach(function (id) {
                try { clearTimeout(id); } catch (e) {}
            });
        }

        // Guarded SlowMo calls (W3, Phase 4). Missing module -> beats skipped.
        _slowMoBegin(opts) {
            try {
                if (window.SlowMo && typeof window.SlowMo.begin === 'function') {
                    window.SlowMo.begin(opts);
                }
            } catch (err) {
                console.error('[EffectsManager] SlowMo.begin failed:', err);
            }
        }

        _slowMoEnd(opts) {
            try {
                if (window.SlowMo && typeof window.SlowMo.end === 'function') {
                    window.SlowMo.end(opts);
                }
            } catch (err) {
                console.error('[EffectsManager] SlowMo.end failed:', err);
            }
        }

        _slowMoReset() {
            try {
                if (window.SlowMo && typeof window.SlowMo.reset === 'function') {
                    window.SlowMo.reset();
                }
            } catch (err) {
                console.error('[EffectsManager] SlowMo.reset failed:', err);
            }
        }
    }

    window.effectsManager = new EffectsManager();
})();
