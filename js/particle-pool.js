'use strict';
/**
 * js/particle-pool.js — Fixed-capacity object pool for FX particle slots.
 *
 * Phase 5 (perf): the 2D particle engine in js/vfx.js used to `new FXParticle`
 * on every spawn and rebuild its live-particle array with `.filter()` each
 * frame. This module provides a pre-allocated, fixed-capacity pool so the
 * hot path (spawn → update → draw) performs ZERO allocations after warmup:
 *
 *   const pool = new ParticlePool(capacity,
 *                                 () => new FXParticle(),
 *                                 (slot, opts) => slot.reset(opts));
 *   const p = pool.acquire({ x, y, vx, vy, ... });  // no `new` after warmup
 *   // ... engine updates & draws p ...
 *   pool.release(p);                                // slot back to free list
 *
 * POOL-EXHAUSTION POLICY — "reuse oldest" (this is the documented policy):
 *   When acquire() is called and no free slot exists, the pool does NOT grow
 *   and does NOT throw. Instead it evicts the oldest live slot (the live slot
 *   with the smallest acquisition sequence number), re-initializes it with
 *   the new opts, and hands it back as the newest live slot. Visually the
 *   evicted particle "restarts" as the new one; under sustained overload the
 *   oldest effects are recycled first, which is the least noticeable
 *   artifact. Every eviction is counted in stats().evicted. The oldest-slot
 *   scan is O(live) but runs ONLY on exhaustion — never in the steady state,
 *   where acquire/release are O(1).
 *
 * Slot bookkeeping (all O(1) in the steady state):
 *   - __pool:    owning pool; release() ignores foreign or unknown slots.
 *   - __seq:     acquisition sequence number (oldest live = smallest).
 *   - __liveIdx: index into the live array (swap-remove on release).
 * These fields are written by the pool, never by the particle's reset().
 *
 * stats() -> { capacity, live, free, acquired, released, evicted,
 *              highWater, created }
 *   acquired/released are lifetime counters; highWater is the maximum live
 *   count ever observed; created is the number of factory() calls, which
 *   equals `capacity` after construction. A test can assert `created` never
 *   grows after warmup to prove zero allocation in the hot loop.
 *
 * Load order: this file MUST load before js/vfx.js (which wires the pool up
 * at its own load time). Works in browsers (window.ParticlePool) and in
 * Node (module.exports / globalThis.ParticlePool) for headless tests.
 */
(function (root) {
    class ParticlePool {
        /**
         * @param {number} capacity  Fixed number of pre-allocated slots (> 0).
         * @param {function():object} factory  Creates one fresh slot. Called
         *   exactly `capacity` times during construction — never afterwards.
         * @param {function(object, object):void} resetter  (slot, opts)
         *   re-initializes a slot for reuse; must reset every mutable field.
         * @param {object} [hooks]  Optional { onEvict(slot) } callback fired
         *   (in try/catch) whenever the reuse-oldest policy evicts a slot.
         */
        constructor(capacity, factory, resetter, hooks) {
            if (!Number.isInteger(capacity) || capacity <= 0) {
                throw new Error('ParticlePool: capacity must be a positive integer');
            }
            if (typeof factory !== 'function' || typeof resetter !== 'function') {
                throw new Error('ParticlePool: factory and resetter must be functions');
            }
            this.capacity = capacity;
            this._factory = factory;
            this._resetter = resetter;
            this._hooks = hooks || {};
            this._free = [];   // stack of available slots (LIFO — hot cache lines)
            this._live = [];   // slots currently checked out
            this._acquired = 0;
            this._released = 0;
            this._evicted = 0;
            this._highWater = 0;
            this._created = 0;
            this._seq = 0;
            // Pre-allocate every slot up front: the ONLY allocation this pool
            // ever performs. After this loop, acquire() never calls factory().
            for (let i = 0; i < capacity; i++) {
                const slot = factory();
                if (slot === null || (typeof slot !== 'object' && typeof slot !== 'function')) {
                    throw new Error('ParticlePool: factory must return an object');
                }
                slot.__pool = this;
                slot.__seq = -1;
                slot.__liveIdx = -1;
                this._free.push(slot);
                this._created++;
            }
        }

        /**
         * Check out a slot, re-initialized with `opts`. Never allocates after
         * construction. On exhaustion, reuses the oldest live slot
         * (see the documented policy above).
         */
        acquire(opts) {
            let slot;
            if (this._free.length > 0) {
                slot = this._free.pop();
            } else {
                slot = this._evictOldest();
            }
            this._resetter(slot, opts || {});
            slot.__seq = this._seq++;
            slot.__liveIdx = this._live.length;
            this._live.push(slot);
            this._acquired++;
            if (this._live.length > this._highWater) this._highWater = this._live.length;
            return slot;
        }

        /**
         * Return a slot to the free list. Returns true when the slot was live
         * and is now released; false (no-op) for foreign slots, unknown
         * objects, or double releases — so a stray release can never corrupt
         * the pool or another pool's bookkeeping.
         */
        release(slot) {
            if (!slot || slot.__pool !== this) return false;
            const idx = slot.__liveIdx;
            if (!Number.isInteger(idx) || idx < 0 || idx >= this._live.length || this._live[idx] !== slot) {
                return false; // not currently live (e.g. double release)
            }
            // Swap-remove: O(1), keeps _live densely packed.
            const last = this._live.pop();
            if (last !== slot) {
                this._live[idx] = last;
                last.__liveIdx = idx;
            }
            slot.__liveIdx = -1;
            slot.__seq = -1;
            this._free.push(slot);
            this._released++;
            return true;
        }

        /** Snapshot of pool counters for tests / debugging. */
        stats() {
            return {
                capacity: this.capacity,
                live: this._live.length,
                free: this._free.length,
                acquired: this._acquired,
                released: this._released,
                evicted: this._evicted,
                highWater: this._highWater,
                created: this._created,
            };
        }

        /** Current number of checked-out slots. */
        get liveCount() {
            return this._live.length;
        }

        // Find the oldest live slot (smallest __seq) and unlink it from the
        // live array. O(live); called ONLY when the pool is exhausted.
        _evictOldest() {
            let oldestIdx = 0;
            let oldestSeq = this._live[0].__seq;
            for (let i = 1; i < this._live.length; i++) {
                if (this._live[i].__seq < oldestSeq) {
                    oldestSeq = this._live[i].__seq;
                    oldestIdx = i;
                }
            }
            const slot = this._live[oldestIdx];
            const last = this._live.pop();
            if (last !== slot) {
                this._live[oldestIdx] = last;
                last.__liveIdx = oldestIdx;
            }
            slot.__liveIdx = -1;
            this._evicted++;
            if (typeof this._hooks.onEvict === 'function') {
                try { this._hooks.onEvict(slot); } catch (e) { /* hook must never break acquire */ }
            }
            return slot;
        }
    }

    root.ParticlePool = ParticlePool;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ParticlePool;
    }
})(typeof window !== 'undefined' ? window : globalThis);
