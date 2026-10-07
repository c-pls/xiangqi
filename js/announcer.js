/**
 * Announcer — Phase 2 capture-event narration for the AntiGravity cinematic effects system.
 *
 * Pure logic, no DOM: every method returns plain descriptors; a separate popup
 * renderer (owning worker) turns descriptors into on-screen popups. Classic
 * script; assigns explicitly to window. No dependencies.
 *
 * FROZEN CONTRACT (do not change the API shape):
 *   window.Announcer = {
 *     reset(gameId),                                   // clears per-game capture history
 *     announceForCapture({piece, victim, side, moveNumber}) // -> {text, level} | null
 *   }
 *   - `piece` / `victim` are piece chars (case-insensitive; normalized to uppercase).
 *   - `side` is 'red' | 'black'. Any other value -> returns null (defensive).
 *   - `moveNumber` is the 0-based move index supplied by the EffectsManager
 *     (it counts GameBus 'move' events; the 'move' emit precedes the 'capture'
 *     emit for the same move in app.js executeMove).
 *   - `text` is always the canonical event name below, so the popup renderer
 *     can style/localize it. `level` is 'major' | 'minor'.
 *
 * EVENTS (priority order — first match wins; at most one descriptor per capture):
 *   1. FIRST BLOOD  — first capture of the game.                          level 'major'
 *   2. CANNON MASTER — this capture is the side's 3rd CANNON capture of the
 *      game (exactly the 3rd; the 4th+ do not re-fire).                  level 'minor'
 *   3. REVENGE!     — this side captures on the move immediately after the
 *      opponent captured one of theirs (previous capture was by the other
 *      side; a capture is always of an opponent's piece, so the side check
 *      is sufficient).                                                  level 'minor'
 *   4. DOUBLE KILL  — same side captures twice consecutively. Fires pair-wise:
 *      every capture from the 2nd onward of a same-side streak re-fires it
 *      (there is no TRIPLE KILL event in this contract).                 level 'minor'
 *
 * "Immediately after" / "consecutively": when both the previous and current
 * capture carry valid numeric moveNumbers, they must differ by exactly 1
 * (strict: the capture happened on the very next move). When moveNumber is
 * missing or non-numeric, the announcer falls back to capture-adjacency
 * (consecutive capture events). The manager should always supply moveNumber.
 *
 * INTENSITY MAPPING (enforced by the EffectsManager, not here):
 *   Off  -> the manager never calls announceForCapture (guarded in _onCapture),
 *           so no popups are ever produced.
 *   Low  -> only 'major' descriptors are shown (FIRST BLOOD).
 *   Full -> all descriptors are shown ('major' and 'minor').
 *
 * SOUND: popups are SILENT by design — no dedicated sfx, and the announcer
 * never triggers audio. Rationale: each capture cinematic already plays its
 * own phased audio (see EFFECTS_CONFIG), Low intensity is explicitly silent,
 * and no neutral announcement asset exists in the vfx.js sfx map. If a future
 * stinger is wanted, the popup renderer (not this module) should play it.
 *
 * Binding user decisions honored: no trauma shake, no hit-stop, no game-logic
 * changes — this module only observes capture descriptors.
 *
 * EXTENSION (documented, not part of the frozen contract):
 *   window.Announcer._historyLength() -> number of captures logged this game.
 *   Test/introspection hook only; the popup renderer must not depend on it.
 */
(function () {
    'use strict';

    var MAJOR = 'major';
    var MINOR = 'minor';

    var history = []; // per-game capture log: [{ piece, victim, side, moveNumber }]
    var gameId = null;

    function normPiece(p) {
        return (typeof p === 'string' && p.length > 0) ? p.toUpperCase() : '';
    }

    function validSide(s) {
        return s === 'red' || s === 'black';
    }

    function validMoveNumber(n) {
        return typeof n === 'number' && isFinite(n);
    }

    function isImmediatelyAfter(prev, cur) {
        if (validMoveNumber(prev.moveNumber) && validMoveNumber(cur.moveNumber)) {
            return cur.moveNumber === prev.moveNumber + 1;
        }
        // moveNumber unavailable: fall back to capture-adjacency.
        return true;
    }

    function cannonCapturesBy(side) {
        var n = 0;
        for (var i = 0; i < history.length; i++) {
            if (history[i].piece === 'C' && history[i].side === side) n++;
        }
        return n;
    }

    function announceForCapture(args) {
        var a = args || {};
        var piece = normPiece(a.piece);
        var side = a.side;
        if (!validSide(side)) return null;

        var cur = {
            piece: piece,
            victim: normPiece(a.victim),
            side: side,
            moveNumber: a.moveNumber
        };
        var prev = history.length > 0 ? history[history.length - 1] : null;

        var result = null;
        if (!prev) {
            result = { text: 'FIRST BLOOD', level: MAJOR };
        } else if (piece === 'C' && cannonCapturesBy(side) === 2) {
            // This capture IS the side's 3rd cannon capture of the game.
            result = { text: 'CANNON MASTER', level: MINOR };
        } else if (prev.side !== side && isImmediatelyAfter(prev, cur)) {
            result = { text: 'REVENGE!', level: MINOR };
        } else if (prev.side === side && isImmediatelyAfter(prev, cur)) {
            result = { text: 'DOUBLE KILL', level: MINOR };
        }

        // Log every valid capture, announced or not, so streaks stay exact.
        history.push(cur);
        return result;
    }

    function reset(newGameId) {
        history = [];
        gameId = (newGameId === undefined) ? null : newGameId;
    }

    window.Announcer = {
        reset: reset,
        announceForCapture: announceForCapture,
        _historyLength: function () { return history.length; }
    };
})();
