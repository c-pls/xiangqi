/**
 * GameBus — tiny synchronous event emitter for the Phase 1 effects system.
 *
 * No dependencies. Loaded as a classic script; assigns explicitly to window.
 * Must load before js/effects-bridge.js (effects-bridge.js guards if absent).
 *
 * Phase 1 events: 'move', 'capture', 'check', 'checkmate', 'soldierCrossRiver'
 *
 * API:
 *   window.GameBus.on(event, fn)      — subscribe
 *   window.GameBus.off(event, fn)     — unsubscribe one registration
 *   window.GameBus.emit(event, payload) — publish synchronously
 *
 * emit() iterates a COPY of the handler array and wraps each handler in
 * try/catch (logged via console.error) so one failing handler cannot break
 * the others — critical because the 'capture' commit callback must run.
 */
(function () {
    'use strict';

    var handlers = {};

    function listFor(event, create) {
        var list = handlers[event];
        if (!list && create) {
            list = [];
            handlers[event] = list;
        }
        return list;
    }

    window.GameBus = {
        on: function (event, fn) {
            if (typeof event !== 'string' || typeof fn !== 'function') {
                console.error('[GameBus] on() requires (string, function), got:', event, fn);
                return;
            }
            listFor(event, true).push(fn);
        },

        off: function (event, fn) {
            var list = listFor(event, false);
            if (!list) return;
            var idx = list.indexOf(fn);
            if (idx !== -1) list.splice(idx, 1);
        },

        emit: function (event, payload) {
            var list = listFor(event, false);
            if (!list || list.length === 0) return;
            // Copy: handlers may subscribe/unsubscribe during emit.
            var snapshot = list.slice();
            for (var i = 0; i < snapshot.length; i++) {
                try {
                    snapshot[i](payload);
                } catch (err) {
                    console.error('[GameBus] handler threw for event "' + event + '":', err);
                }
            }
        }
    };
})();
