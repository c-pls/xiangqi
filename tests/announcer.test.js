'use strict';
/**
 * tests/announcer.test.js — QA (W4) contract tests for window.Announcer.
 *
 * FROZEN contract (Phase 2):
 *   window.Announcer = { reset(gameId), announceForCapture({piece, victim, side, moveNumber}) };
 *   announceForCapture returns { text, level } | null.
 *   - FIRST BLOOD on the first capture of a game (level 'major').
 *   - DOUBLE KILL when the same side captures on consecutive moves ('minor');
 *     re-fires pair-wise on longer streaks — there is no TRIPLE KILL.
 *   - CANNON MASTER on the same side's 3rd cannon capture ('minor').
 *   - REVENGE! on a recapture immediately after the opponent's capture ('minor').
 *   - reset(gameId) clears that game's history; histories are per-game.
 *
 * Manager decision (Phase B): W2's implementation stands — DOUBLE KILL fires
 * pair-wise (every capture from the 2nd onward of a same-side streak re-fires
 * it; no TRIPLE KILL). The old "exact streak -> null on 3rd capture" reading
 * was wrong; test 5 was updated accordingly.
 *
 * moveNumber semantics (per the implementation contract): the manager counts
 * GameBus 'move' events, and the 'move' emit precedes the 'capture' emit for
 * the same move, so captures on consecutive moves carry consecutive
 * moveNumbers. When both captures carry numeric moveNumbers, DOUBLE KILL /
 * REVENGE require them to differ by exactly 1 (strict). Test data below uses
 * consecutive moveNumbers for consecutive captures; a gap (e.g. 12 -> 14)
 * means a quiet move happened between, so no streak milestone fires.
 *
 * `text` is matched case-insensitively on the milestone phrase so a trailing
 * '!' or flavor words don't break the test; `level` is exact.
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/announcer.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { makeStubs, loadScript } = require('./harness');

const SCRIPT = path.join(__dirname, '..', 'js', 'announcer.js');

// Minimal document stub for announcer popup DOM (createElement/appendChild/remove).
function makeDocument() {
  function makeEl(tag) {
    const el = {
      tagName: String(tag).toUpperCase(),
      style: {},
      textContent: '',
      className: '',
      dataset: {},
      children: [],
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute() {},
      appendChild(c) { el.children.push(c); return c; },
      remove() {},
      addEventListener() {},
      removeEventListener() {},
    };
    return el;
  }
  return {
    createElement: (tag) => makeEl(tag),
    createTextNode: (t) => ({ textContent: String(t) }),
    body: makeEl('body'),
    getElementById: () => null,
    querySelector: () => null,
  };
}

function freshAnnouncer() {
  assert.ok(
    fs.existsSync(SCRIPT),
    `js/announcer.js does not exist yet (lands with Phase 2 integration): ${SCRIPT}`
  );
  const stubs = makeStubs();
  loadScript(stubs, SCRIPT, { document: makeDocument() }); // throws on unguarded globals
  const Announcer = stubs.window.Announcer;
  assert.ok(Announcer, `window.Announcer must be defined by ${SCRIPT}`);
  for (const m of ['reset', 'announceForCapture']) {
    assert.strictEqual(
      typeof Announcer[m], 'function',
      `window.Announcer.${m} must be a function`
    );
  }
  return Announcer;
}

function cap(piece, side, n) {
  return { piece, victim: 'R', side, moveNumber: n };
}

// Every call must return null or a well-formed { text, level }.
function checkShape(ret, where) {
  assert.ok(
    ret === null || (typeof ret === 'object' && ret !== null),
    `${where}: must return {text, level} | null, got ${JSON.stringify(ret)}`
  );
  if (ret !== null) {
    assert.strictEqual(typeof ret.text, 'string', `${where}: text must be a string`);
    assert.ok(ret.text.length > 0, `${where}: text must be non-empty`);
    assert.ok(
      ret.level === 'major' || ret.level === 'minor',
      `${where}: level must be 'major'|'minor', got ${JSON.stringify(ret.level)}`
    );
  }
  return ret;
}

function expectMilestone(ret, phrase, level, where) {
  assert.ok(ret !== null, `${where}: expected a milestone announcement, got null`);
  assert.ok(
    ret.text.toUpperCase().includes(phrase),
    `${where}: text must include '${phrase}', got ${JSON.stringify(ret.text)}`
  );
  assert.strictEqual(ret.level, level, `${where}: level must be '${level}'`);
}

// --- 1. FIRST BLOOD: first capture of a game -> major ------------------------
{
  const A = freshAnnouncer();
  A.reset('g1');
  const ret = checkShape(A.announceForCapture(cap('R', 'red', 12)), 'first capture');
  expectMilestone(ret, 'FIRST BLOOD', 'major', 'first capture');
  console.log("ok - FIRST BLOOD on first capture (level 'major')");
}

// --- 2. DOUBLE KILL: same side captures on consecutive moves -> minor --------
{
  const A = freshAnnouncer();
  A.reset('g2');
  checkShape(A.announceForCapture(cap('R', 'red', 12)), 'g2 cap 1');
  const ret = checkShape(A.announceForCapture(cap('H', 'red', 13)), 'g2 cap 2');
  expectMilestone(ret, 'DOUBLE KILL', 'minor', 'second consecutive same-side capture');
  console.log("ok - DOUBLE KILL on same side capturing on consecutive moves (level 'minor')");
}

// --- 2b. Non-consecutive moveNumbers -> no streak milestone ------------------
// A moveNumber gap means a quiet move happened between the captures, so they
// are not consecutive captures and DOUBLE KILL must NOT fire.
{
  const A = freshAnnouncer();
  A.reset('g2b');
  checkShape(A.announceForCapture(cap('R', 'red', 12)), 'g2b cap 1');
  const ret = checkShape(A.announceForCapture(cap('H', 'red', 14)), 'g2b cap 2 (gap)');
  assert.strictEqual(ret, null, 'moveNumber gap (12 -> 14): no DOUBLE KILL');
  console.log('ok - moveNumber gap suppresses DOUBLE KILL (returns null)');
}

// --- 3. CANNON MASTER: same side's 3rd cannon capture -> minor ---------------
{
  const A = freshAnnouncer();
  A.reset('g3');
  checkShape(A.announceForCapture(cap('C', 'black', 10)), 'g3 cannon 1');
  checkShape(A.announceForCapture(cap('C', 'black', 11)), 'g3 cannon 2');
  const ret = checkShape(A.announceForCapture(cap('C', 'black', 12)), 'g3 cannon 3');
  expectMilestone(ret, 'CANNON MASTER', 'minor', "side's 3rd cannon capture");
  console.log("ok - CANNON MASTER on same side's 3rd cannon capture (level 'minor')");
}

// --- 4. REVENGE!: recapture immediately after opponent's capture -> minor ----
{
  const A = freshAnnouncer();
  A.reset('g4');
  checkShape(A.announceForCapture(cap('R', 'red', 12)), 'g4 cap 1');
  const ret = checkShape(A.announceForCapture(cap('H', 'black', 13)), 'g4 cap 2');
  expectMilestone(ret, 'REVENGE', 'minor', 'recapture immediately after opponent capture');
  console.log("ok - REVENGE! on recapture immediately after opponent's capture (level 'minor')");
}

// --- 5. DOUBLE KILL re-fires pair-wise on longer streaks (no TRIPLE KILL) ----
// Manager decision (Phase B): W2's pair-wise semantics stand. Every capture
// from the 2nd onward of a same-side streak re-fires DOUBLE KILL; there is no
// TRIPLE KILL event. The old "3rd consecutive capture -> null" expectation
// was wrong and is replaced here.
{
  const A = freshAnnouncer();
  A.reset('g5');
  A.announceForCapture(cap('R', 'red', 12));   // FIRST BLOOD
  A.announceForCapture(cap('H', 'red', 13));   // DOUBLE KILL
  const ret3 = checkShape(A.announceForCapture(cap('P', 'red', 14)), 'g5 cap 3');
  expectMilestone(ret3, 'DOUBLE KILL', 'minor', '3rd consecutive same-side capture re-fires DOUBLE KILL');
  const ret4 = checkShape(A.announceForCapture(cap('E', 'red', 15)), 'g5 cap 4');
  expectMilestone(ret4, 'DOUBLE KILL', 'minor', '4th consecutive same-side capture re-fires DOUBLE KILL');
  assert.ok(
    !ret4.text.toUpperCase().includes('TRIPLE'),
    'no TRIPLE KILL event exists in the contract'
  );
  console.log('ok - DOUBLE KILL re-fires pair-wise on longer streaks (no triple kill)');
}

// --- 6. reset(gameId) clears history ------------------------------------------
{
  const A = freshAnnouncer();
  A.reset('g6');
  A.announceForCapture(cap('R', 'red', 12));
  A.announceForCapture(cap('H', 'red', 13));
  A.reset('g6'); // history cleared
  const ret = checkShape(A.announceForCapture(cap('P', 'red', 20)), 'g6 after reset');
  expectMilestone(ret, 'FIRST BLOOD', 'major', 'capture after reset');
  console.log('ok - reset(gameId) clears history (FIRST BLOOD again)');
}

// --- 7. per-game isolation -----------------------------------------------------
// reset(gameId) also selects the active game. Isolation is observable: with a
// GLOBAL history, gb's first capture would be REVENGE! (right after ga's red
// capture). Per-game history makes it FIRST BLOOD.
{
  const A = freshAnnouncer();
  A.reset('ga');
  const rA = checkShape(A.announceForCapture(cap('R', 'red', 12)), 'ga first capture');
  expectMilestone(rA, 'FIRST BLOOD', 'major', 'ga first capture');
  A.reset('gb');
  const rB = checkShape(A.announceForCapture(cap('R', 'black', 5)), 'gb first capture');
  expectMilestone(rB, 'FIRST BLOOD', 'major', 'gb history independent of ga');
  // gb streaks continue independently within gb...
  const rB2 = checkShape(A.announceForCapture(cap('H', 'black', 6)), 'gb second capture');
  expectMilestone(rB2, 'DOUBLE KILL', 'minor', 'gb consecutive streak');
  // ...and resetting ga afterwards does not merge or corrupt gb's state:
  // ga was cleared, so its next capture is FIRST BLOOD again.
  A.reset('ga');
  const rA2 = checkShape(A.announceForCapture(cap('P', 'red', 20)), 'ga after re-reset');
  expectMilestone(rA2, 'FIRST BLOOD', 'major', 'ga history cleared independently');
  console.log('ok - per-game reset isolates history');
}

console.log('\nannouncer contract tests: ALL PASSED');
