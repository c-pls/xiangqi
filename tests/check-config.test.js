'use strict';
/**
 * tests/check-config.test.js — QA (W4-final) contract tests for the Phase 3
 * check-cinematic config blocks in window.EFFECTS_CONFIG.
 *
 * Frozen contract (Phase 3):
 *   - pieces.C/R/H/P/flyingGeneral.check = { durationMs: 1500,
 *     phases: [{ t, visual, audio? }], colors } with a NON-EMPTY phases array.
 *   - Each phase: numeric `t` (ms >= 0), `visual` naming a real
 *     window.CheckVFX method (the 10-method Phase 3 API), `audio` OPTIONAL
 *     per phase — omitted, never null; when present it must be one of the
 *     24 real vfx.js sfx keys.
 *   - No `trauma` / `hitStop` keys anywhere in the check blocks (binding
 *     user decision: OFF permanently).
 *   - pieces.E/A/K.check remain Phase-3 placeholders:
 *     exactly { durationMs: 1500, note: 'Phase 3' }.
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/check-config.test.js
 */
const path = require('node:path');
const assert = require('node:assert');
const { makeStubs, loadScript } = require('./harness');

const SCRIPT = path.join(__dirname, '..', 'js', 'effects-config.js');

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

// The 10 window.CheckVFX methods (js/check-vfx.js, Phase 3 landed API).
const CHECKVFX_API = new Set([
  'trembleGeneral', 'sweatDrops', 'palaceGlow', 'cannonLaserAim',
  'chariotLane', 'horseGhostTrail', 'soldierAim', 'flyingGeneralDuel',
  'setDoubleCheck', 'clearAll',
]);
assert.strictEqual(CHECKVFX_API.size, 10, 'CheckVFX API must hold exactly the 10 landed methods');

const CHECK_PIECES = ['C', 'R', 'H', 'P', 'flyingGeneral'];
const PLACEHOLDER_PIECES = ['E', 'A', 'K'];

function loadConfig() {
  const stubs = makeStubs();
  loadScript(stubs, SCRIPT); // effects-config.js touches only `window`
  const cfg = stubs.window.EFFECTS_CONFIG;
  assert.ok(cfg, `window.EFFECTS_CONFIG must be defined by ${SCRIPT}`);
  assert.ok(cfg.pieces && typeof cfg.pieces === 'object', 'pieces must be an object');
  return cfg;
}

const cfg = loadConfig();

// --- 1. full check blocks for C/R/H/P/flyingGeneral --------------------------
for (const p of CHECK_PIECES) {
  const chk = cfg.pieces[p] && cfg.pieces[p].check;
  assert.ok(chk && typeof chk === 'object', `pieces.${p}.check must be an object`);
  assert.strictEqual(
    chk.durationMs, 1500,
    `pieces.${p}.check.durationMs must be 1500 (got ${chk.durationMs})`
  );
  assert.ok(
    Array.isArray(chk.phases) && chk.phases.length > 0,
    `pieces.${p}.check.phases must be a NON-EMPTY array (Phase 3 full config)`
  );
  assert.ok(
    chk.colors && typeof chk.colors === 'object',
    `pieces.${p}.check.colors must be an object`
  );
}
console.log('ok - C/R/H/P/flyingGeneral check blocks: durationMs 1500, non-empty phases, colors');

// --- 2. phases well-formed; visuals in the CheckVFX API; audio valid --------
for (const p of CHECK_PIECES) {
  cfg.pieces[p].check.phases.forEach((ph, i) => {
    const where = `pieces.${p}.check.phases[${i}]`;
    assert.strictEqual(typeof ph.t, 'number', `${where}.t must be a number`);
    assert.ok(Number.isFinite(ph.t) && ph.t >= 0, `${where}.t must be finite ms >= 0`);
    assert.strictEqual(typeof ph.visual, 'string', `${where}.visual must be a string`);
    assert.ok(
      CHECKVFX_API.has(ph.visual),
      `${where}.visual '${ph.visual}' must name a window.CheckVFX method ` +
      `(${[...CHECKVFX_API].join(',')})`
    );
    // Audio is OPTIONAL per phase: omitted, never null. When present it must
    // be an exact vfx.js sfx key.
    assert.notStrictEqual(ph.audio, null, `${where}.audio must be omitted, never null`);
    if (ph.audio !== undefined) {
      assert.strictEqual(typeof ph.audio, 'string', `${where}.audio must be a string when present`);
      assert.ok(
        SFX_KEYS.has(ph.audio),
        `${where}.audio '${ph.audio}' is not a real vfx.js sfx key`
      );
    }
  });
}
console.log('ok - every check phase: numeric t, CheckVFX visual, optional valid sfx audio (never null)');

// --- 3. no trauma / hitStop keys in any check block (binding: OFF) ------------
{
  const found = [];
  (function walk(node, trail) {
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) {
        if (k === 'trauma' || k === 'hitStop') found.push(`${trail}.${k}`);
        walk(node[k], `${trail}.${k}`);
      }
    }
  })(
    Object.fromEntries(CHECK_PIECES.map((p) => [p, cfg.pieces[p].check])),
    'pieces.*.check'
  );
  assert.strictEqual(
    found.length, 0,
    `trauma/hitStop keys are forbidden in check blocks (binding OFF): ${found.join(', ')}`
  );
}
console.log('ok - no trauma/hitStop keys in any check block');

// --- 4. E/A/K check placeholders intact ---------------------------------------
for (const p of PLACEHOLDER_PIECES) {
  const chk = cfg.pieces[p] && cfg.pieces[p].check;
  assert.ok(chk && typeof chk === 'object', `pieces.${p}.check placeholder must exist`);
  assert.deepStrictEqual(
    Object.keys(chk).sort(), ['durationMs', 'note'],
    `pieces.${p}.check must stay the Phase-3 placeholder {durationMs, note} ` +
    `(got keys: ${Object.keys(chk).join(',')})`
  );
  assert.strictEqual(chk.durationMs, 1500, `pieces.${p}.check.durationMs must be 1500`);
  assert.strictEqual(chk.note, 'Phase 3', `pieces.${p}.check.note must be 'Phase 3'`);
}
console.log("ok - E/A/K check blocks remain {durationMs:1500, note:'Phase 3'} placeholders");

console.log('\ncheck-config contract tests: ALL PASSED');
