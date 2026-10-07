/**
 * music.js — Phase 5 (W3): synthesized background music + time-pressure ambience.
 *
 * window.MusicEngine:
 *   start()             — begin the ambient loop. Autoplay-safe: also arms on
 *                         the first user gesture (pointerdown/keydown/touchstart);
 *                         repeated calls are no-ops.
 *   stop()              — fade out and stop; idempotent.
 *   setIntensity(0..1)  — crossfades layers: 0 = sparse pad only, 1 = full pad +
 *                         pentatonic arpeggio + soft bass pulse. Clamped.
 *   reset()             — back to baseline intensity (0.35); keeps playing.
 *                         Call site: EffectsManager.notifyNewGame().
 *
 * No audio assets: a slow two-oscillator pad, a gentle A-minor-pentatonic
 * arpeggio, and a soft bass pulse — all Web Audio synth, tasteful and quiet.
 * Everything runs through one music bus gain kept low; mute + master/music
 * volume from window.audioManager are honored on every scheduler tick
 * (conservative defaults when audioManager is absent).
 *
 * GameBus wiring (all guarded):
 *   'check'     -> setIntensity(1)    (a general is in check: tension up)
 *   'move'      -> setIntensity(BASE) (back down after the reply)
 *   'checkmate' -> settle: brief 0.9 swell, then fade out and stop after ~8s
 *   new game    -> notifyNewGame() calls reset()
 *
 * TIME-PRESSURE HEARTBEAT (reuses the Phase-3 heartbeat synth in
 * audio-manager.js): a light 1s monitor watches window.app.clocks (seconds)
 * while a timed mode is active.
 *   DOCUMENTED THRESHOLD: PRESSURE_THRESHOLD_S = 30s. When either player's
 *   remaining time drops to <= 30s, the heartbeat starts; it stops when the
 *   pressure ends (clocks back above the threshold, unlimited mode, game over,
 *   or new game).
 * Everything is guarded: no window.app / no clocks / no audioManager -> the
 * monitor silently does nothing. The monitor never touches heartbeat
 * intensity — a check-owned 'high' escalation is left alone (start/stop are
 * idempotent, and any pressure-end coincides with the bridge stopping the
 * check ambience anyway, so the two owners cannot fight).
 *
 * The monitor only runs after the first user gesture (autoplay-safe) or an
 * explicit start() call.
 */
(function () {
    'use strict';

    // ---- tuning -----------------------------------------------------------
    var BASE_INTENSITY = 0.35;
    var PRESSURE_THRESHOLD_S = 30; // documented time-pressure threshold
    var TICK_MS = 200;             // scheduler cadence
    var LOOKAHEAD_S = 0.6;         // schedule this far ahead
    var PAD_BAR_S = 8;             // one pad chord per 8s
    var ARP_BEAT_S = 60 / 84 / 2;  // gentle eighth notes at 84 BPM

    // A-minor pentatonic ladder (Hz) for the arpeggio.
    var PENTA = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25];
    // Pad progression roots (Hz): Am - F - C - G.
    var PAD_ROOTS = [110, 87.31, 130.81, 98];

    // ---- state ------------------------------------------------------------
    var ctx = null;
    var musicBus = null;
    var playing = false;
    var targetIntensity = BASE_INTENSITY;
    var smoothIntensity = BASE_INTENSITY;
    var schedTimer = null;
    var nextArpT = 0;
    var nextPadT = 0;
    var nextBassT = 0;
    var padStep = 0;
    var arpStep = 0;
    var gestureArmed = false;
    var settleTimer = null;
    var pressureTimer = null;
    var pressureActive = false;

    function clamp01(n) {
        n = Number(n);
        if (!isFinite(n)) return 0;
        return Math.min(1, Math.max(0, n));
    }

    function audioState() {
        // Effective music level: 0 when muted; else master * music.
        try {
            var am = window.audioManager;
            if (am && typeof am.isMuted === 'function' && am.isMuted()) return 0;
            if (am && typeof am.getVolume === 'function') {
                var v = am.getVolume() || {};
                var m = (typeof v.master === 'number') ? v.master : 1;
                var mu = (typeof v.music === 'number') ? v.music : 1;
                return clamp01(m) * clamp01(mu);
            }
        } catch (e) {}
        return 1;
    }

    function ensureCtx() {
        try {
            if (ctx) {
                if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
                    try { ctx.resume(); } catch (e) {}
                }
                return ctx;
            }
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
            if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
                try { ctx.resume(); } catch (e) {}
            }
            musicBus = ctx.createGain();
            musicBus.gain.value = 0;
            musicBus.connect(ctx.destination);
            return ctx;
        } catch (e) { return null; }
    }

    // One plucked note; never throws.
    function pluck(t, freq, peak, dur, type) {
        try {
            var osc = ctx.createOscillator();
            var g = ctx.createGain();
            osc.type = type || 'sine';
            osc.frequency.setValueAtTime(freq, t);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            osc.connect(g);
            g.connect(musicBus);
            osc.start(t);
            osc.stop(t + dur + 0.05);
        } catch (e) {}
    }

    // One pad chord (root + fifth + octave, slow attack); never throws.
    function padChord(t, root) {
        try {
            [1, 1.5, 2].forEach(function (mult, i) {
                var osc = ctx.createOscillator();
                var g = ctx.createGain();
                var f = ctx.createBiquadFilter();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(root * mult * (i === 2 ? 0.5 : 1), t);
                // Detune the fifth slightly for warmth.
                if (i === 1) osc.detune.setValueAtTime(6, t);
                f.type = 'lowpass';
                // Pad brightens with intensity (crossfade feel).
                f.frequency.setValueAtTime(380 + 620 * smoothIntensity, t);
                f.Q.setValueAtTime(0.6, t);
                var peak = 0.035 + 0.02 * smoothIntensity;
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 2.2);
                g.gain.setValueAtTime(Math.max(0.0002, peak), t + PAD_BAR_S - 2.2);
                g.gain.exponentialRampToValueAtTime(0.0001, t + PAD_BAR_S);
                osc.connect(f);
                f.connect(g);
                g.connect(musicBus);
                osc.start(t);
                osc.stop(t + PAD_BAR_S + 0.1);
            });
        } catch (e) {}
    }

    // ---- scheduler --------------------------------------------------------
    function schedulerTick() {
        try {
            if (!playing || !ctx) return;
            // Smooth the intensity toward the target (crossfade).
            smoothIntensity += (targetIntensity - smoothIntensity) * 0.25;
            if (Math.abs(targetIntensity - smoothIntensity) < 0.005) {
                smoothIntensity = targetIntensity;
            }
            // Live bus level: mute + master/music volume, kept quiet overall.
            var level = audioState() * 0.6;
            try {
                musicBus.gain.setTargetAtTime(level, ctx.currentTime, 0.4);
            } catch (e) {}
            var horizon = ctx.currentTime + LOOKAHEAD_S;
            // Pad chord changes.
            while (nextPadT < horizon) {
                padChord(nextPadT, PAD_ROOTS[padStep % PAD_ROOTS.length]);
                padStep++;
                nextPadT += PAD_BAR_S;
            }
            // Arpeggio: density follows intensity (sparse when calm).
            while (nextArpT < horizon) {
                var density = 0.25 + 0.75 * smoothIntensity;
                // Deterministic-ish thinning: play steps whose index passes.
                if ((arpStep % 4 !== 3) || smoothIntensity > 0.55) {
                    if (Math.random() < density) {
                        var note = PENTA[(arpStep * 2 + padStep) % PENTA.length];
                        var peak = 0.028 + 0.075 * smoothIntensity;
                        pluck(nextArpT, note, peak, 0.55, 'sine');
                    }
                }
                arpStep++;
                nextArpT += ARP_BEAT_S;
            }
            // Soft bass pulse every two bars, scaled by intensity.
            while (nextBassT < horizon) {
                if (smoothIntensity > 0.15) {
                    var broot = PAD_ROOTS[padStep % PAD_ROOTS.length] / 2;
                    pluck(nextBassT, broot, 0.05 + 0.06 * smoothIntensity, 1.6, 'sine');
                }
                nextBassT += PAD_BAR_S * 2;
            }
        } catch (e) {}
    }

    function startScheduler() {
        if (schedTimer) return;
        var t = ctx ? ctx.currentTime + 0.1 : 0;
        nextArpT = t;
        nextPadT = t;
        nextBassT = t + PAD_BAR_S;
        schedTimer = setInterval(schedulerTick, TICK_MS);
        schedulerTick();
    }

    function stopScheduler() {
        if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
    }

    // ---- time-pressure heartbeat monitor ----------------------------------
    function pressureNow() {
        try {
            var app = window.app;
            if (!app || !app.clocks) return false;
            if (app.timeMode === 'unlimited') return false;
            if (app.game && app.game.gameOver) return false;
            var r = Number(app.clocks.red);
            var b = Number(app.clocks.black);
            if (!isFinite(r) || !isFinite(b)) return false;
            return r <= PRESSURE_THRESHOLD_S || b <= PRESSURE_THRESHOLD_S;
        } catch (e) { return false; }
    }

    function pressureTick() {
        try {
            var am = window.audioManager;
            if (!am) return;
            var now = pressureNow();
            if (now && !pressureActive) {
                pressureActive = true;
                // Never touch heartbeat intensity: a check-owned 'high'
                // escalation is left alone; start is idempotent.
                if (typeof am.startHeartbeat === 'function') am.startHeartbeat();
            } else if (!now && pressureActive) {
                pressureActive = false;
                if (typeof am.stopHeartbeat === 'function') am.stopHeartbeat();
            }
        } catch (e) {}
    }

    function ensurePressureWatch() {
        if (pressureTimer) return;
        try {
            pressureTimer = setInterval(pressureTick, 1000);
        } catch (e) {}
    }

    // ---- public API -------------------------------------------------------
    function start() {
        try {
            if (playing) return;
            if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
            if (!ensureCtx()) return; // no Web Audio — fail silent
            playing = true;
            ensurePressureWatch();
            startScheduler();
        } catch (e) {}
    }

    function stop() {
        try {
            if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
            if (!playing) return;
            playing = false;
            stopScheduler();
            // Fade the bus out; leave the context alive for the next start.
            try {
                if (ctx && musicBus) {
                    musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
                }
            } catch (e) {}
            // If time pressure was driving the heartbeat, release it.
            try {
                if (pressureActive) {
                    pressureActive = false;
                    var am = window.audioManager;
                    if (am && typeof am.stopHeartbeat === 'function') am.stopHeartbeat();
                }
            } catch (e) {}
        } catch (e) {}
    }

    function setIntensity(v) {
        targetIntensity = clamp01(v);
        // A manual intensity change cancels a pending checkmate settle.
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    }

    function reset() {
        try {
            if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
            targetIntensity = BASE_INTENSITY;
            // A new game ends time pressure (fresh clocks).
            if (pressureActive) {
                pressureActive = false;
                var am = window.audioManager;
                if (am && typeof am.stopHeartbeat === 'function') am.stopHeartbeat();
            }
        } catch (e) {}
    }

    // ---- autoplay-safe arming ---------------------------------------------
    function armOnGesture() {
        if (gestureArmed) return;
        gestureArmed = true;
        try {
            var kick = function () { start(); };
            ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
                try {
                    window.addEventListener(ev, kick, { once: true, passive: true });
                } catch (e2) {
                    try { window.addEventListener(ev, kick); } catch (e3) {}
                }
            });
        } catch (e) {}
    }

    // ---- GameBus wiring ----------------------------------------------------
    try {
        if (window.GameBus && typeof window.GameBus.on === 'function') {
            window.GameBus.on('check', function () { setIntensity(1); });
            window.GameBus.on('move', function () { setIntensity(BASE_INTENSITY); });
            window.GameBus.on('checkmate', function () {
                try {
                    // Settle: a brief swell, then fade out and stop so the
                    // music does not play over the game-over modal forever.
                    setIntensity(0.9);
                    if (settleTimer) clearTimeout(settleTimer);
                    settleTimer = setTimeout(function () {
                        settleTimer = null;
                        stop();
                    }, 8000);
                } catch (e) {}
            });
        }
    } catch (e) {}

    armOnGesture();

    window.MusicEngine = {
        start: start,
        stop: stop,
        setIntensity: setIntensity,
        reset: reset,
        PRESSURE_THRESHOLD_S: PRESSURE_THRESHOLD_S,
        BASE_INTENSITY: BASE_INTENSITY,
        // Test-only introspection (not part of the public contract).
        _debug: {
            tick: schedulerTick,
            pressureTick: pressureTick,
            pressureNow: pressureNow,
            stopPressureWatch: function () {
                try { if (pressureTimer) { clearInterval(pressureTimer); pressureTimer = null; } } catch (e) {}
            },
            state: function () {
                return {
                    playing: playing,
                    targetIntensity: targetIntensity,
                    smoothIntensity: smoothIntensity,
                    pressureActive: pressureActive,
                    hasCtx: !!ctx
                };
            }
        }
    };
})();
