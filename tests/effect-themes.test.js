'use strict';
/**
 * tests/effect-themes.test.js — QA (W4) tests for Phase 5 effect themes (W2).
 *
 * Covers (PINNED to the W2 actual API, verified 2026-10-06):
 *  - window.EffectThemes API: register(name, def), apply(name)->bool,
 *    list()->string[], current()->string.
 *  - Theme def shape: { palette: {role: color}, cssVars: {'--var': value},
 *    audioRemap: {...} } — all sections optional, normalized.
 *  - Built-ins 'ink' (default) and 'neon'; apply switches the palette by
 *    setting CSS vars on document.documentElement.style and persists the
 *    choice to localStorage['ag_fx_theme']; stale vars are removed on switch.
 *  - apply(unknown) returns false and changes nothing (current, storage, vars).
 *  - register() adds a custom theme; register returns false (no throw, no
 *    corruption) for invalid input; persistence across reload.
 *
 * QA CONTRACT v1 (assumptions — flagged to the Phase 5 manager for W2 alignment;
 *  re-pinned 2026-10-06 to the W2 actual def shape):
 *  - js/effect-themes.js assigns `window.EffectThemes`.
 *  - Theme def shape: { palette: {...}, cssVars: { '--var': value, ... },
 *    audioRemap: {...} } (NOT the scaffold's {vars:{...}}).
 *  - apply() writes cssVars via document.documentElement.style.setProperty and
 *    removes vars the new theme doesn't define.
 *  - Persistence key is exactly 'ag_fx_theme'.
 *
 * Exit codes: 0 = pass, 1 = fail, 3 = implementation not landed yet.
 * node:assert only, zero deps. Run from the sandbox root:
 *   node tests/effect-themes.test.js
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const THEMES = path.join(ROOT, 'js', 'effect-themes.js');

function needLanded() {
  if (!fs.existsSync(THEMES)) {
    console.error(`NOT-LANDED: js/effect-themes.js (W2) not present — re-run after W2 lands. (${THEMES})`);
    process.exit(3);
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

// document stub recording CSS var writes on documentElement.style.
function makeDocument() {
  const vars = {};
  const style = {
    setProperty(k, v) { vars[String(k)] = String(v); },
    getPropertyValue(k) { return vars[String(k)] || ''; },
    removeProperty(k) { delete vars[String(k)]; },
  };
  const doc = {
    vars,
    documentElement: { style },
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    getElementById: () => null,
    addEventListener() {},
  };
  return doc;
}

function loadFresh(seedStorage) {
  const stubs = harness.makeStubs();
  if (seedStorage) {
    for (const [k, v] of Object.entries(seedStorage)) stubs.localStorage.setItem(k, v);
  }
  const doc = makeDocument();
  stubs.window.document = doc; // cover window.document access
  harness.loadScript(stubs, THEMES, { document: doc }); // cover bare-document access
  const T = stubs.window.EffectThemes;
  assert.ok(T, 'window.EffectThemes must be assigned by js/effect-themes.js');
  return { stubs, doc, T };
}

function snapshotVars(doc) {
  return Object.assign({}, doc.vars);
}

// ------------------------------------------------------------------ tests ---

needLanded();

(async () => {
  await test('API surface: register/apply/list/current', () => {
    const { T } = loadFresh();
    for (const m of ['register', 'apply', 'list', 'current']) {
      assert.strictEqual(typeof T[m], 'function', `EffectThemes.${m}() must exist — got: ${Object.keys(T).join(',')}`);
    }
  });

  await test('built-ins ink + neon are listed; default is ink with empty storage', () => {
    const { T } = loadFresh();
    const list = T.list();
    assert.ok(Array.isArray(list), 'list() must return an array');
    assert.ok(list.includes('ink'), `list() must include 'ink' — got ${JSON.stringify(list)}`);
    assert.ok(list.includes('neon'), `list() must include 'neon' — got ${JSON.stringify(list)}`);
    assert.strictEqual(T.current(), 'ink', 'default theme must be ink');
  });

  await test('default load applies the ink palette as CSS vars', () => {
    const { doc } = loadFresh();
    const fxVars = Object.keys(doc.vars).filter((k) => k.startsWith('--fx-'));
    assert.ok(fxVars.length > 0, `applying ink must set --fx-* CSS vars — got ${JSON.stringify(doc.vars)}`);
    console.log(`    ink sets ${fxVars.length} --fx-* vars`);
  });

  await test('apply(neon) switches palette, sets CSS vars, persists ag_fx_theme', () => {
    const { stubs, doc, T } = loadFresh();
    const before = snapshotVars(doc);
    const ret = T.apply('neon');
    assert.strictEqual(ret, true, 'apply(neon) must return true');
    assert.strictEqual(T.current(), 'neon', 'current() must be neon after apply');
    assert.strictEqual(stubs.localStorage.getItem('ag_fx_theme'), 'neon', 'ag_fx_theme must persist as neon');
    const after = snapshotVars(doc);
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    assert.ok(changed.length > 0, `neon must change at least one CSS var vs ink — changed: ${changed.length}`);
    console.log(`    neon changed ${changed.length} vars: ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? '…' : ''}`);
  });

  await test('apply(unknown) returns false and changes nothing', () => {
    const { stubs, doc, T } = loadFresh();
    T.apply('neon');
    const varsBefore = snapshotVars(doc);
    const ret = T.apply('no-such-theme');
    assert.strictEqual(ret, false, 'apply(unknown) must return false');
    assert.strictEqual(T.current(), 'neon', 'current() must stay neon');
    assert.strictEqual(stubs.localStorage.getItem('ag_fx_theme'), 'neon', 'storage must stay neon');
    assert.deepStrictEqual(snapshotVars(doc), varsBefore, 'CSS vars must be untouched');
  });

  await test('register() adds a custom theme that applies + persists', () => {
    const { stubs, doc, T } = loadFresh();
    // Actual def shape: { palette, cssVars, audioRemap }.
    assert.strictEqual(
      T.register('custom', { cssVars: { '--fx-glow': '#123456', '--fx-ember': '#abcdef' } }),
      true, 'register(valid) must return true'
    );
    assert.ok(T.list().includes('custom'), 'list() must include the registered theme');
    assert.strictEqual(T.apply('custom'), true, 'apply(custom) must return true');
    assert.strictEqual(T.current(), 'custom');
    assert.strictEqual(stubs.localStorage.getItem('ag_fx_theme'), 'custom');
    assert.strictEqual(doc.vars['--fx-glow'], '#123456', 'custom theme cssVars must reach CSS');
    assert.strictEqual(doc.vars['--fx-ember'], '#abcdef', 'custom theme cssVars must reach CSS');
    // Switching away drops the custom vars (stale-var removal).
    T.apply('ink');
    assert.strictEqual(doc.vars['--fx-glow'], undefined, 'stale custom vars removed on theme switch');
  });

  await test('invalid register() returns false and does not corrupt theme state', () => {
    const { T } = loadFresh();
    const listBefore = T.list().slice();
    const curBefore = T.current();
    assert.strictEqual(T.register('', { cssVars: {} }), false, 'empty name rejected');
    assert.strictEqual(T.register('bad', null), false, 'null def rejected');
    assert.strictEqual(T.register('bad2', 'nope'), false, 'non-object def rejected');
    assert.deepStrictEqual(T.list(), listBefore, 'list() unchanged after invalid register');
    assert.strictEqual(T.current(), curBefore, 'current() unchanged after invalid register');
  });

  await test('persisted theme restores across reload', () => {
    const { T } = loadFresh({ ag_fx_theme: 'neon' });
    assert.strictEqual(T.current(), 'neon', 'reload with ag_fx_theme=neon must restore neon');
    const { T: T2, doc: doc2 } = loadFresh({ ag_fx_theme: 'bogus' });
    assert.strictEqual(T2.current(), 'ink', 'bogus persisted value must fall back to ink');
    assert.ok(Object.keys(doc2.vars).length > 0, 'fallback still applies the ink palette');
  });

  console.log(`\neffect-themes tests: ${passed} passed${process.exitCode ? ' (WITH FAILURES)' : ' — ALL PASSED'}`);
})().catch((err) => {
  console.error('effect-themes tests FAILED:');
  console.error(err);
  process.exit(1);
});
