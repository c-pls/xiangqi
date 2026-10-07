/**
 * admin-gate.js — admin-only visibility for the VFX config in settings.
 *
 * The FX settings block (#fxConfigBlock: intensity, theme, skip, mute, volume
 * sliders) is hidden for regular players. An admin login row (#fxAdminLogin)
 * in the settings panel takes an account + password; only the admin account
 * can unlock it, revealing the config block for the rest of the tab session.
 * The debug panel (js/debug-panel.js) consults window.AdminGate before
 * opening, so Shift+Alt+D / ?fxdebug=1 are admin-only too.
 *
 * Exposes `window.AdminGate` (classic script; assigns explicitly to window):
 *   AdminGate.verifyCredentials(account, pw) — true for the admin account.
 *   AdminGate.isUnlocked()                   — true when this tab session is unlocked.
 *   AdminGate.unlock(account, pw)            — unlock on valid credentials (false if not).
 *   AdminGate.lock()                         — re-lock immediately.
 *
 * Persistence is per tab session (sessionStorage), never a cookie: closing the
 * tab locks it again. Falls back to an in-memory flag when sessionStorage is
 * unavailable (e.g. unit tests). The pre-existing multiplayer admin session
 * (localStorage.xiangqi_isAdmin, same 'admin' account, set by the multiplayer
 * login) also unlocks the gate, so one admin login covers everything.
 * No game-rules or game-logic changes.
 *
 * NOTE: this is a casual UI gate, not real security — the credentials live in
 * this client-side file, so anyone reading the source can find them. It keeps
 * honest players out of the FX controls; it does not keep out anyone with
 * devtools open.
 */
(function () {
    'use strict';

    var ADMIN_ACCOUNT = 'admin';
    var ADMIN_PASSWORD = '36';
    var SESSION_KEY = 'ag_fx_admin';
    var CONFIG_ID = 'fxConfigBlock';
    var LOGIN_ID = 'fxAdminLogin';

    var _memUnlocked = false; // fallback when sessionStorage is unavailable

    function session() {
        try {
            if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
        } catch (e) {}
        return null;
    }

    function verifyCredentials(account, pw) {
        return String(account == null ? '' : account) === ADMIN_ACCOUNT &&
               String(pw == null ? '' : pw) === ADMIN_PASSWORD;
    }

    function sessionUnlocked() {
        var s = session();
        if (s) {
            try { return s.getItem(SESSION_KEY) === '1'; } catch (e) { return false; }
        }
        return _memUnlocked;
    }

    // The multiplayer login (js/multiplayer.js) has its own admin session for
    // the same 'admin' account, persisted as localStorage.xiangqi_isAdmin.
    // One admin login unlocks everything: honor it here so admins don't have
    // to log in twice.
    function multiplayerAdmin() {
        try {
            if (typeof window !== 'undefined' && window.localStorage &&
                window.localStorage.getItem('xiangqi_isAdmin') === 'true') return true;
        } catch (e) {}
        return false;
    }

    function isUnlocked() {
        return sessionUnlocked() || multiplayerAdmin();
    }

    function setUnlocked(on) {
        var s = session();
        if (s) {
            try {
                if (on) s.setItem(SESSION_KEY, '1');
                else s.removeItem(SESSION_KEY);
            } catch (e) {}
        } else {
            _memUnlocked = !!on;
        }
    }

    function el(id) {
        try {
            if (typeof document !== 'undefined' && document.getElementById) return document.getElementById(id);
        } catch (e) {}
        return null;
    }

    function applyVisibility() {
        var on = isUnlocked();
        var cfg = el(CONFIG_ID);
        var login = el(LOGIN_ID);
        if (cfg && cfg.style) { try { cfg.style.display = on ? 'flex' : 'none'; } catch (e) {} }
        if (login && login.style) { try { login.style.display = on ? 'none' : ''; } catch (e) {} }
    }

    function unlock(account, pw) {
        if (!verifyCredentials(account, pw)) return false;
        setUnlocked(true);
        applyVisibility();
        return true;
    }

    function lock() {
        setUnlocked(false);
        // Revoke the multiplayer admin session too, otherwise isUnlocked()
        // would stay true through it and the lock would look broken.
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.removeItem('xiangqi_isAdmin');
            }
        } catch (e) {}
        // multiplayer.js caches its own isAdmin flag, so hide its admin-only
        // UI directly (it re-reads storage on next init).
        try {
            var m = el('vfxShowcaseMenu');
            if (m && m.style) m.style.display = 'none';
            var t = el('themeSelect');
            if (t && t.style) t.style.display = 'none';
        } catch (e2) {}
        applyVisibility();
    }

    function fieldValue(id) {
        var f = el(id);
        return (f && 'value' in f) ? f.value : '';
    }

    function clearFields() {
        var a = el('fxAdminAccount');
        var p = el('fxAdminPw');
        try { if (a) a.value = ''; } catch (e) {}
        try { if (p) p.value = ''; } catch (e2) {}
    }

    function bindUi() {
        var acctInput = el('fxAdminAccount');
        var pwInput = el('fxAdminPw');
        var unlockBtn = el('fxAdminUnlock');
        var lockBtn = el('fxAdminLock');
        function attempt() {
            var ok = unlock(fieldValue('fxAdminAccount'), fieldValue('fxAdminPw'));
            if (!ok && pwInput) {
                try {
                    pwInput.value = '';
                    pwInput.placeholder = 'Wrong credentials / \u5e33\u865f\u6216\u5bc6\u78bc\u932f\u8aa4';
                    if (typeof pwInput.focus === 'function') pwInput.focus();
                } catch (e) {}
            } else {
                clearFields();
            }
            return ok;
        }
        function bindEnter(input) {
            if (input && !input.__fxAdminBound) {
                input.__fxAdminBound = true;
                if (typeof input.addEventListener === 'function') {
                    input.addEventListener('keydown', function (e) {
                        if (e && (e.key === 'Enter' || e.code === 'Enter')) {
                            if (typeof e.preventDefault === 'function') e.preventDefault();
                            attempt();
                        }
                    });
                }
            }
        }
        if (unlockBtn && !unlockBtn.__fxAdminBound) {
            unlockBtn.__fxAdminBound = true;
            if (typeof unlockBtn.addEventListener === 'function') unlockBtn.addEventListener('click', attempt);
        }
        bindEnter(acctInput);
        bindEnter(pwInput);
        if (lockBtn && !lockBtn.__fxAdminBound) {
            lockBtn.__fxAdminBound = true;
            if (typeof lockBtn.addEventListener === 'function') lockBtn.addEventListener('click', lock);
        }
    }

    function init() {
        applyVisibility();
        bindUi();
        try {
            if (typeof document !== 'undefined' && document.addEventListener) {
                document.addEventListener('DOMContentLoaded', function () {
                    applyVisibility();
                    bindUi();
                });
            }
        } catch (e) {}
    }

    if (typeof window !== 'undefined') {
        window.AdminGate = {
            verifyCredentials: verifyCredentials,
            isUnlocked: isUnlocked,
            unlock: unlock,
            lock: lock
        };
    }

    try { init(); } catch (e) { /* never break the page */ }
})();
