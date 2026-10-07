'use strict';
/**
 * tests/admin-gate.test.js — tests for the admin gate: the VFX config in
 * settings is visible to the admin account only (account "admin" + password),
 * plus a CSS regression test for the idle-breathe keyframes.
 *
 * Covers:
 *  - AdminGate.verifyCredentials: accepts ("admin", "36"), rejects wrong
 *    account, wrong password, empty, null.
 *  - unlock("admin", "36") -> true + isUnlocked(); wrong creds -> false.
 *  - lock() re-locks.
 *  - sessionStorage persistence: unlock survives a fresh script load sharing
 *    the same sessionStorage (simulates a tab reload).
 *  - In-memory fallback when sessionStorage is unavailable.
 *  - Settings UI wiring: login reveals #fxConfigBlock and hides #fxAdminLogin;
 *    lock reverses; Enter key in either field logs in; Lock button locks.
 *  - Debug panel gate: FxDebug.show() returns false when AdminGate is present
 *    and locked; true when unlocked; true when AdminGate is absent (legacy).
 *  - CSS: fx-idle-breathe keyframes carry translate(-50%,-50%) (the Phase 5
 *    regression displaced every piece while idle ambience ran); flipped
 *    variant keeps rotate(180deg); reduced-motion stills both.
 *  - index.html: config block default-hidden, admin login row present,
 *    admin-gate.js script tag present.
 *
 * NOTE: the gate is a casual client-side UI gate, not real security — the
 * credentials live in js/admin-gate.js.
 *
 * Exit codes: 0 = pass, non-zero = fail.
 * Run from the sandbox root: node tests/admin-gate.test.js
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('node:path');
const harness = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const GATE = path.join(ROOT, 'js', 'admin-gate.js');
const PANEL = path.join(ROOT, 'js', 'debug-panel.js');
const CSS = path.join(ROOT, 'style.css');
const HTML = path.join(ROOT, 'index.html');

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

function needFile(p, what) {
  if (!fs.existsSync(p)) {
    console.error(`NOT-LANDED: ${what} missing (${p})`);
    process.exit(3);
  }
}

// ------------------------------------------------------------ DOM stubs ----
function makeEl(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    id: '', className: '', textContent: '', innerHTML: '', value: '',
    placeholder: '',
    setAttribute(k, v) { el['attr:' + k] = String(v); },
    getAttribute(k) { return el['attr:' + k] !== undefined ? el['attr:' + k] : null; },
    appendChild(c) { el.children.push(c); return c; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
    click() {},
    fire(t, ev) { (listeners[t] || []).forEach((fn) => fn(ev || {})); },
  };
  return el;
}

function makeDoc(ids) {
  const els = {};
  (ids || []).forEach((id) => { els[id] = makeEl('div'); els[id].id = id; });
  const body = makeEl('body');
  return {
    els, body,
    created: [],
    createElement(tag) { const el = makeEl(tag); this.created.push(el); return el; },
    getElementById(id) { return els[id] || null; },
    addEventListener() {},
    removeEventListener() {},
  };
}

const GATE_IDS = ['fxConfigBlock', 'fxAdminLogin', 'fxAdminAccount', 'fxAdminPw', 'fxAdminUnlock', 'fxAdminLock'];

function loadGate(opts) {
  opts = opts || {};
  const stubs = harness.makeStubs();
  if (opts.sessionStorage) stubs.window.sessionStorage = opts.sessionStorage;
  const doc = opts.document === undefined ? makeDoc(GATE_IDS) : opts.document;
  const win = harness.loadScript(stubs, GATE, { document: doc });
  return { win, doc, stubs, gate: win.AdminGate };
}

// ---------------------------------------------------------------- tests ----
(async () => {
  needFile(GATE, 'js/admin-gate.js');

  await test('verifyCredentials accepts only the admin account + password', () => {
    const { gate } = loadGate();
    assert.strictEqual(typeof gate.verifyCredentials, 'function');
    assert.strictEqual(gate.verifyCredentials('admin', '36'), true);
    assert.strictEqual(gate.verifyCredentials('admin', '37'), false, 'wrong password rejected');
    assert.strictEqual(gate.verifyCredentials('root', '36'), false, 'wrong account rejected');
    assert.strictEqual(gate.verifyCredentials('Admin', '36'), false, 'account is case-sensitive');
    assert.strictEqual(gate.verifyCredentials('', ''), false);
    assert.strictEqual(gate.verifyCredentials(null, null), false);
    assert.strictEqual(gate.verifyCredentials('admin', ''), false);
  });

  await test('unlock/lock cycle with in-memory fallback (no sessionStorage)', () => {
    const { gate } = loadGate();
    assert.strictEqual(gate.isUnlocked(), false);
    assert.strictEqual(gate.unlock('admin', 'wrong'), false);
    assert.strictEqual(gate.isUnlocked(), false);
    assert.strictEqual(gate.unlock('user', '36'), false, 'right password, wrong account');
    assert.strictEqual(gate.isUnlocked(), false);
    assert.strictEqual(gate.unlock('admin', '36'), true);
    assert.strictEqual(gate.isUnlocked(), true);
    gate.lock();
    assert.strictEqual(gate.isUnlocked(), false);
  });

  await test('unlock persists across a fresh load sharing sessionStorage', () => {
    const ss = harness.makeLocalStorage();
    const first = loadGate({ sessionStorage: ss });
    assert.strictEqual(first.gate.isUnlocked(), false);
    assert.strictEqual(first.gate.unlock('admin', '36'), true);
    const second = loadGate({ sessionStorage: ss });
    assert.strictEqual(second.gate.isUnlocked(), true, 'reload in same tab session stays unlocked');
    second.gate.lock();
    const third = loadGate({ sessionStorage: ss });
    assert.strictEqual(third.gate.isUnlocked(), false, 'lock clears the session flag');
  });

  await test('login reveals the config block and hides the login row', () => {
    const { gate, doc } = loadGate();
    // init() ran at load with locked state: config hidden, login visible.
    assert.strictEqual(doc.els.fxConfigBlock.style.display, 'none');
    assert.notStrictEqual(doc.els.fxAdminLogin.style.display, 'none');
    gate.unlock('admin', '36');
    assert.strictEqual(doc.els.fxConfigBlock.style.display, 'flex');
    assert.strictEqual(doc.els.fxAdminLogin.style.display, 'none');
    gate.lock();
    assert.strictEqual(doc.els.fxConfigBlock.style.display, 'none');
    assert.notStrictEqual(doc.els.fxAdminLogin.style.display, 'none');
  });

  await test('Login button and Enter key drive login; wrong creds show an error hint', () => {
    const { gate, doc } = loadGate();
    doc.els.fxAdminAccount.value = 'admin';
    doc.els.fxAdminPw.value = 'nope';
    doc.els.fxAdminUnlock.fire('click');
    assert.strictEqual(gate.isUnlocked(), false);
    assert.strictEqual(doc.els.fxAdminPw.value, '', 'password field cleared after attempt');
    assert.ok(String(doc.els.fxAdminPw.placeholder).length > 0, 'error hint shown');
    doc.els.fxAdminAccount.value = 'admin';
    doc.els.fxAdminPw.value = '36';
    doc.els.fxAdminPw.fire('keydown', { key: 'Enter', preventDefault() {} });
    assert.strictEqual(gate.isUnlocked(), true);
    assert.strictEqual(doc.els.fxConfigBlock.style.display, 'flex');
    doc.els.fxAdminLock.fire('click');
    assert.strictEqual(gate.isUnlocked(), false);
    assert.strictEqual(doc.els.fxConfigBlock.style.display, 'none');
  });

  await test('debug panel show() is blocked when AdminGate is locked', () => {
    const stubs = harness.makeStubs();
    stubs.window.AdminGate = { isUnlocked: () => false };
    const doc = makeDoc([]);
    const win = harness.loadScript(stubs, PANEL, { document: doc });
    assert.strictEqual(win.FxDebug.show(), false, 'locked admin blocks the panel');
    assert.strictEqual(win.FxDebug.isVisible(), false, 'panel stays hidden while blocked');
  });

  await test('debug panel show() opens when AdminGate is unlocked', () => {
    const stubs = harness.makeStubs();
    stubs.window.AdminGate = { isUnlocked: () => true };
    const doc = makeDoc([]);
    const win = harness.loadScript(stubs, PANEL, { document: doc });
    assert.strictEqual(win.FxDebug.show(), true, 'unlocked admin may open the panel');
  });

  await test('debug panel keeps legacy behavior when AdminGate is absent', () => {
    const stubs = harness.makeStubs();
    const doc = makeDoc([]);
    const win = harness.loadScript(stubs, PANEL, { document: doc });
    assert.strictEqual(win.FxDebug.show(), true, 'no AdminGate -> panel opens as before');
  });

  await test('CSS: fx-idle-breathe keyframes preserve piece centering', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    const at = css.indexOf('@keyframes fx-idle-breathe');
    assert.ok(at !== -1, 'fx-idle-breathe keyframes exist');
    const block = css.slice(at, css.indexOf('\n}', at) + 3);
    assert.ok(block.includes('translate(-50%, -50%)'), 'keyframes carry the base translate');
    assert.ok(!/transform:\s*scale\(1\)/.test(block), 'no bare scale() that would drop the translate');
    const flippedAt = css.indexOf('@keyframes fx-idle-breathe-flipped');
    assert.ok(flippedAt !== -1, 'flipped-board variant exists');
    const flippedBlock = css.slice(flippedAt, css.indexOf('\n}', flippedAt) + 3);
    assert.ok(flippedBlock.includes('rotate(180deg)'), 'flipped variant keeps 180deg orientation');
    assert.ok(flippedBlock.includes('translate(-50%, -50%)'), 'flipped variant keeps centering');
    const rmAt = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
    assert.ok(rmAt !== -1);
    const rmBlock = css.slice(rmAt, rmAt + 600);
    assert.ok(rmBlock.includes('.board-outer.flipped #boardLayer .piece-wrap'),
      'reduced-motion stills the flipped variant too');
  });

  await test('multiplayer admin session also unlocks the gate (single login)', () => {
    const { gate, stubs } = loadGate();
    assert.strictEqual(gate.isUnlocked(), false, 'locked initially');
    stubs.window.localStorage.setItem('xiangqi_isAdmin', 'true');
    assert.strictEqual(gate.isUnlocked(), true,
      'the pre-existing multiplayer admin session unlocks the VFX gate');
    gate.lock();
    assert.strictEqual(gate.isUnlocked(), false, 'locked again');
    assert.strictEqual(stubs.window.localStorage.getItem('xiangqi_isAdmin'), null,
      'lock() revokes the multiplayer admin session too');
  });

  await test('index.html wires the admin gate (hidden config, login row, script)', () => {
    const html = fs.readFileSync(HTML, 'utf8');
    assert.ok(html.includes('id="fxConfigBlock"'), 'config block has an id');
    const cfgIdx = html.indexOf('id="fxConfigBlock"');
    const cfgTag = html.slice(cfgIdx, cfgIdx + 300);
    assert.ok(cfgTag.includes('display: none'), 'config block is hidden by default');
    assert.ok(html.includes('id="fxAdminLogin"'), 'admin login row present');
    assert.ok(html.includes('id="fxAdminAccount"'), 'account field present');
    assert.ok(html.includes('id="fxAdminPw"'), 'password field present');
    assert.ok(html.includes('id="fxAdminUnlock"'), 'login button present');
    assert.ok(html.includes('id="fxAdminLock"'), 'lock button present');
    assert.ok(html.includes('js/admin-gate.js'), 'admin-gate.js script tag present');
  });

  console.log(`\n${passed} tests passed.`);
})();
