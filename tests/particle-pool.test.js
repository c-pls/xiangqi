'use strict';
/**
 * tests/particle-pool.test.js — QA (W4) tests for Phase 5 particle pooling (W1).
 *
 * PINNED CONTRACT (W1 actual, verified 2026-10-06 against js/particle-pool.js
 * and js/vfx.js; manager alignment call: tests adapt to the worker's API):
 *  - window.ParticlePool is a CLASS: new ParticlePool(capacity, factory,
 *    resetter, hooks?) — pre-allocates every slot at construction.
 *  - pool.acquire(opts) -> slot, O(1) in the steady state. Exhaustion policy:
 *    reuse-oldest — evicts the live slot with the smallest acquisition seq,
 *    re-inits it, hands it back (counted in stats().evicted).
 *  - pool.release(p) -> boolean; safe no-op (false) for foreign slots and
 *    double releases.
 *  - pool.stats() -> { capacity, live, free, acquired, released, evicted,
 *    highWater, created }; `created` = total factory() calls, i.e. proof of
 *    zero post-warmup allocation.
 *  - Engine's live pool: window.__particlePool. Tuning knob:
 *    PARTICLE_POOL_CAPACITY = 4096 (js/vfx.js §3b).
 *  - Cold fallback: if particle-pool.js fails to load, vfx.js falls back to
 *    `new FXParticle` (works, slower). Script-tag ordering
 *    (particle-pool.js before vfx.js) is pinned in index.html instead.
 *  - FXParticle has reset(opts); the constructor delegates to it (field
 *    parity, original `endColor` quirk preserved verbatim).
 *  - Gradient caching is PER-ENGINE in FX2DEngine.draw(), keyed
 *    `type|color|size-bucket[|extra]` — pinned BEHAVIORALLY (createRadialGradient
 *    call counts across frames), not by source literal.
 *
 * Covers:
 *  A. Pool class semantics: pre-allocation, acquire/re-acquire identity,
 *     resetter re-init, stats() shape, release() boolean + foreign/double
 *     safety, reuse-oldest eviction (+ hook), constructor validation.
 *  B. Zero post-warmup allocation: `created` never grows after construction.
 *  C. vfx.js hot-path: `new FXParticle` exactly 2x in source (pool factory +
 *     documented cold fallback), zero `addParticle(new FXParticle`, zero
 *     `.filter(` in FX2DEngine.update, swap-remove keeps array identity,
 *     clear() releases everything (acquired === released + live invariant).
 *  D. C3-behavioral: instrumented createRadialGradient counts — N on frame 1,
 *     0 on the next 60 frames (per-engine cache, key type|color|size-bucket).
 *  E. vfx.js public API unchanged: 19 baseline AAAEngine methods + window
 *     surface (vfxEngine/aaaEngine/fxEngine/soundFx).
 *  F. Behavioral spawn/update/drain through the REAL vfx.js hot path with the
 *     live pool: dead particles released (no leak), re-spawn reuses slots.
 *  G. index.html: 23 script tags (hall-of-fame.js removed 2026-10-06),
 *     particle-pool.js loads BEFORE vfx.js, every
 *     src resolves.
 *
 * Loading note: js/vfx.js declares top-level `const sfx` (collides with the
 * harness's injected `sfx` param) and needs a global `Howl`, so vfx.js (+
 * particle-pool.js) are loaded concatenated in one custom Function scope
 * (pool first — mirrors browser script order) instead of tests/harness.js.
 * The concatenation exposes `var ParticlePool = window.ParticlePool` between
 * the two scripts so vfx.js sees the class exactly as a browser would.
 *
 * Exit codes: 0 = pass, 1 = fail, 3 = implementation not landed yet.
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/particle-pool.test.js
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const POOL = path.join(ROOT, 'js', 'particle-pool.js');
const VFX = path.join(ROOT, 'js', 'vfx.js');
const INDEX = path.join(ROOT, 'index.html');

function needLanded() {
  for (const [p, what] of [[POOL, 'js/particle-pool.js (W1)'], [VFX, 'js/vfx.js']]) {
    if (!fs.existsSync(p)) {
      console.error(`NOT-LANDED: ${what} not present — re-run after W1 lands. (${p})`);
      process.exit(3);
    }
  }
}

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- helpers ---

function stripLeadingStrict(src) {
  return src.replace(/^\s*(['"])use strict\1;\s*/, '');
}

// Load ONLY js/particle-pool.js in a box scope (no globalThis pollution) and
// return the ParticlePool class.
function loadPoolClass() {
  const src = stripLeadingStrict(fs.readFileSync(POOL, 'utf8'));
  const box = {};
  new Function('window', 'module', src)(box, undefined);
  assert.ok(box.ParticlePool, 'particle-pool.js must assign window.ParticlePool');
  return box.ParticlePool;
}

// Load particle-pool.js + vfx.js concatenated in one scope (browser order).
// Exposes test handles: window.__FXParticle, window.__FX2DEngine (vfx.js
// already exposes window.__particlePool itself).
function loadFxScope({ withPool = true } = {}) {
  const stubs = harness.makeStubs();
  const poolSrc = withPool ? stripLeadingStrict(fs.readFileSync(POOL, 'utf8')) : '';
  const vfxSrc = stripLeadingStrict(fs.readFileSync(VFX, 'utf8'));
  const code = [
    poolSrc,
    withPool ? 'var ParticlePool = window.ParticlePool;' : '',
    vfxSrc,
    'window.__FXParticle = FXParticle;',
    'window.__FX2DEngine = FX2DEngine;',
  ].join('\n;\n');
  function Howl() {}
  Howl.prototype.play = function () {};
  Howl.prototype.stop = function () {};
  Howl.prototype.volume = function () {};
  Howl.prototype.state = function () { return 'loaded'; };
  Howl.prototype.rate = function () {};
  const doc = { getElementById: () => null, createElement: () => null };
  const runner = new Function(
    'window', 'localStorage', 'Howler', 'Howl', 'gsap', 'matchMedia',
    'document', 'navigator', 'requestAnimationFrame',
    code
  );
  runner(
    stubs.window, stubs.localStorage, stubs.Howler, Howl,
    stubs.gsap, stubs.matchMedia, doc, undefined, () => 0
  );
  return stubs.window;
}

function classBody(src, name) {
  const i = src.indexOf('class ' + name);
  assert.ok(i >= 0, `class ${name} must exist in js/vfx.js`);
  let j = src.indexOf('{', i);
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(j, k + 1); }
  }
  assert.fail(`unbalanced braces in class ${name}`);
}

function methodBody(clsSrc, name) {
  const re = new RegExp('^\\s{4}(?:async\\s+)?' + name + '\\s*\\([^)]*\\)\\s*\\{', 'm');
  const m = re.exec(clsSrc);
  assert.ok(m, `method ${name}() must exist (4-space indented)`);
  let j = clsSrc.indexOf('{', m.index);
  let depth = 0;
  for (let k = j; k < clsSrc.length; k++) {
    if (clsSrc[k] === '{') depth++;
    else if (clsSrc[k] === '}') { depth--; if (depth === 0) return clsSrc.slice(j, k + 1); }
  }
  assert.fail(`unbalanced braces in method ${name}`);
}

// Baseline AAAEngine public surface (pre-Phase-5 js/vfx.js, QA-audited).
const BASELINE_API = [
  'constructor', 'createDummyTarget', 'playCapture', 'playAdvisorCapture',
  'playCannonCapture', 'playHorseCapture', 'playChariotCapture',
  'playElephantCapture', 'playSoldierCapture', 'playGeneralCapture',
  'playCheckThreat', 'playCheckmate', 'fireArtilleryCannon', 'fireChariotSlash',
  'fireHorseStomp', 'fireElephantFissure', 'fireAdvisorSlash',
  'fireSoldierThrust', 'triggerVictoryEmberRain',
];

// ------------------------------------------------------------------ tests ---

needLanded();

(async () => {
  // ------------------------------------------------- A. pool semantics ---
  const ParticlePool = loadPoolClass();

  await test('A0: ParticlePool is a class; constructor pre-allocates every slot', () => {
    assert.ok(/^\s*class\s/.test(ParticlePool.toString()), 'ParticlePool must be a class');
    let factoryCalls = 0;
    const resetterCalls = [];
    const pool = new ParticlePool(16,
      () => { factoryCalls++; return {}; },
      (slot, opts) => { resetterCalls.push([slot, opts]); });
    assert.strictEqual(factoryCalls, 16, 'factory called exactly capacity times at construction');
    const s = pool.stats();
    assert.strictEqual(s.created, 16, 'stats().created === capacity after construction');
    assert.deepStrictEqual(
      Object.keys(s).sort(),
      ['acquired', 'capacity', 'created', 'evicted', 'free', 'highWater', 'live', 'released'].sort(),
      `stats() shape pinned — got ${JSON.stringify(s)}`
    );
    assert.strictEqual(s.live, 0, 'nothing live after construction');
    assert.strictEqual(s.free, 16, 'all slots free after construction');
    assert.strictEqual(s.acquired, 0, 'acquired starts at 0');
  });

  await test('A0b: constructor validates its arguments', () => {
    const f = () => ({});
    const r = () => {};
    assert.throws(() => new ParticlePool(0, f, r), /capacity/, 'capacity 0 throws');
    assert.throws(() => new ParticlePool(-4, f, r), /capacity/, 'negative capacity throws');
    assert.throws(() => new ParticlePool(2.5, f, r), /capacity/, 'non-integer capacity throws');
    assert.throws(() => new ParticlePool(4, null, r), /factory/, 'missing factory throws');
    assert.throws(() => new ParticlePool(4, f, null), /resetter/, 'missing resetter throws');
  });

  await test('A1: acquire returns a re-initialized slot; stats track it', () => {
    const seen = [];
    const pool = new ParticlePool(8, () => ({}), (slot, opts) => { Object.assign(slot, opts); seen.push(opts); });
    const p = pool.acquire({ x: 3, y: 4 });
    assert.ok(p && typeof p === 'object', 'acquire must return an object');
    assert.strictEqual(p.x, 3, 'slot re-initialized with opts (x)');
    assert.strictEqual(p.y, 4, 'slot re-initialized with opts (y)');
    const s = pool.stats();
    assert.strictEqual(s.live, 1, 'one live after one acquire');
    assert.strictEqual(s.free, 7, 'free decremented');
    assert.strictEqual(s.acquired, 1, 'acquired lifetime counter');
    assert.strictEqual(s.highWater, 1, 'highWater tracks max live');
    assert.strictEqual(pool.liveCount, 1, 'liveCount getter');
    assert.strictEqual(pool.release(p), true, 'release(live slot) -> true');
    assert.strictEqual(pool.stats().live, 0, 'live back to 0 after release');
  });

  await test('A2: release + re-acquire hands back the SAME object (real pooling, LIFO)', () => {
    const pool = new ParticlePool(4, () => ({}), (s, o) => Object.assign(s, o));
    const a = pool.acquire({ tag: 'first' });
    assert.strictEqual(pool.release(a), true);
    const b = pool.acquire({ tag: 'second' });
    assert.strictEqual(b, a, 're-acquire must return the identical pooled object (no re-allocation)');
    assert.strictEqual(b.tag, 'second', 'resetter re-initialized the reused slot');
    pool.release(b);
  });

  await test('A3: release() is a boolean; foreign/double releases are safe no-ops', () => {
    const pool = new ParticlePool(4, () => ({}), (s, o) => Object.assign(s, o));
    const other = new ParticlePool(4, () => ({}), (s, o) => Object.assign(s, o));
    const p = pool.acquire({});
    const foreign = other.acquire({});
    assert.strictEqual(pool.release(p), true, 'release of a live slot -> true');
    assert.strictEqual(pool.release(p), false, 'double release -> false');
    assert.strictEqual(pool.release(foreign), false, 'foreign-pool slot -> false');
    assert.strictEqual(pool.release({}), false, 'unknown object -> false');
    assert.strictEqual(pool.release(null), false, 'null -> false');
    assert.strictEqual(pool.release(undefined), false, 'undefined -> false');
    const s = pool.stats();
    assert.strictEqual(s.live, 0, 'no-ops must not corrupt live count');
    assert.strictEqual(s.released, 1, 'exactly one counted release');
    assert.strictEqual(s.free, 4, 'all slots free');
    pool.release(foreign); // again, must stay a no-op
    assert.strictEqual(other.stats().live, 1, "releasing a foreign slot must not touch the other pool");
    other.release(foreign);
  });

  await test('A4: exhaustion uses reuse-oldest (evicts smallest seq, re-inits, hook fires)', () => {
    const evicted = [];
    const pool = new ParticlePool(3, () => ({}), (s, o) => Object.assign(s, o),
      { onEvict: (slot) => evicted.push(slot) });
    const a = pool.acquire({ id: 'a' }); // seq 0 — oldest
    const b = pool.acquire({ id: 'b' }); // seq 1
    const c = pool.acquire({ id: 'c' }); // seq 2
    assert.strictEqual(pool.stats().free, 0, 'pool exhausted');
    const d = pool.acquire({ id: 'd' }); // must evict a
    assert.strictEqual(d, a, 'exhausted acquire reuses the OLDEST live slot (a)');
    assert.strictEqual(d.id, 'd', 'evicted slot re-initialized with the new opts');
    assert.deepStrictEqual(evicted, [a], 'onEvict hook fired with the evicted slot');
    const s = pool.stats();
    assert.strictEqual(s.evicted, 1, 'evicted counted');
    assert.strictEqual(s.live, 3, 'live stays at capacity');
    assert.strictEqual(s.created, 3, 'eviction allocates nothing');
    // The evicted-then-reused slot is the newest now: next exhaustion evicts b.
    const e = pool.acquire({ id: 'e' });
    assert.strictEqual(e, b, 'next exhaustion evicts the next-oldest (b)');
    assert.strictEqual(pool.stats().evicted, 2);
    [c, d, e].forEach((p) => assert.strictEqual(pool.release(p), true));
    assert.strictEqual(pool.stats().live, 0, 'all released');
  });

  await test('B: zero post-warmup allocation — created never grows in the hot loop', () => {
    const pool = new ParticlePool(32, () => ({}), (s, o) => Object.assign(s, o));
    const created0 = pool.stats().created;
    const held = [];
    for (let i = 0; i < 2000; i++) {
      const p = pool.acquire({ i });
      if (i % 2 === 0) held.push(p);
      else pool.release(p);
    }
    held.forEach((p) => pool.release(p));
    // Drain the over-acquired oldest-evicts too.
    assert.strictEqual(
      pool.stats().created, created0,
      `factory must never run after construction (created ${created0} -> ${pool.stats().created})`
    );
    assert.strictEqual(pool.stats().live, 0, 'all released');
    console.log(`    2000 acquire/release cycles, created stayed ${created0}`);
  });

  // --------------------------------------- C/D. vfx.js hot-path wiring ---
  const win = loadFxScope();
  const src = fs.readFileSync(VFX, 'utf8');

  await test('C0: engine pool is live — window.__particlePool, capacity 4096', () => {
    const pool = win.__particlePool;
    assert.ok(pool, 'window.__particlePool must be assigned by js/vfx.js');
    assert.ok(pool instanceof win.ParticlePool, '__particlePool must be a ParticlePool');
    assert.strictEqual(pool.stats().capacity, 4096, 'live pool capacity 4096');
    assert.strictEqual(pool.stats().created, 4096, 'live pool pre-allocated 4096 slots');
    assert.ok(
      /const\s+PARTICLE_POOL_CAPACITY\s*=\s*4096/.test(src),
      'js/vfx.js must declare PARTICLE_POOL_CAPACITY = 4096'
    );
  });

  await test('C1: `new FXParticle` occurs exactly 2x in source (factory + cold fallback)', () => {
    const news = [...src.matchAll(/\bnew\s+FXParticle\s*\(/g)];
    assert.strictEqual(news.length, 2, `expected exactly 2 'new FXParticle' occurrences, got ${news.length}`);
    const ctxLines = news.map((m) => src.slice(Math.max(0, m.index - 60), m.index + 20).replace(/\n/g, ' '));
    console.log('    ' + ctxLines.join('\n    '));
    assert.ok(/cold fallback/.test(src.slice(news[1].index - 80, news[1].index + 40)),
      'the second occurrence must be the documented cold fallback');
  });

  await test('C2: zero `addParticle(new FXParticle` and zero `.filter(` in update()', () => {
    assert.ok(!src.includes('addParticle(new FXParticle'),
      'hot path must never addParticle(new FXParticle(...))');
    const update = methodBody(classBody(src, 'FX2DEngine'), 'update');
    assert.ok(!update.includes('.filter('),
      'FX2DEngine.update must not contain `.filter(` (no per-frame array alloc)');
    const news = [...update.matchAll(/\bnew\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    assert.deepStrictEqual(news, [], `FX2DEngine.update must not allocate; found new: ${news.join(', ')}`);
  });

  // ------------------------------------------------ D. gradient cache ----
  function makeCountingCtx() {
    const counts = { createRadialGradient: 0 };
    const grad = { addColorStop() {} };
    const ctx = new Proxy({}, {
      get(t, k) {
        if (k === '__counts') return counts;
        if (k === 'createRadialGradient') {
          return (...a) => { counts.createRadialGradient++; return grad; };
        }
        return (...a) => ctx; // chainable no-op for every other canvas call
      },
      set(t, k, v) { t[k] = v; return true; },
    });
    return { ctx, counts };
  }

  await test('D: gradient cache is behavioral — N builds on frame 1, 0 on the next 60', () => {
    const fx2d = win.vfxEngine.fx2d;
    assert.ok(fx2d, 'vfxEngine.fx2d must exist');
    fx2d.running = true; // keep start() from touching requestAnimationFrame
    const { ctx, counts } = makeCountingCtx();
    fx2d.ctx = ctx;
    fx2d.canvas = {};
    // Three fire particles in distinct size buckets -> three cache keys.
    fx2d.addParticle({ type: 'fire', radius: 8, life: 100, x: 10, y: 10 });
    fx2d.addParticle({ type: 'fire', radius: 12, life: 100, x: 20, y: 20 });
    fx2d.addParticle({ type: 'fire', radius: 20, life: 100, x: 30, y: 30 });
    fx2d.draw();
    const frame1 = counts.createRadialGradient;
    assert.strictEqual(frame1, 3, `frame 1 must build one gradient per key, got ${frame1}`);
    const keys = [...fx2d._gradCache.map.keys()].sort();
    assert.deepStrictEqual(keys, ['fire|12', 'fire|20', 'fire|8'],
      `per-engine cache keys must be type|size-bucket — got ${JSON.stringify(keys)}`);
    for (let f = 0; f < 60; f++) fx2d.draw();
    assert.strictEqual(
      counts.createRadialGradient, frame1,
      `frames 2..61 must build ZERO new gradients (got ${counts.createRadialGradient - frame1} new)`
    );
    console.log(`    createRadialGradient calls: frame1=${frame1}, frames2..61=+${counts.createRadialGradient - frame1}`);
    fx2d.clear();
  });

  // --------------------------------- E/F. behavioral hot-path integration -
  await test('E: vfx.js public API unchanged (19 baseline AAAEngine methods + window surface)', () => {
    const aaa = classBody(src, 'AAAEngine');
    const methods = [...aaa.matchAll(/^\s{4}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
    const missing = BASELINE_API.filter((m) => !methods.includes(m));
    assert.deepStrictEqual(missing, [], `AAAEngine lost methods vs baseline: ${missing.join(', ')}`);
    assert.ok(win.vfxEngine && win.aaaEngine && win.fxEngine, 'window.vfxEngine/aaaEngine/fxEngine assigned');
    assert.ok(win.soundFx, 'window.soundFx assigned');
    assert.strictEqual(typeof win.vfxEngine.playCapture, 'function', 'engine.playCapture present');
  });

  await test('F1: spawn/update/drain — dead particles return to the pool, array identity kept', () => {
    const fx2d = win.vfxEngine.fx2d;
    fx2d.running = true;
    fx2d.clear();
    const pool = win.__particlePool;
    const base = pool.stats();
    const arr = fx2d.particles;
    for (let i = 0; i < 20; i++) fx2d.addParticle({ x: i, y: i, vx: 1, vy: 1, life: 0.05 });
    assert.strictEqual(fx2d.particles.length, 20, '20 particles spawned');
    assert.strictEqual(pool.stats().live, base.live + 20, 'pool tracks the 20 live');
    for (let f = 0; f < 5; f++) fx2d.update(0.1); // life 0.05 -> dead on frame 1
    assert.strictEqual(fx2d.particles.length, 0, 'update drained all dead particles');
    assert.strictEqual(fx2d.particles, arr, 'swap-remove compaction preserves array identity');
    assert.strictEqual(pool.stats().live, base.live, 'dead particles released back to the pool (no leak)');
    const s = pool.stats();
    assert.strictEqual(s.acquired, s.released + s.live,
      `pool invariant acquired === released + live — got ${JSON.stringify(s)}`);
  });

  await test('F2: re-spawn reuses pooled slots; clear() releases all in place', () => {
    const fx2d = win.vfxEngine.fx2d;
    fx2d.running = true;
    fx2d.clear();
    const pool = win.__particlePool;
    const first = [];
    for (let i = 0; i < 20; i++) { fx2d.addParticle({ x: i, life: 100 }); first.push(fx2d.particles[i]); }
    const arr = fx2d.particles;
    fx2d.clear();
    assert.strictEqual(fx2d.particles, arr, 'clear() preserves array identity (in-place truncation)');
    assert.strictEqual(fx2d.particles.length, 0, 'clear() empties the array');
    const mid = pool.stats();
    assert.strictEqual(mid.live, 0, 'clear() released every live particle');
    assert.strictEqual(mid.acquired, mid.released, 'acquired === released after full drain');
    for (let i = 0; i < 20; i++) fx2d.addParticle({ x: 100 + i, life: 100 });
    const reused = fx2d.particles.filter((p) => first.includes(p)).length;
    assert.ok(reused > 0, `re-spawn must reuse pooled slots, got ${reused}/20`);
    console.log(`    hot-path slot reuse after clear: ${reused}/20`);
    fx2d.clear();
  });

  await test('F3: FXParticle.reset field parity with the constructor (endColor quirk verbatim)', () => {
    const FXParticle = win.__FXParticle;
    const opts = {
      x: 1, y: 2, vx: 3, vy: 4, radius: 7, growth: 0.5, life: 2,
      color: '#abc', endColor: '#def', alpha: 0.5, drag: 0.9, gravity: 0.1,
      type: 'fire', rotation: 1.2, vRot: 0.3, data: { a: 1 },
    };
    const viaCtor = new FXParticle(opts);
    const viaReset = new FXParticle({});
    viaReset.reset(opts);
    for (const k of Object.keys(viaCtor)) {
      assert.deepStrictEqual(viaReset[k], viaCtor[k], `reset() must reproduce constructor field '${k}'`);
    }
    // The original endColor quirk, preserved verbatim: falls back to
    // opts.color (not '#fff'), and stays undefined when neither is given.
    assert.strictEqual(new FXParticle({ color: '#abc' }).endColor, '#abc', 'endColor defaults to opts.color');
    assert.strictEqual(new FXParticle({}).endColor, undefined, 'endColor quirk: undefined when unset');
    assert.strictEqual(new FXParticle({ endColor: '#def' }).endColor, '#def', 'explicit endColor kept');
  });

  await test('F4: cold fallback — vfx.js works with NO pool script (new FXParticle path)', () => {
    const cold = loadFxScope({ withPool: false });
    assert.strictEqual(cold.__particlePool, null, 'no pool script -> __particlePool is null');
    const fx2d = cold.vfxEngine.fx2d;
    fx2d.running = true;
    assert.doesNotThrow(() => {
      fx2d.addParticle({ x: 1, y: 2, life: 1 });
      fx2d.update(0.016);
    }, 'cold-fallback spawn/update must not throw');
    assert.strictEqual(fx2d.particles.length, 1, 'particle alive in the hot loop');
    assert.strictEqual(fx2d.particles[0].constructor.name, 'FXParticle',
      'cold fallback allocates real FXParticle instances');
    for (let f = 0; f < 200; f++) fx2d.update(0.016);
    assert.strictEqual(fx2d.particles.length, 0, 'cold-fallback particles still drain');
    console.log('    cold fallback verified: game never breaks without particle-pool.js');
  });

  // ------------------------------------------------------- G. wiring ----
  await test('G: index.html wires particle-pool.js BEFORE vfx.js; all 23 tags resolve', () => {
    assert.ok(fs.existsSync(INDEX), 'index.html must exist');
    const html = fs.readFileSync(INDEX, 'utf8');
    const srcs = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"[^>]*>/g)].map((m) => m[1]);
    assert.strictEqual(srcs.length, 23, `index.html must have 23 script tags, got ${srcs.length}`);
    const poolIdx = srcs.indexOf('js/particle-pool.js');
    const vfxIdx = srcs.indexOf('js/vfx.js');
    assert.ok(poolIdx >= 0, 'particle-pool.js script tag present');
    assert.ok(vfxIdx >= 0, 'vfx.js script tag present');
    assert.ok(poolIdx < vfxIdx,
      `particle-pool.js (tag ${poolIdx}) must load BEFORE vfx.js (tag ${vfxIdx})`);
    const missing = srcs.filter((s) => !fs.existsSync(path.join(ROOT, s)));
    assert.deepStrictEqual(missing, [], `unresolvable script tags: ${missing.join(', ')}`);
    console.log(`    tag order: ...${srcs.slice(Math.max(0, poolIdx - 1), vfxIdx + 2).join(' -> ')}...`);
  });

  console.log(`\nparticle-pool tests: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ' — ALL PASSED'}`);
})().catch((err) => {
  console.error('particle-pool tests FAILED:');
  console.error(err);
  process.exit(1);
});
