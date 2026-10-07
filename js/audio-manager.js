/**
 * audio-manager.js — Phase 1 cinematic effects: centralized audio control (W2).
 *
 * Loads AFTER js/vfx.js. Exposes `window.audioManager` ONLY after successful
 * init; init is wrapped in try/catch so a failure can never break page load.
 *
 * API:
 *   window.audioManager = {
 *     play(name),            // play sfx[name] at baseVol * vol.sfx; missing -> playSynth()
 *     setVolume({master, sfx, music}),  // clamp 0..1, persist, apply Howler.volume(master)
 *     getVolume(),           // { master, sfx, music }
 *     setMuted(b), isMuted(), toggleMuted(),
 *     playSynth(name)        // Web Audio oscillator blip fallback stub; never throws
 *     startHeartbeat()       // Phase 3: synth heartbeat loop for check cinematics
 *     stopHeartbeat()        // idempotent stop; frees timer + nodes
 *     setHeartbeatIntensity('normal'|'high')  // live rate/gain adjust, or next start
 *   };
 *
 * Notes:
 * - Captures each Howl's authored base volume from vfx.js `sfx` map at init.
 * - window.soundFx.enabled is kept in sync with mute so legacy call sites
 *   (playSfx and the soundFx Proxy semantic methods) respect it. The Proxy
 *   itself is NOT modified.
 * - Music has no audio source yet: vol.music is stored/persisted only.
 * - Binds settings UI (#volMaster / #volSfx / #volMusic / #muteToggle) when
 *   present; each binding is guarded by element existence. (#fxIntensity and
 *   #fxSkipBtn are bound by the effects manager.)
 */

(function () {
    'use strict';

    var LS_MASTER = 'ag_vol_master';
    var LS_SFX = 'ag_vol_sfx';
    var LS_MUSIC = 'ag_vol_music';
    var LS_MUTE = 'ag_mute';

    function clamp01(n) {
        n = Number(n);
        if (!isFinite(n)) return 0;
        return Math.min(1, Math.max(0, n));
    }
    function readNum(key, fallback) {
        try {
            var raw = window.localStorage.getItem(key);
            if (raw === null || raw === undefined || raw === '') return fallback;
            var n = parseFloat(raw);
            return isFinite(n) ? clamp01(n) : fallback;
        } catch (e) { return fallback; }
    }
    function writeNum(key, n) {
        try { window.localStorage.setItem(key, String(clamp01(n))); } catch (e) {}
    }
    function readBool(key, fallback) {
        try {
            var raw = window.localStorage.getItem(key);
            if (raw === null) return fallback;
            return raw === '1' || raw === 'true';
        } catch (e) { return fallback; }
    }
    function writeBool(key, b) {
        try { window.localStorage.setItem(key, b ? '1' : '0'); } catch (e) {}
    }

    try {
        // vfx.js must have loaded first; fail closed otherwise.
        if (typeof sfx === 'undefined' || !sfx) {
            throw new Error('vfx.js sfx map unavailable');
        }

        // Capture authored base volumes before any runtime fade/ducking changes them.
        var baseVol = {};
        Object.keys(sfx).forEach(function (k) {
            try {
                baseVol[k] = (sfx[k] && typeof sfx[k].volume === 'function') ? sfx[k].volume() : 1;
            } catch (e) { baseVol[k] = 1; }
        });

        var vol = {
            master: readNum(LS_MASTER,
                (typeof Howler !== 'undefined' && Howler && typeof Howler.volume === 'function')
                    ? Howler.volume() : 0.42),
            sfx: readNum(LS_SFX, 1),
            music: readNum(LS_MUSIC, 1)
        };
        var muted = readBool(LS_MUTE, false);
        var audioCtx = null;

        function applyMaster() {
            try {
                if (typeof Howler !== 'undefined' && Howler && typeof Howler.volume === 'function') {
                    Howler.volume(vol.master);
                }
            } catch (e) {}
        }

        // Keep the legacy path (playSfx + soundFx Proxy methods) in sync.
        // The Proxy has no set trap, so assigning .enabled lands on its target —
        // the Proxy definition itself is untouched.
        function syncLegacyMute() {
            try {
                if (window.soundFx) window.soundFx.enabled = !muted;
            } catch (e) {}
        }

        function syncUI() {
            try {
                var m = document.getElementById('volMaster');
                if (m) m.value = Math.round(vol.master * 100);
                var s = document.getElementById('volSfx');
                if (s) s.value = Math.round(vol.sfx * 100);
                var mu = document.getElementById('volMusic');
                if (mu) mu.value = Math.round(vol.music * 100);
                var t = document.getElementById('muteToggle');
                if (t) t.checked = muted;
                // Defensive: if the legacy #soundToggle was not replaced, mirror it.
                var legacy = document.getElementById('soundToggle');
                if (legacy) legacy.checked = !muted;
            } catch (e) {}
        }

        function play(name) {
            try {
                if (muted) return;
                if (window.soundFx && window.soundFx.enabled === false) return;
                var h = sfx[name];
                if (!h) { window.audioManager.playSynth(name); return; }
                var base = (typeof baseVol[name] === 'number') ? baseVol[name] : 1;
                try { h.volume(base * vol.sfx); } catch (e) {}
                h.play();
            } catch (e) {
                try { console.warn('[audio] play failed: ' + name, e); } catch (e2) {}
            }
        }

        // Stub fallback for missing assets: tiny oscillator blip; never throws.
        function playSynth(name) {
            try { console.warn('[audio] missing asset: ' + name); } catch (e) {}
            try {
                var AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return;
                if (!audioCtx) audioCtx = new AC();
                if (audioCtx.state === 'suspended') { audioCtx.resume(); }
                var t = audioCtx.currentTime;
                var osc = audioCtx.createOscillator();
                var g = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(660, t);
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.15 * vol.sfx), t + 0.01);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
                osc.connect(g);
                g.connect(audioCtx.destination);
                osc.start(t);
                osc.stop(t + 0.16);
            } catch (e) {
                try { console.warn('[audio] synth failed: ' + name, e); } catch (e2) {}
            }
        }

        function setVolume(v) {
            v = v || {};
            if (v.master !== undefined && v.master !== null && v.master !== '') {
                vol.master = clamp01(v.master);
                writeNum(LS_MASTER, vol.master);
                applyMaster();
            }
            if (v.sfx !== undefined && v.sfx !== null && v.sfx !== '') {
                vol.sfx = clamp01(v.sfx);
                writeNum(LS_SFX, vol.sfx);
            }
            if (v.music !== undefined && v.music !== null && v.music !== '') {
                vol.music = clamp01(v.music);
                writeNum(LS_MUSIC, vol.music);
            }
            syncUI();
        }

        function getVolume() {
            return { master: vol.master, sfx: vol.sfx, music: vol.music };
        }

        function setMuted(b) {
            muted = !!b;
            writeBool(LS_MUTE, muted);
            syncLegacyMute();
            syncUI();
        }

        function isMuted() { return muted; }

        function toggleMuted() { setMuted(!muted); return muted; }

        // ---- Phase 3 (W2): heartbeat loop for check cinematics ----------------
        // NOTE: there is NO heartbeat asset in assets/sounds/ — the heartbeat is
        // synthesized with the Web Audio API (the approved synth fallback), using
        // the same lazily-created audioCtx pattern as playSynth(). Each beat is a
        // low "lub-dub" (two thumps ~220ms apart). Call sites live in
        // js/effects-bridge.js (W1 wires start/stop/intensity):
        //   startHeartbeat()                        — idempotent; 2nd call is a no-op
        //   stopHeartbeat()                         — idempotent; clears timer + nodes
        //   setHeartbeatIntensity('normal'|'high')  — 'normal' = single-check
        //        resting beat; 'high' = faster/louder for stacked double-checks.
        //        Applies live if running, else stored for the next start.
        // Mute + master/sfx volume are honored on every scheduled thump via the
        // existing volume/mute state. Single timer; no leaks on stop.
        var HB_NORMAL = { period: 1000, thumpGain: 0.50 };
        var HB_HIGH   = { period: 620,  thumpGain: 0.80 };
        var hbLevel = 'normal';
        var hbTimer = null;
        var hbNodes = []; // live oscillator/gain nodes, disconnected on stop

        function hbConfig() { return hbLevel === 'high' ? HB_HIGH : HB_NORMAL; }

        function hbAudioCtx() {
            try {
                var AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return null;
                if (!audioCtx) audioCtx = new AC();
                if (audioCtx.state === 'suspended') { audioCtx.resume(); }
                return audioCtx;
            } catch (e) { return null; }
        }

        // One low thump; never throws.
        function hbThump(ctx, t, peak) {
            try {
                var osc = ctx.createOscillator();
                var g = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(58, t);
                osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.015);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
                osc.connect(g);
                g.connect(ctx.destination);
                hbNodes.push(osc, g);
                var done = function () {
                    try { osc.disconnect(); } catch (e) {}
                    try { g.disconnect(); } catch (e) {}
                    var i = hbNodes.indexOf(osc);
                    if (i >= 0) hbNodes.splice(i, 1);
                    i = hbNodes.indexOf(g);
                    if (i >= 0) hbNodes.splice(i, 1);
                };
                if (typeof osc.onended !== 'undefined') osc.onended = done;
                osc.start(t);
                osc.stop(t + 0.25);
            } catch (e) {}
        }

        function hbBeat() {
            try {
                if (!hbTimer) return; // stopped between schedule and fire
                if (muted) return;
                if (window.soundFx && window.soundFx.enabled === false) return;
                var ctx = hbAudioCtx();
                if (!ctx) return;
                var cfg = hbConfig();
                var peak = vol.master * vol.sfx * cfg.thumpGain;
                if (peak <= 0.0002) return;
                var t = ctx.currentTime + 0.02;
                hbThump(ctx, t, peak);
                hbThump(ctx, t + 0.22, peak * 0.85); // "dub", slightly softer
            } catch (e) {}
        }

        function startHeartbeat() {
            try {
                if (hbTimer) return; // idempotent: already running
                if (!hbAudioCtx()) return; // no Web Audio — fail silent
                hbTimer = setInterval(hbBeat, hbConfig().period);
                hbBeat(); // immediate first beat, no wait for the period
            } catch (e) {
                try { console.warn('[audio] heartbeat start failed', e); } catch (e2) {}
            }
        }

        function stopHeartbeat() {
            try {
                if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
                // Disconnect any in-flight nodes so nothing keeps sounding or leaking.
                var nodes = hbNodes;
                hbNodes = [];
                for (var i = 0; i < nodes.length; i++) {
                    try { if (typeof nodes[i].stop === 'function') nodes[i].stop(); } catch (e) {}
                    try { nodes[i].disconnect(); } catch (e) {}
                }
            } catch (e) {}
        }

        function setHeartbeatIntensity(level) {
            try {
                if (level !== 'normal' && level !== 'high') return; // invalid -> ignore
                hbLevel = level;
                if (hbTimer) {
                    // Live switch: restart the single timer with the new period.
                    clearInterval(hbTimer);
                    hbTimer = setInterval(hbBeat, hbConfig().period);
                }
            } catch (e) {}
        }

        function bindUI() {
            try {
                var m = document.getElementById('volMaster');
                if (m) m.addEventListener('input', function (e) {
                    setVolume({ master: Number(e.target.value) / 100 });
                });
                var s = document.getElementById('volSfx');
                if (s) s.addEventListener('input', function (e) {
                    setVolume({ sfx: Number(e.target.value) / 100 });
                });
                var mu = document.getElementById('volMusic');
                if (mu) mu.addEventListener('input', function (e) {
                    setVolume({ music: Number(e.target.value) / 100 });
                });
                var t = document.getElementById('muteToggle');
                if (t) t.addEventListener('change', function (e) {
                    setMuted(e.target.checked);
                });
            } catch (e) {}
        }

        applyMaster();
        syncLegacyMute();
        bindUI();
        syncUI();

        window.audioManager = {
            play: play,
            setVolume: setVolume,
            getVolume: getVolume,
            setMuted: setMuted,
            isMuted: isMuted,
            toggleMuted: toggleMuted,
            playSynth: playSynth,
            startHeartbeat: startHeartbeat,
            stopHeartbeat: stopHeartbeat,
            setHeartbeatIntensity: setHeartbeatIntensity
        };
    } catch (err) {
        try { console.error('[audio] audio-manager init failed; legacy audio unaffected', err); } catch (e) {}
    }
})();
