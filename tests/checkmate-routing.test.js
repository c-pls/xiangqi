'use strict';
/**
 * tests/checkmate-routing.test.js — QA (W4, Phase 4) winningPiece routing tests.
 *
 * Two layers, both against REAL shipped code:
 *   1. Manager routing: the REAL effects-bridge `_mateConfigFor` maps
 *      piece keys to finale configs — C/R/H/P/flyingGeneral reach their
 *      per-piece finale; K is mapped to flyingGeneral; E/A return null
 *      (manager never routes there -> default closing finale).
 *   2. Payload routing: the REAL app.js `_buildCheckmateEvent` (extracted
 *      verbatim from the shipped source by brace matching) builds
 *      {move, pieceKey, winningPiece, losingGeneralCell, winnerSide, reason}
 *      and routes a K-along-file general capture to pieceKey
 *      'flyingGeneral'.
 *   3. End-to-end: emit 'checkmate' on the REAL GameBus per piece key and
 *      assert the correct finale visuals fire (stubbed CheckmateVFX).
 *
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/checkmate-routing.test.js
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { makeStubs, loadScript } = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const BUS = path.join(ROOT, 'js', 'event-bus.js');
const CONFIG = path.join(ROOT, 'js', 'effects-config.js');
const BRIDGE = path.join(ROOT, 'js', 'effects-bridge.js');
const APP = path.join(ROOT, 'js', 'app.js');

const VFX_METHODS = [
  'freezeFlash', 'pushIn', 'dimBoard', 'restoreBoard',
  'cannonPalaceExplosion', 'cannonFireworks',
  'chariotGateSmash', 'chariotCavalrySweep',
  'horseMoonLeap', 'horseLightningStrike',
  'soldierSpotlight', 'soldierBow',
  'flyingDuelSlash',
  'crownFall', 'flagLower', 'palaceCrumble',
  'paintJueSha', 'celebrate', 'clearAll',
];

const __tests = [];
async function test(name, fn) { __tests.push([name, fn]); }

function makeWorld() {
  const stubs = makeStubs();
  const vfxCalls = [];
  let modalCalls = 0;
  const vfx = {};
  for (const m of VFX_METHODS) vfx[m] = (...a) => vfxCalls.push({ name: m, args: a });
  stubs.window.CheckmateVFX = vfx;
  stubs.window.SlowMo = {
    begin: () => {}, end: () => {}, reset: () => {}, isActive: () => false,
  };
  stubs.window.audioManager = { play: () => {} };
  stubs.window.app = { showGameOverModal: () => { modalCalls++; } };
  loadScript(stubs, BUS);
  loadScript(stubs, CONFIG);
  loadScript(stubs, BRIDGE);
  const mgr = stubs.window.effectsManager;
  const queue = [];
  mgr._later = (ms, fn) => { queue.push({ ms, fn }); return queue.length; };
  mgr._clearMateTimers = () => { queue.length = 0; };
  const drive = () => {
    while (queue.length) {
      queue.sort((a, b) => a.ms - b.ms);
      queue.shift().fn();
    }
  };
  return {
    mgr, bus: stubs.window.GameBus, drive,
    vfxNames: () => vfxCalls.map((c) => c.name),
    modalCalls: () => modalCalls,
  };
}

/**
 * Extract the REAL _buildCheckmateEvent method from the shipped js/app.js by
 * brace matching, and return it as a callable function (called with a fake
 * `this` carrying { game: { turn, winner, findKing } }).
 */
function realBuildCheckmateEvent() {
  const src = fs.readFileSync(APP, 'utf8');
  const marker = '_buildCheckmateEvent(move, reason) {';
  const mi = src.indexOf(marker);
  assert.ok(mi !== -1, 'app.js contains _buildCheckmateEvent');
  const open = src.indexOf('{', mi + marker.length - 1);
  let depth = 1;
  let j = open + 1;
  while (depth > 0 && j < src.length) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') depth--;
    j++;
  }
  assert.strictEqual(depth, 0, 'brace matching terminated cleanly');
  const body = src.slice(open + 1, j - 1);
  assert.ok(body.includes('flyingGeneral'), 'extracted the flying-general routing method');
  return new Function('move', 'reason', body);
}

const buildEvent = realBuildCheckmateEvent();
function fakeApp(over) {
  return Object.assign({ turn: 'black', winner: 'red', findKing: () => ({ r: 9, c: 4 }) }, over);
}

test('_buildCheckmateEvent: normal mate keeps the mating piece key', () => {
  const move = { piece: 'C', from: { r: 1, c: 2 }, to: { r: 1, c: 5 }, captured: null };
  const e = buildEvent.call({ game: fakeApp() }, move, 'checkmate');
  assert.deepStrictEqual(
    { pieceKey: e.pieceKey, winningPiece: e.winningPiece, winnerSide: e.winnerSide, reason: e.reason },
    { pieceKey: 'C', winningPiece: 'C', winnerSide: 'red', reason: 'checkmate' });
  assert.deepStrictEqual(e.losingGeneralCell, { r: 9, c: 4 });
  assert.strictEqual(e.move, move, 'move passes through by reference');
});

test('_buildCheckmateEvent: K-along-file general capture -> flyingGeneral', () => {
  // Flying-general mate: attacker K takes victim K on the same file.
  const move = { piece: 'K', captured: 'K', from: { r: 3, c: 4 }, to: { r: 0, c: 4 } };
  const e = buildEvent.call(
    { game: fakeApp({ findKing: () => null }) }, move, 'general_captured');
  assert.strictEqual(e.pieceKey, 'flyingGeneral', 'pieceKey routed to flyingGeneral');
  assert.strictEqual(e.winningPiece, 'flyingGeneral', 'winningPiece routed to flyingGeneral');
  assert.strictEqual(e.losingGeneralCell, null, 'captured general is off the board');
  assert.strictEqual(e.reason, 'general_captured');
});

test('_buildCheckmateEvent: K mating normally stays K (manager maps it)', () => {
  // A general delivering mate by a normal move (not the flying capture).
  const move = { piece: 'K', captured: 'P', from: { r: 8, c: 4 }, to: { r: 8, c: 5 } };
  const e = buildEvent.call({ game: fakeApp() }, move, 'checkmate');
  assert.strictEqual(e.pieceKey, 'K', 'pieceKey stays K here');
});

test('_buildCheckmateEvent: server-supplied winningPiece wins', () => {
  const move = { piece: 'C', gameOver: { winningPiece: 'H' }, from: { r: 1, c: 2 }, to: { r: 1, c: 5 } };
  const e = buildEvent.call({ game: fakeApp() }, move, 'checkmate');
  assert.strictEqual(e.winningPiece, 'H');
  assert.strictEqual(e.pieceKey, 'H');
});

test('manager _mateConfigFor: C/R/H/P/flyingGeneral each reach a full config', () => {
  const w = makeWorld();
  for (const key of ['C', 'R', 'H', 'P', 'flyingGeneral']) {
    const cfg = w.mgr._mateConfigFor(key);
    assert.ok(cfg && Array.isArray(cfg.phases) && cfg.phases.length > 0,
      `${key} resolves to a full checkmate config`);
  }
});

test('manager _mateConfigFor: K maps to flyingGeneral; E/A map away (null)', () => {
  const w = makeWorld();
  const kCfg = w.mgr._mateConfigFor('K');
  const fgCfg = w.mgr._mateConfigFor('flyingGeneral');
  assert.strictEqual(kCfg, fgCfg, 'K resolves to the flyingGeneral config object');
  assert.ok(kCfg.phases.some((p) => p.visual === 'flyingDuelSlash'),
    'the resolved config is the flying-general duel finale');
  assert.strictEqual(w.mgr._mateConfigFor('E'), null, 'E maps away (null)');
  assert.strictEqual(w.mgr._mateConfigFor('A'), null, 'A maps away (null)');
  assert.strictEqual(w.mgr._mateConfigFor('???'), null, 'unknown key maps away (null)');
});

const OPENER = {
  C: 'cannonPalaceExplosion',
  R: 'chariotGateSmash',
  H: 'horseMoonLeap',
  P: 'soldierSpotlight',
  flyingGeneral: 'flyingDuelSlash',
};

for (const [pieceKey, opener] of Object.entries(OPENER)) {
  test(`bus checkmate (${pieceKey}): correct per-piece finale runs`, () => {
    const w = makeWorld();
    w.mgr.setIntensity('full');
    w.bus.emit('checkmate', {
      move: { piece: pieceKey, from: { r: 0, c: 0 }, to: { r: 0, c: 1 } },
      pieceKey,
      winningPiece: pieceKey,
      losingGeneralCell: { r: 9, c: 4 },
      winnerSide: 'red',
      reason: pieceKey === 'flyingGeneral' ? 'general_captured' : 'checkmate',
    });
    w.drive();
    const names = w.vfxNames();
    assert.ok(names.includes(opener), `${pieceKey} finale opener ${opener} fired`);
    // No other piece's opener leaked in.
    for (const other of Object.values(OPENER)) {
      if (other !== opener) assert.ok(!names.includes(other), `no ${other} in a ${pieceKey} mate`);
    }
    assert.strictEqual(w.modalCalls(), 1, 'modal exactly once');
  });
}

test('bus checkmate (K): manager maps to the flyingGeneral finale', () => {
  const w = makeWorld();
  w.mgr.setIntensity('full');
  w.bus.emit('checkmate', {
    move: { piece: 'K', captured: 'P', from: { r: 8, c: 4 }, to: { r: 8, c: 5 } },
    pieceKey: 'K',
    winningPiece: 'K',
    losingGeneralCell: { r: 0, c: 4 },
    winnerSide: 'red',
    reason: 'checkmate',
  });
  w.drive();
  assert.ok(w.vfxNames().includes('flyingDuelSlash'), 'K mate runs the flyingGeneral duel');
  assert.strictEqual(w.modalCalls(), 1, 'modal exactly once');
});

for (const pieceKey of ['E', 'A']) {
  test(`bus checkmate (${pieceKey}): never routed — default closing finale, no crash`, () => {
    const w = makeWorld();
    w.mgr.setIntensity('full');
    w.bus.emit('checkmate', {
      move: { piece: pieceKey, from: { r: 0, c: 0 }, to: { r: 0, c: 1 } },
      pieceKey,
      winningPiece: pieceKey,
      losingGeneralCell: { r: 9, c: 4 },
      winnerSide: 'red',
      reason: 'checkmate',
    });
    w.drive(); // must not throw
    const names = w.vfxNames();
    // Default finale: global beats + closing beats only, no per-piece opener.
    for (const opener of Object.values(OPENER)) {
      assert.ok(!names.includes(opener), `no per-piece opener ${opener} for ${pieceKey}`);
    }
    for (const beat of ['crownFall', 'flagLower', 'palaceCrumble', 'paintJueSha', 'celebrate']) {
      assert.ok(names.includes(beat), `closing beat ${beat} ran for ${pieceKey}`);
    }
    assert.strictEqual(w.modalCalls(), 1, 'modal exactly once');
  });
}

(async () => {
  let passed = 0;
  for (const [name, fn] of __tests) {
    try {
      await fn();
      passed++;
      console.log(`ok - ${name}`);
    } catch (err) {
      console.error(`FAIL - ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log(`\ncheckmate routing: ${passed}/${__tests.length} test(s) passed`);
})();
