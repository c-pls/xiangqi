'use strict';
/**
 * tests/effects-config.test.js — QA (W4) contract tests for window.EFFECTS_CONFIG.
 *
 * Frozen contract (Phase 2):
 *   - `pieces` has all 7 uppercase piece keys: C R H E A P K.
 *   - Every capture block has a NON-EMPTY `phases` array.
 *   - Each phase: numeric `t`, string `visual`, optional `audio`
 *     (visual-only beats omit it; when present it must be a valid sfx key).
 *   - `durationMs` within 1200-2000 for R/H/E/A/P/K; cannon (C) keeps 490.
 *   - Every phase `audio` key exists in the vfx.js `sfx` map (24 real keys,
 *     copied verbatim from js/vfx.js on 2026-10-06 — the test stubs the map
 *     as a Set rather than loading Howler/vfx.js).
 *   - No `trauma` / `hitStop` keys anywhere (binding user decision: OFF).
 *   - `check` / `checkmate` placeholders intact on every piece.
 *
 * PHASE 2 STATUS: the six full R/H/E/A/P/K configs land with manager
 * integration; this file MUST be green after that. Pre-integration it fails
 * on the Phase 1 placeholders (empty phases, durationMs 1000) — expected.
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/effects-config.test.js
 */
const path = require('node:path');
const assert = require('node:assert');
const { makeStubs, loadScript } = require('./harness');

const SCRIPT = path.join(__dirname, '..', 'js', 'effects-config.js');

// The 24 real keys of the vfx.js `sfx` map, read verbatim from js/vfx.js
// (const sfx = {...}, Howl entries) on 2026-10-06. 'enabled'/'get' below
// belong to the soundFx object, not sfx — excluded on purpose.
const SFX_KEYS = new Set([
  'advisor_capture', 'ball_whistle', 'cannon_charge', 'cannon_check',
  'cannon_fire', 'cannon_impact', 'chariot_capture', 'chariot_check',
  'checkmate', 'debris_scatter', 'elephant_capture', 'epic_check',
  'epic_gong', 'flying_general_check', 'fuse_hiss', 'general_capture',
  'general_check', 'horse_capture', 'horse_check', 'horse_run',
  'katana_unsheathe', 'smoke_hiss', 'soldier_capture', 'soldier_check',
]);
assert.strictEqual(SFX_KEYS.size, 24, 'sfx stub must hold exactly the 24 real vfx.js keys');

const PIECES = ['C', 'R', 'H', 'E', 'A', 'P', 'K'];

function loadConfig() {
  const stubs = makeStubs();
  loadScript(stubs, SCRIPT); // effects-config.js touches only `window`
  const cfg = stubs.window.EFFECTS_CONFIG;
  assert.ok(cfg, `window.EFFECTS_CONFIG must be defined by ${SCRIPT}`);
  return cfg;
}

const cfg = loadConfig();

// --- 1. all 7 piece keys present -------------------------------------------
{
  assert.ok(cfg.pieces && typeof cfg.pieces === 'object', 'pieces must be an object');
  const keys = Object.keys(cfg.pieces);
  for (const p of PIECES) {
    assert.ok(keys.includes(p), `pieces must include '${p}' (got: ${keys.join(',')})`);
  }
  console.log(`ok - all 7 piece keys present (${keys.join(',')})`);
}

// --- 2. every capture block has a non-empty phases array --------------------
const captures = {};
for (const p of PIECES) {
  const cap = cfg.pieces[p] && cfg.pieces[p].capture;
  assert.ok(cap && typeof cap === 'object', `pieces.${p}.capture must be an object`);
  assert.ok(Array.isArray(cap.phases), `pieces.${p}.capture.phases must be an array`);
  assert.ok(
    cap.phases.length > 0,
    `pieces.${p}.capture.phases must be NON-EMPTY (Phase 2 full config)`
  );
  captures[p] = cap;
}
console.log('ok - every capture block has a non-empty phases array');

// --- 3. each phase: numeric t, string visual, optional audio -----------------
// (Manager amendment, Phase 2 integration: `audio` is OPTIONAL per phase —
// visual-only beats omit it so the scheduler never re-triggers a sound.
// When present it must be a non-empty string; §4 validates it as an sfx key.)
for (const p of PIECES) {
  captures[p].phases.forEach((ph, i) => {
    const where = `pieces.${p}.capture.phases[${i}]`;
    assert.strictEqual(typeof ph.t, 'number', `${where}.t must be a number`);
    assert.ok(Number.isFinite(ph.t) && ph.t >= 0, `${where}.t must be a finite ms >= 0`);
    assert.strictEqual(typeof ph.visual, 'string', `${where}.visual must be a string`);
    assert.ok(ph.visual.length > 0, `${where}.visual must be non-empty`);
    if (ph.audio !== undefined && ph.audio !== null) {
      assert.strictEqual(typeof ph.audio, 'string', `${where}.audio must be a string when present`);
      assert.ok(ph.audio.length > 0, `${where}.audio must be non-empty when present`);
    }
  });
}
console.log('ok - every phase has numeric t, string visual, optional audio');

// --- 4. every PRESENT audio key exists in the vfx.js sfx map -----------------
for (const p of PIECES) {
  captures[p].phases.forEach((ph, i) => {
    if (ph.audio === undefined || ph.audio === null) return; // visual-only beat
    assert.ok(
      SFX_KEYS.has(ph.audio),
      `pieces.${p}.capture.phases[${i}].audio '${ph.audio}' is not a real vfx.js sfx key`
    );
  });
}
console.log('ok - every present phase audio key exists in the vfx.js sfx map (24 keys)');

// --- 5. durationMs: cannon keeps 490; R/H/E/A/P/K within 1200-2000 ----------
{
  assert.strictEqual(
    captures.C.durationMs, 490,
    `cannon durationMs must stay 490 (got ${captures.C.durationMs})`
  );
  for (const p of ['R', 'H', 'E', 'A', 'P', 'K']) {
    const d = captures[p].durationMs;
    assert.strictEqual(typeof d, 'number', `pieces.${p}.capture.durationMs must be a number`);
    assert.ok(
      d >= 1200 && d <= 2000,
      `pieces.${p}.capture.durationMs must be within 1200-2000 (got ${d})`
    );
  }
}
console.log('ok - durationMs: cannon 490, R/H/E/A/P/K within 1200-2000');

// --- 6. no trauma / hitStop keys anywhere (binding: OFF permanently) ---------
{
  const found = [];
  (function walk(node, trail) {
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) {
        if (k === 'trauma' || k === 'hitStop') found.push(`${trail}.${k}`);
        walk(node[k], `${trail}.${k}`);
      }
    }
  })(cfg, 'EFFECTS_CONFIG');
  assert.strictEqual(
    found.length, 0,
    `trauma/hitStop keys are forbidden (binding decision OFF): ${found.join(', ')}`
  );
}
console.log('ok - no trauma/hitStop keys anywhere in EFFECTS_CONFIG');

// --- 7. check / checkmate placeholders intact on every piece -----------------
for (const p of PIECES) {
  for (const slot of ['check', 'checkmate']) {
    const blk = cfg.pieces[p][slot];
    assert.ok(blk && typeof blk === 'object', `pieces.${p}.${slot} placeholder must exist`);
    assert.strictEqual(
      typeof blk.durationMs, 'number',
      `pieces.${p}.${slot}.durationMs must be a number`
    );
  }
}
console.log('ok - check/checkmate placeholders intact on all 7 pieces');

console.log('\neffects-config contract tests: ALL PASSED');
