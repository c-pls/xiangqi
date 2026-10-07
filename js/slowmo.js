/**
 * slowmo.js — Phase 4 (W3): cinematic slow-motion, mate replay, victory fanfare.
 *
 * Exposes `window.SlowMo` (classic script; assign explicitly to window).
 *
 * API (exact names — the EffectsManager / finale runner calls these):
 *   SlowMo.begin({ minScale = 0.1, downMs = 400 })
 *       Ramps gsap.globalTimeline.timeScale() 1 -> minScale and every vfx.js
 *       sfx Howl's playback rate -> 0.85 over downMs (wall-clock). No-op with a
 *       console warning (never throws) when gsap or the sfx map is absent.
 *       (A global Howler.rate() does not exist in the bundled howler build —
 *       see the audio-mechanism note below — so it is never referenced.)
 *   SlowMo.end({ upMs = 600 })
 *       Ramps both back (timeScale -> 1.0, each Howl -> its exact pre-begin
 *       rate) over upMs. Idempotent.
 *   SlowMo.reset()
 *       Instant restore, no tween: timeScale = 1.0 exactly, every Howl = its
 *       exact pre-begin rate. Safe to call any time (including mid-ramp).
 *   SlowMo.isActive()
 *       Boolean: true between begin() and end()-completion / reset().
 *   SlowMo.playMateReplay(event)
 *       "Replay last move in slow-mo". event = the stored checkmate payload
 *       ({ winningPiece, move }). FULL move-replay variant (see below).
 *       Returns true when the replay was scheduled, false when refused.
 *   SlowMo.playVictoryFanfare()
 *       Layered victory sting via window.audioManager.play() (volume/mute
 *       honored). Also auto-plays on every GameBus 'checkmate' event unless
 *       the effects intensity is 'off'.
 *
 * ---------------------------------------------------------------------------
 * AUDIO MECHANISM — why per-Howl rates instead of a global Howler.rate()
 * ---------------------------------------------------------------------------
 * The original design called for the global Howler.rate(). VERIFIED against
 * the bundled js/howler.min.js (howler.js v2.2.4): the HowlerGlobal object
 * exposes ONLY init/volume/mute/stop/unload/codecs — there is NO global
 * Howler.rate() method in this build. Calling Howler.rate(x) would throw
 * TypeError. SlowMo therefore never touches a global rate; it drives each
 * Howl in the vfx.js `sfx` map individually and restores each Howl's exact
 * pre-begin rate (all 24 ship with an authored rate of 1.25).
 *
 * Interaction with vfx.js playSfx() (verified in howler source):
 *   playSfx() calls sfx[name].rate(1.25, id) AFTER play() — a PER-SOUND-id
 *   override that does NOT change the Howl-level rate. Consequence: any sound
 *   fired through the legacy playSfx path DURING slow-mo plays that instance
 *   at the authored 1.25 (it escapes the slowdown). The manager-owned paths
 *   (audioManager.play -> h.play(), used by phase audio and the fanfare)
 *   inherit the Howl-level rate and ARE slowed. On end()/reset(),
 *   howl.rate(saved) resets the Howl level AND every live sound id, so the
 *   restore is total even if a legacy 1.25 override is still ringing out.
 *
 * ---------------------------------------------------------------------------
 * RESTORE GUARANTEE
 * ---------------------------------------------------------------------------
 * After end() completes or reset() runs, on EVERY path:
 *   gsap.globalTimeline.timeScale() === 1   (when gsap is present)
 *   every sfx Howl rate() === its exact pre-begin value (bit-for-bit: the
 *   ramp endpoint is snapped to the saved snapshot, never left as a float
 *   lerp residue).
 *
 * Paths that MUST restore (integration contract for the EffectsManager /
 * finale worker — slowmo.js cannot edit those files, so these are documented
 * requirements, not code):
 *   1. Normal finale end ......... the checkmate-finale runner calls SlowMo.end().
 *   2. skipAll ................... EffectsManager.skipAll() must call SlowMo.reset().
 *   3. Intensity change mid-finale  setIntensity() must call SlowMo.reset()
 *                                  when SlowMo.isActive().
 *   4. New game .................. EffectsManager.notifyNewGame() must call
 *                                  SlowMo.reset().
 *   5. Re-entrant begin .......... begin() while active is a no-op (warn);
 *                                  rates cannot stack or compound.
 *   6. end()/reset() while idle .. no-ops that still enforce the restored
 *                                  values (hardRestore).
 *
 * ---------------------------------------------------------------------------
 * REPLAY VARIANT — full move replay (unmake -> re-animate in slow-mo)
 * ---------------------------------------------------------------------------
 * Investigation (read-only, js/app.js + js/rules.js):
 *   - rules.js XiangqiGame.undo() is a clean unmake: it pops the history
 *     snapshot and restores board (captured piece included), turn, lastMove,
 *     captured lists, and clears gameOver/winner/winReason.
 *   - app.js handleUndo() wraps it cleanly for the UI: game.undo() +
 *     render() (render() rebuilds ALL piece DOM from game.board, so the
 *     mating piece visually returns to its origin and any captured piece
 *     reappears), clears selection + 3D threats, and refuses while
 *     isAnimating (no torn state).
 *   - Re-executing via app.executeMove() is local-only: outgoing multiplayer
 *     moves go through onMultiplayerMoveIntent (multiplayer.js); executeMove
 *     itself emits only local GameBus events and performs no socket I/O, and
 *     multiplayer.js subscribes to no GameBus events. Re-running the mating
 *     move therefore cannot desync the server (the server already recorded the
 *     terminal state); the replay is simply invisible to the opponent.
 *   - commitMove() re-emits 'checkmate' ({ winningPiece, move }), so the
 *     Phase-4 finale re-runs naturally through the same pipeline — no
 *     finale-specific coupling needed inside slowmo.js.
 * => Full move replay is LOW RISK and is the variant implemented.
 *
 * Flow (triggered by the existing #modalBtnReplay button — see below):
 *   1. read pre-undo history length (our click listener runs; the app.js
 *      listener then closes the modal and calls handleUndo() synchronously);
 *   2. deferred tick: verify the unmake landed (gameOver === false and
 *      history shrank by exactly one — aborts if handleUndo refused);
 *   3. SlowMo.begin({ minScale: 0.25, downMs: 400 }) — gentler than the
 *      0.1 default so the re-run AAA cinematic stays watchable;
 *   4. app.executeMove({ from, to, piece, captured, isCheckmate: true }) —
 *      the piece glides again (CSS, real-time) while GSAP-driven capture /
 *      finale visuals run slowed and audio plays at 0.85 rate;
 *   5. the finale runner MUST call SlowMo.end() when the finale completes
 *      (integration contract, path 1 above). The re-emitted 'checkmate'
 *      refreshes the stored payload, so repeated replays work.
 *
 * Button wiring: index.html already contains
 *   <button id="modalBtnReplay">Replay last move in slow-mo</button>
 * and app.js already binds it to (close modal + handleUndo). slowmo.js adds
 * its own listener WITHOUT touching app.js: our listener only schedules a
 * deferred step, so it composes with app.js's handler regardless of
 * listener order (verified: js/slowmo.js loads BEFORE js/app.js in
 * index.html, but the setTimeout(0) deferral makes ordering irrelevant).
 *
 * Cosmetic notes: clocks are not rewound by undo (pre-existing app.js
 * behavior); the announcer move counter does not decrement on undo
 * (documented in effects-bridge.js).
 *
 * ---------------------------------------------------------------------------
 * VICTORY FANFARE — sfx keys used
 * ---------------------------------------------------------------------------
 * vfx.js `sfx` map holds 24 keys: cannon_charge, fuse_hiss, cannon_fire,
 * ball_whistle, cannon_impact, debris_scatter, smoke_hiss, chariot_capture,
 * horse_capture, horse_run, elephant_capture, advisor_capture,
 * katana_unsheathe, soldier_capture, general_capture, checkmate, epic_check,
 * epic_gong, general_check, cannon_check, chariot_check, horse_check,
 * soldier_check, flying_general_check.
 *
 * No dedicated drum asset exists. The fanfare layers:
 *   - 'checkmate'      — the existing checkmate sting (required by spec)
 *   - 'epic_gong'      — the gong voice
 *   - 'cannon_impact'  — the drum voice (deep percussive boom; closest
 *                        percussive key in the map — documented substitute)
 * Rhythm (wall-clock): t=0 checkmate + drum hit 1; t=350 drum hit 2;
 * t=700 drum hit 3 + gong crash. All through window.audioManager.play() so
 * master/sfx volume and mute apply. Skipped entirely at intensity 'off'.
 *
 * ---------------------------------------------------------------------------
 * RAMP DRIVER NOTE
 * ---------------------------------------------------------------------------
 * The timeScale/audio ramps are driven by a wall-clock rAF loop, NOT by a
 * GSAP tween: a tween living on the global timeline would be slowed by the
 * very timeScale it is changing (asymptotic, never lands — and end()'s
 * ramp-up would crawl). Wall-clock ramps land exactly on schedule.
 *
 * Trauma shake + hit-stop: untouched (remain permanently OFF per user
 * decision). No game-rules or game-logic changes in this file.
 */
(function () {
    'use strict';

    var AUDIO_SLOW_RATE = 0.85;  // effective Howl playback-rate target during slow-mo
    var REPLAY_MIN_SCALE = 0.25; // replay slowdown (gentler than begin()'s 0.1 default)

    var _active = false;
    var _rafId = null;
    var _savedAudioRates = null; // key -> exact Howl rate captured at begin()
    var _lastMateEvent = null;   // latest GameBus 'checkmate' payload

    function warn(msg) {
        try { console.warn('[SlowMo] ' + msg); } catch (e) {}
    }

    function hasGsap() {
        try {
            return typeof gsap !== 'undefined' && gsap && gsap.globalTimeline &&
                typeof gsap.globalTimeline.timeScale === 'function';
        } catch (e) { return false; }
    }

    // vfx.js declares `const sfx` at the top level of a classic script, so it
    // is reachable as a bare identifier from any later classic script.
    function getSfxMap() {
        try { if (typeof sfx !== 'undefined' && sfx) return sfx; } catch (e) {}
        return null;
    }

    function eachHowl(fn) {
        var map = getSfxMap();
        if (!map) return;
        try {
            Object.keys(map).forEach(function (k) {
                var h = map[k];
                if (h && typeof h.rate === 'function') {
                    try { fn(k, h); } catch (e) {}
                }
            });
        } catch (e) {}
    }

    function now() {
        try {
            if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
                return performance.now();
            }
        } catch (e) {}
        return Date.now();
    }

    function raf(fn) {
        try {
            if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
        } catch (e) {}
        return setTimeout(function () { fn(now()); }, 16);
    }

    function cancelRaf(id) {
        try {
            if (typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(id); return; }
        } catch (e) {}
        try { clearTimeout(id); } catch (e) {}
    }

    function stopRamp() {
        if (_rafId !== null && _rafId !== undefined) {
            cancelRaf(_rafId);
            _rafId = null;
        }
    }

    function currentScale() {
        if (!hasGsap()) return 1;
        try { return gsap.globalTimeline.timeScale(); } catch (e) { return 1; }
    }

    function applyScale(v) {
        if (!hasGsap()) return;
        try { gsap.globalTimeline.timeScale(v); } catch (e) {}
    }

    function currentAudioRates() {
        var rates = {};
        eachHowl(function (k, h) {
            try {
                var r = h.rate(); // getter: Howl-level rate (1.25 authored for all 24)
                if (typeof r === 'number' && isFinite(r)) rates[k] = r;
            } catch (e) {}
        });
        return rates;
    }

    function applyAudioRates(rates) {
        if (!rates) return;
        eachHowl(function (k, h) {
            var v = rates[k];
            if (typeof v === 'number' && isFinite(v)) {
                try { h.rate(v); } catch (e) {}
            }
        });
    }

    // Instant, exact restore. The ONLY function that clears _active/_savedAudioRates.
    function hardRestore() {
        stopRamp();
        applyScale(1);
        if (_savedAudioRates) applyAudioRates(_savedAudioRates); // exact snapshot values
        _savedAudioRates = null;
        _active = false;
    }

    // Wall-clock ramp of timeScale + per-Howl rates toward targets.
    // toRates: map key->rate (missing keys keep their current rate).
    function startRamp(toScale, toRates, ms, onDone) {
        stopRamp();
        var fromScale = currentScale();
        var fromRates = currentAudioRates();
        var keys = Object.keys(fromRates);
        var t0 = now();
        var dur = (typeof ms === 'number' && ms >= 0) ? ms : 0;
        function frame() {
            _rafId = null;
            var p = dur <= 0 ? 1 : Math.min(1, Math.max(0, (now() - t0) / dur));
            try {
                applyScale(fromScale + (toScale - fromScale) * p);
                var mixed = {};
                keys.forEach(function (k) {
                    var target = (toRates && typeof toRates[k] === 'number') ? toRates[k] : fromRates[k];
                    mixed[k] = fromRates[k] + (target - fromRates[k]) * p;
                });
                applyAudioRates(mixed);
            } catch (err) { warn('ramp frame failed: ' + err); }
            if (p < 1) {
                _rafId = raf(frame);
            } else {
                try { if (onDone) onDone(); } catch (err) { warn('ramp onDone failed: ' + err); }
            }
        }
        _rafId = raf(frame);
    }

    function slowAudioTarget() {
        var t = {};
        eachHowl(function (k) { t[k] = AUDIO_SLOW_RATE; });
        return t;
    }

    // ------------------------------------------------------------ public API
    function begin(opts) {
        try {
            opts = opts || {};
            var minScale = (typeof opts.minScale === 'number' && isFinite(opts.minScale))
                ? Math.min(1, Math.max(0.01, opts.minScale)) : 0.1;
            var downMs = (typeof opts.downMs === 'number' && opts.downMs >= 0) ? opts.downMs : 400;
            if (_active) { warn('begin: slow-mo already active — no-op'); return false; }
            if (!hasGsap()) warn('begin: gsap.globalTimeline unavailable — timescale ramp skipped');
            if (!getSfxMap()) warn('begin: vfx sfx map unavailable — audio ramp skipped');
            _savedAudioRates = currentAudioRates(); // snapshot BEFORE any change
            _active = true;
            startRamp(minScale, slowAudioTarget(), downMs, null);
            return true;
        } catch (err) { warn('begin failed: ' + err); return false; }
    }

    function end(opts) {
        try {
            opts = opts || {};
            var upMs = (typeof opts.upMs === 'number' && opts.upMs >= 0) ? opts.upMs : 600;
            if (!_active) { hardRestore(); return true; } // idempotent
            var saved = _savedAudioRates || {};
            startRamp(1, saved, upMs, function () {
                hardRestore(); // snap to EXACT saved values (no float residue)
            });
            return true;
        } catch (err) {
            warn('end failed: ' + err);
            try { hardRestore(); } catch (e) {}
            return false;
        }
    }

    function reset() {
        try {
            hardRestore();
            return true;
        } catch (err) { warn('reset failed: ' + err); return false; }
    }

    function isActive() { return _active === true; }

    // ------------------------------------------------------------ fanfare
    // No drum asset exists in the 24-key sfx map; 'cannon_impact' (deep
    // percussive boom) is the documented drum-voice substitute.
    var FANFARE = [
        { t: 0,   key: 'checkmate' },
        { t: 0,   key: 'cannon_impact' },
        { t: 350, key: 'cannon_impact' },
        { t: 700, key: 'cannon_impact' },
        { t: 700, key: 'epic_gong' }
    ];

    function effectsIntensity() {
        try {
            if (window.effectsManager && typeof window.effectsManager.intensity === 'string') {
                return window.effectsManager.intensity;
            }
        } catch (e) {}
        return 'full';
    }

    function playVictoryFanfare() {
        try {
            var am = (typeof window !== 'undefined') ? window.audioManager : null;
            if (!am || typeof am.play !== 'function') {
                warn('playVictoryFanfare: window.audioManager unavailable — skipped');
                return false;
            }
            FANFARE.forEach(function (s) {
                setTimeout(function () {
                    try { am.play(s.key); } catch (e) {}
                }, s.t);
            });
            return true;
        } catch (err) { warn('playVictoryFanfare failed: ' + err); return false; }
    }

    // ------------------------------------------------------------ replay
    function playMateReplay(event) {
        try {
            var e = event || _lastMateEvent;
            if (!e || !e.move) { warn('playMateReplay: no checkmate payload available'); return false; }
            var app = (typeof window !== 'undefined') ? window.app : null;
            if (!app || !app.game) { warn('playMateReplay: window.app/game unavailable'); return false; }
            if (_active) { warn('playMateReplay: slow-mo already active — no-op'); return false; }
            if (app.isAnimating) { warn('playMateReplay: an animation is in flight — try again'); return false; }
            var game = app.game;
            if (!game.gameOver || !Array.isArray(game.history) || game.history.length === 0) {
                warn('playMateReplay: no completed mating move to replay');
                return false;
            }
            var move = e.move;
            if (!move || !move.from || !move.to || !move.piece) {
                warn('playMateReplay: malformed move in payload');
                return false;
            }
            if (typeof app.executeMove !== 'function' || typeof app.handleUndo !== 'function') {
                warn('playMateReplay: app.executeMove/handleUndo unavailable');
                return false;
            }
            // The #modalBtnReplay click ALSO triggers app.js's own listener
            // (close modal + handleUndo), attached after ours. Defer our half
            // so the unmake lands first, then verify it before re-animating.
            var preLen = game.history.length;
            var from = { r: move.from.r, c: move.from.c };
            var to = { r: move.to.r, c: move.to.c };
            var piece = move.piece;
            var captured = move.captured || null;
            setTimeout(function () {
                try {
                    if (app.game.gameOver !== false || app.game.history.length !== preLen - 1) {
                        warn('playMateReplay: unmake did not land (undo refused?) — aborting');
                        return;
                    }
                    begin({ minScale: REPLAY_MIN_SCALE, downMs: 400 });
                    app.executeMove({
                        from: from, to: to, piece: piece,
                        captured: captured, isCheckmate: true
                    });
                    // commitMove() re-emits 'checkmate', re-running the finale
                    // (and refreshing _lastMateEvent). The finale runner MUST
                    // call SlowMo.end() on completion (see header, path 1).
                } catch (err) {
                    warn('playMateReplay deferred step failed: ' + err);
                    try { reset(); } catch (e2) {}
                }
            }, 0);
            return true;
        } catch (err) { warn('playMateReplay failed: ' + err); return false; }
    }

    // ------------------------------------------------------------ wiring
    function bindReplayButton() {
        try {
            if (typeof document === 'undefined' || !document.getElementById) return;
            var btn = document.getElementById('modalBtnReplay');
            if (btn && !btn.__slowmoBound) {
                btn.__slowmoBound = true;
                btn.addEventListener('click', function () { playMateReplay(_lastMateEvent); });
            }
        } catch (e) {}
    }

    function subscribeBus() {
        try {
            var bus = (typeof window !== 'undefined') ? window.GameBus : null;
            if (bus && typeof bus.on === 'function') {
                bus.on('checkmate', function (e) {
                    try {
                        _lastMateEvent = e || null; // stored payload for the replay button
                        if (effectsIntensity() !== 'off') playVictoryFanfare();
                    } catch (err) {}
                });
            }
        } catch (e) {}
    }

    try {
        bindReplayButton();
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('DOMContentLoaded', bindReplayButton);
        }
        subscribeBus();
    } catch (e) {}

    if (typeof window !== 'undefined') {
        window.SlowMo = {
            begin: begin,
            end: end,
            reset: reset,
            isActive: isActive,
            playMateReplay: playMateReplay,
            playVictoryFanfare: playVictoryFanfare
        };
    }
})();
