'use strict';
/**
 * tests/checkmate-contract.test.js — QA (W4) Phase-4 gate test for the
 * checkmate-finale contract.
 *
 * Landed contract (Phase 4, manager-verified 2026-10-06):
 *   - js/checkmate-vfx.js EXISTS and defines window.CheckmateVFX
 *     (exactly the 19-method API).
 *   - js/slowmo.js EXISTS and defines window.SlowMo.
 *   - index.html references both exactly once, before js/app.js.
 *   - pieces.C/R/H/P/flyingGeneral.checkmate =
 *       { durationMs: 4000..6000, phases: [{ t, visual?, audio? }] }
 *     with a NON-EMPTY phases array. Either of visual/audio may be absent
 *     on a phase (audio-only / visual-only beats — same contract as
 *     capture/check; the manager guards both dispatches).
 *   - pieces.E/A.checkmate = { durationMs: 4000..6000, phases: [] } with an
 *     N/A note: elephants/advisors cannot give check, so the manager never
 *     routes there (falls back to the default closing finale).
 *   - pieces.K.checkmate = { durationMs: 4000..6000, phases: [] } with a
 *     routing note: generals mate only via the flying-general capture; the
 *     manager maps K -> flyingGeneral (_mateConfigFor).
 *   - Each phase: numeric `t` (ms >= 0); `visual` when present names a real
 *     window.CheckmateVFX method; `audio` when present is one of the 24 real
 *     vfx.js sfx keys (never null); at least one of visual/audio is present.
 *   - No `trauma` / `hitStop` keys anywhere in the checkmate blocks
 *     (binding user decision: OFF permanently).
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/checkmate-contract.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { makeStubs, loadScript } = require('./harness');

const ROOT = path.join(__dirname, '..');
const CONFIG_SCRIPT = path.join(ROOT, 'js', 'effects-config.js');
const CHECKMATE_VFX_SCRIPT = path.join(ROOT, 'js', 'checkmate-vfx.js');
const SLOWMO_SCRIPT = path.join(ROOT, 'js', 'slowmo.js');
const INDEX_HTML = path.join(ROOT, 'index.html');

// The 24 real keys of the vfx.js `sfx` map, read verbatim from js/vfx.js
// (const sfx = {...}, Howl entries) on 2026-10-06.
const SFX_KEYS = new Set([
  'advisor_capture', 'ball_whistle', 'cannon_charge', 'cannon_check',
  'cannon_fire', 'cannon_impact', 'chariot_capture', 'chariot_check',
  'checkmate', 'debris_scatter', 'elephant_capture', 'epic_check',
  'epic_gong', 'flying_general_check', 'fuse_hiss', 'general_capture',
  'general_check', 'horse_capture', 'horse_check', 'horse_run',
  'katana_unsheathe', 'smoke_hiss', 'soldier_capture', 'soldier_check',
]);
assert.strictEqual(SFX_KEYS.size, 24, 'sfx stub must hold exactly the 24 real vfx.js keys');

const FULL_PIECES = ['C', 'R', 'H', 'P', 'flyingGeneral'];
// Pieces the manager never routes a full finale to, and the note pattern
// each block must carry documenting why.
const ROUTED_AWAY = {
  E: /never routes/i,      // elephant cannot give check
  A: /never routes/i,      // advisor cannot give check
  K: /flyingGeneral/,      // general mates only via the flying capture
};

const failures = [];
function ok(name) { console.log('ok - ' + name); }
function bad(name, detail) {
  console.log('NOT OK - ' + name + (detail ? ' :: ' + detail : ''));
  failures.push(name);
}

// --- 1. Required implementation files exist ---------------------------------
const vfxExists = fs.existsSync(CHECKMATE_VFX_SCRIPT);
const slowmoExists = fs.existsSync(SLOWMO_SCRIPT);
if (vfxExists) ok('js/checkmate-vfx.js exists');
else bad('js/checkmate-vfx.js exists', 'FILE MISSING — Phase 4 visual engine not landed');
if (slowmoExists) ok('js/slowmo.js exists');
else bad('js/slowmo.js exists', 'FILE MISSING — Phase 4 slow-mo engine not landed');

// --- 2. window.CheckmateVFX / window.SlowMo defined --------------------------
let checkmateVfx = null;
let slowMo = null;
if (vfxExists) {
  try {
    const stubs = makeStubs();
    loadScript(stubs, CHECKMATE_VFX_SCRIPT);
    checkmateVfx = stubs.window.CheckmateVFX;
    if (checkmateVfx && typeof checkmateVfx === 'object') ok('window.CheckmateVFX defined');
    else bad('window.CheckmateVFX defined', 'script loaded but did not assign window.CheckmateVFX');
  } catch (e) {
    bad('window.CheckmateVFX defined', 'load threw: ' + e.message);
  }
} else {
  bad('window.CheckmateVFX defined', 'blocked: js/checkmate-vfx.js missing');
}
if (slowmoExists) {
  try {
    const stubs = makeStubs();
    loadScript(stubs, SLOWMO_SCRIPT);
    slowMo = stubs.window.SlowMo;
    if (slowMo && typeof slowMo === 'object') ok('window.SlowMo defined');
    else bad('window.SlowMo defined', 'script loaded but did not assign window.SlowMo');
  } catch (e) {
    bad('window.SlowMo defined', 'load threw: ' + e.message);
  }
} else {
  bad('window.SlowMo defined', 'blocked: js/slowmo.js missing');
}

// --- 3. index.html script wiring ----------------------------------------------
let html = '';
try { html = fs.readFileSync(INDEX_HTML, 'utf8'); }
catch (e) { bad('index.html readable', e.message); }
if (html) {
  const tags = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const countVfx = tags.filter(t => t === 'js/checkmate-vfx.js').length;
  const countSlow = tags.filter(t => t === 'js/slowmo.js').length;
  const appIdx = tags.indexOf('js/app.js');
  if (countVfx === 1) ok('index.html references js/checkmate-vfx.js exactly once');
  else bad('index.html references js/checkmate-vfx.js exactly once', `found ${countVfx}`);
  if (countSlow === 1) ok('index.html references js/slowmo.js exactly once');
  else bad('index.html references js/slowmo.js exactly once', `found ${countSlow}`);
  if (countVfx === 1 && countSlow === 1 && appIdx !== -1 &&
      tags.indexOf('js/checkmate-vfx.js') < appIdx &&
      tags.indexOf('js/slowmo.js') < appIdx) {
    ok('index.html: new scripts load before js/app.js');
  } else if (countVfx === 1 && countSlow === 1) {
    bad('index.html: new scripts load before js/app.js', 'order wrong or app.js missing');
  } else {
    bad('index.html: new scripts load before js/app.js', 'blocked: script tags missing');
  }
}

// --- 4. checkmate config blocks ------------------------------------------------
let cfg = null;
try {
  const stubs = makeStubs();
  loadScript(stubs, CONFIG_SCRIPT); // effects-config.js touches only `window`
  cfg = stubs.window.EFFECTS_CONFIG;
} catch (e) { bad('effects-config.js loads', e.message); }

if (cfg && cfg.pieces) {
  const vfxApi = checkmateVfx
    ? new Set(Object.getOwnPropertyNames(checkmateVfx).filter(k => typeof checkmateVfx[k] === 'function'))
    : null;

  for (const piece of [...FULL_PIECES, ...Object.keys(ROUTED_AWAY)]) {
    const block = cfg.pieces[piece] && cfg.pieces[piece].checkmate;
    const label = `pieces.${piece}.checkmate`;
    if (!block || typeof block !== 'object') {
      bad(`${label} block exists`, 'missing');
      continue;
    }
    ok(`${label} block exists`);

    if (typeof block.durationMs === 'number' && block.durationMs >= 4000 && block.durationMs <= 6000) {
      ok(`${label}.durationMs in 4000..6000 (${block.durationMs})`);
    } else {
      bad(`${label}.durationMs in 4000..6000`, `got ${JSON.stringify(block.durationMs)}`);
    }

    if ('trauma' in block || 'hitStop' in block) {
      bad(`${label}: no trauma/hitStop keys`, 'binding violation — trauma/hit-stop are OFF permanently');
    } else {
      ok(`${label}: no trauma/hitStop keys`);
    }

    // Routed-away pieces: empty phases + a note documenting the routing.
    if (ROUTED_AWAY[piece]) {
      if (Array.isArray(block.phases) && block.phases.length === 0) {
        ok(`${label}.phases empty by design (manager routes away)`);
      } else {
        bad(`${label}.phases empty by design`, `expected [], got ${JSON.stringify(block.phases)}`);
        continue;
      }
      if (typeof block.note === 'string' && ROUTED_AWAY[piece].test(block.note)) {
        ok(`${label}.note documents routing`);
      } else {
        bad(`${label}.note documents routing`, `got ${JSON.stringify(block.note)}`);
      }
      continue;
    }

    if (!Array.isArray(block.phases) || block.phases.length === 0) {
      bad(`${label}.phases non-empty`, block.phases === undefined ? 'phases MISSING (placeholder block)' : `got ${JSON.stringify(block.phases)}`);
      continue;
    }
    ok(`${label}.phases non-empty (${block.phases.length} phases)`);

    block.phases.forEach((ph, i) => {
      const pl = `${label}.phases[${i}]`;
      if (typeof ph.t !== 'number' || ph.t < 0) { bad(`${pl}.t >= 0`, `got ${JSON.stringify(ph.t)}`); return; }
      if (!('visual' in ph) && !('audio' in ph)) {
        bad(`${pl} carries a beat`, 'neither visual nor audio — a no-op phase');
        return;
      }
      // visual is optional per phase (audio-only beats are supported; the
      // manager guards the dispatch). When present it must name a real
      // CheckmateVFX method.
      if (!vfxApi) {
        bad(`${pl}.visual in CheckmateVFX API`, `blocked: CheckmateVFX unavailable; visual=${JSON.stringify(ph.visual)}`);
      } else if (ph.visual === undefined) {
        ok(`${pl} audio-only beat`);
      } else if (typeof ph.visual !== 'string' || !vfxApi.has(ph.visual)) {
        bad(`${pl}.visual in CheckmateVFX API`, `unknown visual ${JSON.stringify(ph.visual)}`);
      } else {
        ok(`${pl}.visual=${ph.visual} in CheckmateVFX API`);
      }
      if ('audio' in ph) {
        if (ph.audio === null || ph.audio === undefined) {
          bad(`${pl}.audio not null`, 'audio key present but null — omit the key for visual-only beats');
        } else if (!SFX_KEYS.has(ph.audio)) {
          bad(`${pl}.audio in vfx.js sfx map`, `unknown key ${JSON.stringify(ph.audio)}`);
        } else {
          ok(`${pl}.audio=${ph.audio} in sfx map`);
        }
      }
    });
  }
} else {
  bad('window.EFFECTS_CONFIG.pieces present', 'config did not load');
}

console.log(failures.length === 0
  ? '\ncheckmate contract: ALL PASSED'
  : `\ncheckmate contract: ${failures.length} FAILURE(S)`);
process.exit(failures.length === 0 ? 0 : 1);
