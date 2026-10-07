'use strict';
/**
 * tests/audio-manager.test.js — contract tests for window.audioManager (W2).
 *
 * Frozen contract:
 *   window.audioManager = {
 *     play(name), setVolume({master, sfx, music}), getVolume(),
 *     setMuted(b), isMuted(), toggleMuted(), playSynth(name)
 *   };
 *   localStorage keys: ag_mute, ag_vol_master, ag_vol_sfx, ag_vol_music.
 *   play() never throws; missing sound -> synth fallback.
 *   If a soundFx stub is present on window, its `enabled` flag syncs with mute.
 *
 * Run:  node tests/audio-manager.test.js
 * Any failing assertion throws -> non-zero exit code.
 *
 * Override the script under test with AUDIO_MANAGER_PATH env var
 * (used by QA to validate this file against a synthetic implementation).
 */
const path = require('path');
const assert = require('node:assert');
const { makeStubs, loadScript } = require('./harness');

const SCRIPT = process.env.AUDIO_MANAGER_PATH || path.join(__dirname, '..', 'js', 'audio-manager.js');

// Stand-in for the vfx.js `sfx` Howl map: audio-manager.js fail-closes
// (window.audioManager never assigned) when `typeof sfx === 'undefined'`.
function makeSfxStub() {
  const calls = { volume: [], play: [] };
  return {
    calls,
    boom: {
      volume(v) { calls.volume.push(v); return 0.8; },
      play() { calls.play.push('boom'); },
    },
  };
}

function freshManager(extraWindow) {
  const stubs = makeStubs();
  if (extraWindow) Object.assign(stubs.window, extraWindow);
  // audio-manager.js fail-closes without the vfx.js `sfx` map (by design);
  // the harness provides the stub here.
  loadScript(stubs, SCRIPT, { sfx: makeSfxStub() });
  const am = stubs.window.audioManager;
  assert.ok(am, `window.audioManager must be defined by ${SCRIPT}`);
  return { stubs, am };
}

// --- shape: all contract methods exist ----------------------------------------
{
  const { am } = freshManager();
  for (const m of ['play', 'setVolume', 'getVolume', 'setMuted', 'isMuted', 'toggleMuted', 'playSynth']) {
    assert.strictEqual(typeof am[m], 'function', `audioManager.${m} must be a function`);
  }
}

// --- 1. play() never throws, even for unknown sounds ---------------------------
{
  const { am } = freshManager();
  assert.doesNotThrow(
    () => am.play('definitely-not-a-real-sound-xyz'),
    'play() must never throw, even for a missing sound'
  );
}

// --- 2. missing sound falls back to playSynth ------------------------------------
{
  const { am } = freshManager();
  let synthCalledWith = null;
  const orig = am.playSynth.bind(am);
  am.playSynth = (name) => { synthCalledWith = name; return orig(name); };
  am.play('another-missing-sound');
  assert.strictEqual(
    synthCalledWith,
    'another-missing-sound',
    'play() of a missing sound must fall back to the public playSynth(name)'
  );
}

// --- 3. volume clamp + persistence round-trip ------------------------------------
{
  const { stubs, am } = freshManager();
  am.setVolume({ master: 2, sfx: -0.5, music: 0.7 });
  const v = am.getVolume();
  assert.strictEqual(v.master, 1, 'master must clamp to 1');
  assert.strictEqual(v.sfx, 0, 'sfx must clamp to 0');
  assert.strictEqual(v.music, 0.7, 'music must stay 0.7');
  assert.strictEqual(stubs.localStorage.getItem('ag_vol_master'), '1');
  assert.strictEqual(stubs.localStorage.getItem('ag_vol_sfx'), '0');
  assert.strictEqual(stubs.localStorage.getItem('ag_vol_music'), '0.7');

  // reload against the SAME localStorage -> persisted values rehydrate
  const stubs2 = makeStubs();
  // audio-manager.js reads window.localStorage: share the store on both refs.
  stubs2.localStorage = stubs2.window.localStorage = stubs.localStorage;
  loadScript(stubs2, SCRIPT, { sfx: makeSfxStub() });
  const v2 = stubs2.window.audioManager.getVolume();
  assert.deepStrictEqual(
    { master: v2.master, sfx: v2.sfx, music: v2.music },
    { master: 1, sfx: 0, music: 0.7 },
    'volume must rehydrate from ag_vol_* localStorage keys'
  );
}

// --- 4. partial setVolume keeps the other channels ----------------------------------
{
  const { am } = freshManager();
  am.setVolume({ master: 1, sfx: 1, music: 1 });
  am.setVolume({ sfx: 0.25 });
  const v = am.getVolume();
  assert.strictEqual(v.sfx, 0.25);
  assert.strictEqual(v.master, 1, 'unspecified channels must be preserved');
  assert.strictEqual(v.music, 1, 'unspecified channels must be preserved');
}

// --- 5. mute round-trip + persistence -------------------------------------------------
{
  const { stubs, am } = freshManager();
  am.setMuted(true);
  assert.strictEqual(am.isMuted(), true, 'isMuted() must be true after setMuted(true)');
  const stored = stubs.localStorage.getItem('ag_mute');
  assert.ok(stored !== null && stored !== '', 'ag_mute must be persisted to localStorage');

  am.toggleMuted();
  assert.strictEqual(am.isMuted(), false, 'toggleMuted() must flip the mute state');

  // reload against the SAME localStorage -> mute rehydrates
  am.setMuted(true);
  const stubs2 = makeStubs();
  // audio-manager.js reads window.localStorage: share the store on both refs.
  stubs2.localStorage = stubs2.window.localStorage = stubs.localStorage;
  loadScript(stubs2, SCRIPT, { sfx: makeSfxStub() });
  assert.strictEqual(
    stubs2.window.audioManager.isMuted(),
    true,
    'muted state must rehydrate from the ag_mute localStorage key'
  );
}

// --- 6. soundFx.enabled syncs with mute when a soundFx stub is present ---------------
{
  const { stubs, am } = freshManager({ soundFx: { enabled: true } });
  am.setMuted(true);
  assert.strictEqual(stubs.window.soundFx.enabled, false, 'soundFx.enabled must go false when muted');
  am.setMuted(false);
  assert.strictEqual(stubs.window.soundFx.enabled, true, 'soundFx.enabled must go true when unmuted');
}

// --- 7. playSynth itself must not throw ------------------------------------------------
{
  const { am } = freshManager();
  assert.doesNotThrow(() => am.playSynth('capture'), 'playSynth() must not throw');
}

// --- 8. (W4b) known sound plays through the sfx Howl with volume scaling ---------------
{
  const stubs = makeStubs();
  const sfx = makeSfxStub();
  loadScript(stubs, SCRIPT, { sfx });
  const am = stubs.window.audioManager;
  assert.ok(am, 'window.audioManager must be defined');
  am.setVolume({ sfx: 0.5 });
  am.play('boom');
  assert.strictEqual(sfx.calls.play.length, 1, 'known sound must call Howl.play()');
  // volume() is called once at init (baseVol capture, no arg) and once per play.
  assert.strictEqual(sfx.calls.volume.length, 2, 'init baseVol read + one play-time write');
  assert.strictEqual(
    sfx.calls.volume.at(-1),
    0.8 * 0.5,
    'Howl volume must be baseVol * vol.sfx (0.8 * 0.5)'
  );
}

console.log('ok - audio-manager contract tests passed');
