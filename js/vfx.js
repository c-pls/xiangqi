/**
 * AAA Cinematic VFX Engine - Xiangqi Masterpiece Edition
 * - 100% Offline, Zero external CDNs
 * - High-Performance 2D Canvas Particle & Physics Engine on #fxCanvas
 * - Seamlessly coordinated with Three.js 3D Splinters & Iron Bolts on #fxCanvas3D
 * - Gorgeous, bespoke visual animations for all 7 piece types:
 *   1. 🗡️ Advisor: Legendary Anime Katana Slash with glowing crescent blade sweep, razor sparks, and piece split
 *   2. 💥 Cannon: Parabolic ballistic artillery shell with fiery smoke trail, massive detonation fireball & scorch crater
 *   3. 🐎 Horse: L-shaped galloping dust trail, high leap, and meteorite ground stomp with golden shockwave
 *   4. 🏎️ Chariot: Burning wheel friction spark tracks along the lane, hypersonic charge, and 'X' cross-blade laser slash
 *   5. 🐘 Elephant: Diagonal tectonic ground fissure tearing open, seismic crash, and emerald jade shockwave
 *   6. 🔱 Soldier: Kinetic crimson piercing spear beam, impact flash, and red shockwave
 *   7. 👑 General: Imperial gold seal slam with concentric golden ripples and throne blast crater
 *   8. 🔒 Checkmate: 3D Iron Bolt finale (铁门栓 绝杀), royal disintegration, and grand calligraphy banner
 */

// ============================================================================
// 1. AUDIO SUBSYSTEM (Howler HTML5 Audio for 100% Offline file:// Support)
// ============================================================================
if (typeof Howler !== 'undefined' && Howler.volume) {
    Howler.volume(0.42);
}
const sfx = {
    cannon_charge: new Howl({ html5: true, src: ['assets/sounds/cannon_charge.wav'], volume: 0.35, rate: 1.25 }),
    fuse_hiss: new Howl({ html5: true, src: ['assets/sounds/fuse_hiss.wav'], volume: 0.25, rate: 1.25 }),
    cannon_fire: new Howl({ html5: true, src: ['assets/sounds/real_cannon.wav'], volume: 0.42, rate: 1.25 }),
    ball_whistle: new Howl({ html5: true, src: ['assets/sounds/ball_whistle.wav'], volume: 0.35, rate: 1.25 }),
    cannon_impact: new Howl({ html5: true, src: ['assets/sounds/cannon_impact.wav'], volume: 0.42, rate: 1.25 }),
    debris_scatter: new Howl({ html5: true, src: ['assets/sounds/debris_scatter.wav'], volume: 0.30, rate: 1.25 }),
    smoke_hiss: new Howl({ html5: true, src: ['assets/sounds/smoke_hiss.wav'], volume: 0.22, rate: 1.25 }),
    chariot_capture: new Howl({ html5: true, src: ['assets/sounds/chariot_capture.wav'], volume: 0.42, rate: 1.25 }),
    horse_capture: new Howl({ html5: true, src: ['assets/sounds/horse_capture.wav'], volume: 0.42, rate: 1.25 }),
    horse_run: new Howl({ html5: true, src: ['assets/sounds/clean_horse.wav'], volume: 0.38, rate: 1.25 }),
    elephant_capture: new Howl({ html5: true, src: ['assets/sounds/elephant_capture.wav'], volume: 0.42, rate: 1.25 }),
    advisor_capture: new Howl({ html5: true, src: ['assets/sounds/advisor_capture.wav'], volume: 0.42, rate: 1.25 }),
    katana_unsheathe: new Howl({ html5: true, src: ['assets/sounds/clean_sword.wav'], volume: 0.42, rate: 1.25 }),
    soldier_capture: new Howl({ html5: true, src: ['assets/sounds/soldier_capture.wav'], volume: 0.42, rate: 1.25 }),
    general_capture: new Howl({ html5: true, src: ['assets/sounds/general_capture.wav'], volume: 0.45, rate: 1.25 }),
    checkmate: new Howl({ html5: true, src: ['assets/sounds/checkmate.wav'], volume: 0.45, rate: 1.2 }),
    epic_check: new Howl({ html5: true, src: ['assets/sounds/epic_check.wav'], volume: 0.42, rate: 1.25 }),
    epic_gong: new Howl({ html5: true, src: ['assets/sounds/epic_gong.wav'], volume: 0.40, rate: 1.2 }),
    general_check: new Howl({ html5: true, src: ['assets/sounds/general_check.wav'], volume: 0.40, rate: 1.25 }),
    cannon_check: new Howl({ html5: true, src: ['assets/sounds/cannon_check.wav'], volume: 0.40, rate: 1.25 }),
    chariot_check: new Howl({ html5: true, src: ['assets/sounds/chariot_check.wav'], volume: 0.40, rate: 1.25 }),
    horse_check: new Howl({ html5: true, src: ['assets/sounds/horse_check.wav'], volume: 0.40, rate: 1.25 }),
    soldier_check: new Howl({ html5: true, src: ['assets/sounds/soldier_check.wav'], volume: 0.40, rate: 1.25 }),
    flying_general_check: new Howl({ html5: true, src: ['assets/sounds/flying_general_check.wav'], volume: 0.40, rate: 1.25 })
};

function playSfx(name) {
    if (window.soundFx && window.soundFx.enabled === false) return;
    if (sfx[name] && sfx[name].state() !== 'unloaded') {
        try {
            const id = sfx[name].play();
            sfx[name].rate(1.25, id);
        } catch(e) {}
    }
}

function stopSfx(name) {
    if (sfx[name] && sfx[name].state() !== 'unloaded') {
        try {
            sfx[name].stop();
        } catch(e) {}
    }
}

// ============================================================================
// Phase 5 (W2): effect-theme color lookup.
// _themeColor(key, fallback) resolves a semantic palette role from the active
// window.EffectThemes theme, falling back to the authored color when themes
// are absent or the role is undefined (the default 'ink' theme keeps its
// palette empty on purpose, so every call below resolves to its fallback and
// the shipped look is preserved bit-for-bit). See js/effect-themes.js for the
// full theme consumption contract.
// Colors resolve at particle-CREATION time only — never in the per-frame
// render path — so the pooling hot path is untouched.
// ============================================================================
function _themeColor(key, fallback) {
    try {
        var T = (typeof window !== 'undefined') ? window.EffectThemes : null;
        var v = (T && typeof T.palette === 'function') ? T.palette()[key] : undefined;
        if (v === undefined || v === null || v === '') return fallback;
        if (Array.isArray(fallback) && !Array.isArray(v)) return fallback;
        return v;
    } catch (e) {
        return fallback;
    }
}

// ============================================================================
// 2. CAMERA TRAUMA & HIT-STOP SYSTEM
// ============================================================================
// Screen shake and trauma completely disabled per user preference
const camera = { trauma: 0 };
function addTrauma(amount) {
    // Screen shake disabled
}
function hitStop(durationMs) {
    // Freezing disabled to ensure buttery 60fps responsiveness
}

// ============================================================================
// 3. REALISTIC 2D CANVAS PARTICLE CLASS
// ============================================================================
class FXParticle {
    constructor(opts) {
        this.reset(opts || {});
    }

    // Re-initialize this particle slot for reuse from the particle pool
    // (Phase 5 perf). Field-for-field identical to what the constructor
    // used to do — keep in sync. Does NOT touch the pool bookkeeping
    // fields (__pool/__seq/__liveIdx), which the pool itself manages.
    reset(opts) {
        this.x = opts.x || 0;
        this.y = opts.y || 0;
        this.vx = opts.vx || 0;
        this.vy = opts.vy || 0;
        this.radius = opts.radius || 5;
        this.growth = opts.growth || 0;
        this.life = opts.life || 1;
        this.maxLife = this.life;
        this.color = opts.color || '#fff';
        this.endColor = opts.endColor || opts.color;
        this.alpha = opts.alpha !== undefined ? opts.alpha : 1;
        this.drag = opts.drag || 0.96;
        this.gravity = opts.gravity || 0;
        this.type = opts.type || 'spark'; // 'spark'|'fire'|'smoke'|'shockwave'|'flash'|'scorch'|'blade_arc'|'laser_beam'
        this.rotation = opts.rotation !== undefined ? opts.rotation : Math.random() * Math.PI * 2;
        this.vRot = opts.vRot !== undefined ? opts.vRot : (opts.rotation !== undefined ? 0 : (Math.random() - 0.5) * 0.1);
        this.data = opts.data || {};
    }

    update(dt) {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= this.drag;
        this.vy = this.vy * this.drag + this.gravity;
        this.radius += this.growth;
        this.rotation += this.vRot;
        this.life -= dt;
        return this.life > 0;
    }

    // gradCache: per-engine gradient cache (Phase 5 perf). Optional — when
    // omitted, gradients are built per frame as before.
    draw(ctx, gradCache) {
        const progress = 1 - (this.life / this.maxLife);
        const currentAlpha = Math.max(0, this.alpha * (1 - progress));

        ctx.save();
        ctx.translate(this.x, this.y);

        if (this.type === 'spark') {
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = this.color;
            ctx.globalAlpha = currentAlpha;
            const size = Math.max(1, this.radius * (1 - progress * 0.6));
            ctx.beginPath();
            ctx.arc(0, 0, size, 0, Math.PI * 2);
            ctx.fill();

            // Luminous spark glow halo
            ctx.fillStyle = this.endColor || '#ff8800';
            ctx.globalAlpha = currentAlpha * 0.45;
            ctx.beginPath();
            ctx.arc(0, 0, size * 2.4, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.type === 'fire') {
            ctx.globalCompositeOperation = 'lighter';
            ctx.rotate(this.rotation);
            const r = Math.max(1, this.radius);
            const rb = particleSizeBucket(r);
            // Cached gradient (built once per size bucket at full alpha); the
            // per-frame fade is applied via globalAlpha, which multiplies
            // every stop's alpha uniformly — pixel-identical to baking
            // currentAlpha into the stops.
            const grad = particleGradient(ctx, gradCache, 'fire|' + rb, (c) => {
                const g = c.createRadialGradient(0, 0, 0, 0, 0, rb);
                g.addColorStop(0, 'rgba(255, 255, 240, 1)');
                g.addColorStop(0.25, 'rgba(255, 200, 50, 0.95)');
                g.addColorStop(0.65, 'rgba(230, 80, 10, 0.65)');
                g.addColorStop(1, 'rgba(180, 20, 0, 0)');
                return g;
            });
            ctx.globalAlpha = currentAlpha;
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, rb, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.type === 'smoke') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.rotate(this.rotation);
            const r = Math.max(1, this.radius);
            const rb = particleSizeBucket(r);
            // Smoke gray drifts with progress; quantize into 16 steps so the
            // gradient stays cacheable. Fade via globalAlpha (exact, as above).
            const grayStep = Math.min(15, Math.floor(progress * 16));
            const gray = Math.floor(45 + (grayStep / 15) * 55);
            const grad = particleGradient(ctx, gradCache, 'smoke|' + rb + '|' + gray, (c) => {
                const g = c.createRadialGradient(0, 0, 0, 0, 0, rb);
                g.addColorStop(0, `rgba(${gray}, ${gray}, ${gray}, 0.55)`);
                g.addColorStop(0.6, `rgba(${gray - 10}, ${gray - 10}, ${gray - 10}, 0.3)`);
                g.addColorStop(1, `rgba(${gray - 20}, ${gray - 20}, ${gray - 20}, 0)`);
                return g;
            });
            ctx.globalAlpha = currentAlpha;
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, rb, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.type === 'shockwave') {
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = this.color;
            ctx.lineWidth = Math.max(1, (1 - progress) * (this.data.strokeWidth || 6));
            ctx.globalAlpha = currentAlpha * 0.9;
            ctx.beginPath();
            ctx.arc(0, 0, Math.max(1, this.radius), 0, Math.PI * 2);
            ctx.stroke();
        } else if (this.type === 'flash') {
            ctx.globalCompositeOperation = 'lighter';
            const r = Math.max(1, this.radius * (1 + progress * 0.6));
            const rb = particleSizeBucket(r);
            // The mid stop is full-alpha by design (white-hot core that does
            // NOT fade with progress), so alpha is part of the cache key,
            // quantized to 16 steps. No globalAlpha — alpha is baked in.
            const alphaStep = Math.min(15, Math.round(currentAlpha * 15));
            const a = (alphaStep / 15).toFixed(3);
            const c = this.color || '#ffffff';
            const grad = particleGradient(ctx, gradCache, 'flash|' + c + '|' + rb + '|' + alphaStep, (c2) => {
                const g = c2.createRadialGradient(0, 0, 0, 0, 0, rb);
                g.addColorStop(0, `rgba(255, 255, 255, ${a})`);
                g.addColorStop(0.35, c);
                g.addColorStop(1, 'rgba(0, 0, 0, 0)');
                return g;
            });
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, rb, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.type === 'scorch') {
            ctx.globalCompositeOperation = 'multiply';
            ctx.globalAlpha = currentAlpha * 0.75;
            const rb = particleSizeBucket(Math.max(1, this.radius));
            const grad = particleGradient(ctx, gradCache, 'scorch|' + rb, (c) => {
                const g = c.createRadialGradient(0, 0, 0, 0, 0, rb);
                g.addColorStop(0, 'rgba(15, 7, 2, 0.95)');
                g.addColorStop(0.5, 'rgba(40, 18, 5, 0.65)');
                g.addColorStop(0.85, 'rgba(80, 35, 10, 0.25)');
                g.addColorStop(1, 'rgba(80, 35, 10, 0)');
                return g;
            });
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, rb, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.type === 'blade_arc') {
            // 🗡️ Colossal Glowing Katana / Cross-Cut Arc Sweep
            ctx.globalCompositeOperation = 'lighter';
            ctx.rotate(this.rotation);
            const arcRadius = this.radius * (1.0 + progress * 0.35);
            const startAng = -Math.PI * 0.6;
            const endAng = Math.PI * 0.6;
            const strokeW = this.data.strokeWidth || 20;

            // Outer vibrant aura
            ctx.strokeStyle = this.color || '#00f5ff';
            ctx.lineWidth = Math.max(2, (1 - progress) * strokeW);
            ctx.globalAlpha = currentAlpha * 0.9;
            ctx.beginPath();
            ctx.arc(0, 0, arcRadius, startAng, endAng);
            ctx.stroke();

            // Inner white-hot cutting edge
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(1, (1 - progress) * (strokeW * 0.38));
            ctx.globalAlpha = currentAlpha;
            ctx.beginPath();
            ctx.arc(0, 0, arcRadius, startAng, endAng);
            ctx.stroke();

            // Blade slash kinetic speed lines
            ctx.strokeStyle = 'rgba(255, 255, 255, ' + (currentAlpha * 0.9) + ')';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(-arcRadius * 1.35, 0);
            ctx.lineTo(arcRadius * 1.35, 0);
            ctx.stroke();
        } else if (this.type === 'beam') {
            // ⚡ Piercing Kinetic Laser / Diagonal Slicing Beam
            ctx.globalCompositeOperation = 'lighter';
            ctx.rotate(this.rotation);
            const len = this.data.length || 220;
            const strokeW = Math.max(1, (1 - progress * 0.45) * (this.data.strokeWidth || 8));

            // Outer energy aura
            ctx.strokeStyle = this.color || '#00f5ff';
            ctx.lineWidth = strokeW * 2.4;
            ctx.globalAlpha = currentAlpha * 0.65;
            ctx.beginPath();
            ctx.moveTo(-len / 2, 0);
            ctx.lineTo(len / 2, 0);
            ctx.stroke();

            // Inner razor core
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(1, strokeW * 0.6);
            ctx.globalAlpha = currentAlpha;
            ctx.beginPath();
            ctx.moveTo(-len / 2, 0);
            ctx.lineTo(len / 2, 0);
            ctx.stroke();
        } else if (this.type === 'laser_beam') {
            // Sleek Glowing Laser Targeting Line for Check Standoff
            ctx.globalCompositeOperation = 'lighter';
            const dx = (this.data.targetX || 0) - this.x;
            const dy = (this.data.targetY || 0) - this.y;
            const angle = Math.atan2(dy, dx);
            const length = Math.hypot(dx, dy);

            ctx.rotate(angle);
            // Outer glow
            ctx.strokeStyle = this.color || '#ff0033';
            ctx.lineWidth = Math.max(1, (1 - progress * 0.3) * 8);
            ctx.globalAlpha = currentAlpha * 0.6;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(length, 0);
            ctx.stroke();

            // Inner razor core
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(1, (1 - progress * 0.3) * 2.2);
            ctx.globalAlpha = currentAlpha * 0.95;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(length, 0);
            ctx.stroke();

            // End reticle dot
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(length, 0, 4 + Math.sin(progress * Math.PI * 4) * 2, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}

// ============================================================================
// 3b. PARTICLE POOL WIRING (Phase 5 perf)
// ============================================================================
// The 2D engine used to allocate one FXParticle object on every spawn and
// rebuild its live array with `.filter()` each frame. All particle allocation
// now flows through this fixed-capacity pool (see js/particle-pool.js — it
// MUST load BEFORE this file):
//   - FX2DEngine.addParticle(opts) -> pool.acquire(opts)   (zero `new`)
//   - FX2DEngine.update(dt)        -> in-place swap-remove + pool.release(p)
//   - FX2DEngine.clear()           -> releases every live particle
// If js/particle-pool.js failed to load, the engine falls back to direct
// allocation (correct, just slower) — the game never breaks.
const PARTICLE_POOL_CAPACITY = 4096;
const PARTICLE_GRAD_CACHE_MAX = 256;

function particleSizeBucket(r) {
    return Math.max(4, Math.round(r / 4) * 4);
}

// Per-engine gradient cache: key = type|color|size-bucket[|extra].
// CanvasGradient objects are bound to the ctx that created them, so the
// cache is dropped whenever a different ctx is seen, and cleared (rarely) if
// it ever exceeds PARTICLE_GRAD_CACHE_MAX entries. It is NEVER invalidated
// per-particle-per-frame.
function particleGradient(ctx, cache, key, build) {
    if (!cache) return build(ctx);
    if (cache.ctx !== ctx) {
        cache.map.clear();
        cache.ctx = ctx;
    }
    let g = cache.map.get(key);
    if (!g) {
        if (cache.map.size >= PARTICLE_GRAD_CACHE_MAX) cache.map.clear();
        g = build(ctx);
        cache.map.set(key, g);
    }
    return g;
}

let particlePool = null;
if (typeof ParticlePool !== 'undefined') {
    // Pre-allocates PARTICLE_POOL_CAPACITY slots up front; the factory `new`
    // below is the ONLY particle allocation outside the (cold) fallback path.
    particlePool = new ParticlePool(
        PARTICLE_POOL_CAPACITY,
        () => new FXParticle(),
        (slot, opts) => slot.reset(opts)
    );
}

function poolAcquireParticle(opts) {
    if (particlePool) return particlePool.acquire(opts);
    return new FXParticle(opts); // cold fallback: pool script missing
}

function poolReleaseParticle(p) {
    if (particlePool) particlePool.release(p);
}

// Debug/test handle (read-only usage, e.g. pool.stats()).
if (typeof window !== 'undefined') window.__particlePool = particlePool;

// ============================================================================
// 4. BALLISTIC ARTILLERY SHELL (Parabolic Rocket Flight)
// ============================================================================
class ArtilleryShell {
    constructor(startX, startY, targetX, targetY, durationMs, onImpact, fxEngine) {
        this.startX = startX;
        this.startY = startY;
        this.targetX = targetX;
        this.targetY = targetY;
        this.duration = durationMs / 1000;
        this.elapsed = 0;
        this.onImpact = onImpact;
        this.fx = fxEngine;
        this.alive = true;

        const dist = Math.hypot(targetX - startX, targetY - startY);
        this.arcHeight = Math.min(180, Math.max(45, dist * 0.28));
        this.currentX = startX;
        this.currentY = startY;
        this.prevX = startX;
        this.prevY = startY;
    }

    update(dt) {
        if (!this.alive) return false;
        this.elapsed += dt;
        const t = Math.min(1, this.elapsed / this.duration);

        this.prevX = this.currentX;
        this.prevY = this.currentY;

        const straightX = this.startX + (this.targetX - this.startX) * t;
        const straightY = this.startY + (this.targetY - this.startY) * t;
        const arcY = -Math.sin(t * Math.PI) * this.arcHeight;

        this.currentX = straightX;
        this.currentY = straightY + arcY;

        const speed = Math.hypot(this.currentX - this.prevX, this.currentY - this.prevY);
        const angle = Math.atan2(this.currentY - this.prevY, this.currentX - this.prevX);

        // Spawn fiery smoke & sparks trail
        this.fx.addParticle({
            x: this.currentX - Math.cos(angle) * 8 + (Math.random() - 0.5) * 4,
            y: this.currentY - Math.sin(angle) * 8 + (Math.random() - 0.5) * 4,
            vx: -Math.cos(angle) * (speed * 0.25) + (Math.random() - 0.5) * 1.5,
            vy: -Math.sin(angle) * (speed * 0.25) + (Math.random() - 0.5) * 1.5,
            radius: 8 + Math.random() * 5,
            growth: 0.2,
            life: 0.18 + Math.random() * 0.12,
            type: 'fire',
            alpha: 0.95
        });

        if (Math.random() < 0.8) {
            this.fx.addParticle({
                x: this.currentX - Math.cos(angle) * 14 + (Math.random() - 0.5) * 6,
                y: this.currentY - Math.sin(angle) * 14 + (Math.random() - 0.5) * 6,
                vx: -Math.cos(angle) * 0.8 + (Math.random() - 0.5) * 0.8,
                vy: -Math.sin(angle) * 0.8 - 0.5 + (Math.random() - 0.5) * 0.8,
                radius: 7 + Math.random() * 7,
                growth: 0.6,
                life: 0.45 + Math.random() * 0.25,
                type: 'smoke',
                alpha: 0.65
            });
        }

        // Flying ember sparks
        for (let i = 0; i < 2; i++) {
            this.fx.addParticle({
                x: this.currentX,
                y: this.currentY,
                vx: (Math.random() - 0.5) * 4 - Math.cos(angle) * 2,
                vy: (Math.random() - 0.5) * 4 - Math.sin(angle) * 2,
                radius: 2.2 + Math.random() * 1.5,
                life: 0.22 + Math.random() * 0.15,
                type: 'spark',
                color: '#fff5b0'
            });
        }

        if (t >= 1) {
            this.alive = false;
            if (this.onImpact) this.onImpact(this.targetX, this.targetY);
            return false;
        }
        return true;
    }

    draw(ctx) {
        if (!this.alive) return;
        ctx.save();
        ctx.translate(this.currentX, this.currentY);
        const angle = Math.atan2(this.currentY - this.prevY, this.currentX - this.prevX);
        ctx.rotate(angle);

        // Rocket exhaust jet flame
        ctx.globalCompositeOperation = 'lighter';
        const thrustGrad = ctx.createLinearGradient(-26, 0, 0, 0);
        thrustGrad.addColorStop(0, 'rgba(255, 50, 0, 0)');
        thrustGrad.addColorStop(0.5, 'rgba(255, 150, 20, 0.85)');
        thrustGrad.addColorStop(1, '#ffffff');
        ctx.fillStyle = thrustGrad;
        ctx.beginPath();
        ctx.moveTo(-26, 0);
        ctx.lineTo(-6, -5);
        ctx.lineTo(0, 0);
        ctx.lineTo(-6, 5);
        ctx.closePath();
        ctx.fill();

        // White-hot projectile halo
        const grad = ctx.createRadialGradient(2, 0, 0, 2, 0, 15);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.35, '#ffea78');
        grad.addColorStop(0.75, '#ff5500');
        grad.addColorStop(1, 'rgba(200, 20, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(2, 0, 15, 0, Math.PI * 2);
        ctx.fill();

        // Incandescent bullet body
        ctx.fillStyle = '#fffdf0';
        ctx.beginPath();
        ctx.ellipse(2, 0, 9, 5, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

// ============================================================================
// 5. HIGH-PERFORMANCE 2D CANVAS FX ENGINE (#fxCanvas)
// ============================================================================
class FX2DEngine {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.particles = [];
        this.projectiles = [];
        this._gradCache = { ctx: null, map: new Map() }; // Phase 5: gradient cache
        this.lastTime = performance.now();
        this.running = false;
        this.dpr = window.devicePixelRatio || 1;
        this.init();
    }

    init() {
        this.canvas = document.getElementById('fxCanvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('resize', () => this.resize());
        }
        if (window.ResizeObserver) {
            const boardOuter = document.getElementById('boardOuter');
            if (boardOuter) new ResizeObserver(() => this.resize()).observe(boardOuter);
        }
        this.start();
    }

    resize() {
        if (!this.canvas) return;
        const boardOuter = document.getElementById('boardOuter');
        const rect = boardOuter ? boardOuter.getBoundingClientRect() : (this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : this.canvas.getBoundingClientRect());
        this.width = rect.width || (boardOuter ? boardOuter.clientWidth : 400) || 400;
        this.height = rect.height || (boardOuter ? boardOuter.clientHeight : 450) || 450;
        this.dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
        if (this.ctx && typeof this.ctx.setTransform === 'function') {
            this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.lastTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const loop = (now) => {
            if (!this.running) return;
            const current = (typeof now === 'number' && !isNaN(now)) ? now : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
            const dt = Math.min(0.06, Math.max(0, (current - (this.lastTime || current)) / 1000));
            this.lastTime = current;
            this.update(dt);
            this.draw();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    addParticle(opts) {
        // Phase 5: `opts` is a particle options object; the slot comes from
        // the pre-allocated pool (no `new` in the hot path). A
        // hand-constructed FXParticle is still tolerated: its fields are
        // re-applied onto a pooled slot via reset() so the pool owns every
        // live particle.
        let p;
        if (opts instanceof FXParticle) {
            p = poolAcquireParticle({});
            p.reset(opts); // an FXParticle's fields are a valid opts object
            if (opts.maxLife !== undefined) p.maxLife = opts.maxLife;
        } else {
            p = poolAcquireParticle(opts);
        }
        this.particles.push(p);
        if (!this.running) this.start();
    }

    clear() {
        // Phase 5: return every live particle to the pool (no garbage).
        // Array identity is preserved (in-place truncation).
        const ps = this.particles;
        for (let i = 0; i < ps.length; i++) poolReleaseParticle(ps[i]);
        ps.length = 0;
        this.projectiles.length = 0;
        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.width || 400, this.height || 450);
            this.wasDirty = false;
        }
        this.running = false;
    }

    update(dt) {
        // Phase 5: in-place swap-remove compaction — no fresh array per frame.
        // Dead particles are returned to the pool.
        const ps = this.particles;
        let w = 0;
        for (let i = 0; i < ps.length; i++) {
            const p = ps[i];
            if (p.update(dt)) {
                ps[w++] = p;
            } else {
                poolReleaseParticle(p);
            }
        }
        ps.length = w;
        const pr = this.projectiles;
        let w2 = 0;
        for (let i = 0; i < pr.length; i++) {
            if (pr[i].update(dt)) pr[w2++] = pr[i];
        }
        pr.length = w2;
    }

    draw() {
        if (!this.ctx || !this.canvas) return;
        const hasItems = this.particles.length > 0 || this.projectiles.length > 0;
        if (!hasItems) {
            if (this.wasDirty) {
                this.ctx.clearRect(0, 0, this.width || 400, this.height || 450);
                this.wasDirty = false;
            }
            return;
        }
        this.wasDirty = true;
        this.ctx.clearRect(0, 0, this.width || 400, this.height || 450);

        for (let i = 0; i < this.particles.length; i++) {
            this.particles[i].draw(this.ctx, this._gradCache);
        }
        for (let i = 0; i < this.projectiles.length; i++) {
            this.projectiles[i].draw(this.ctx);
        }
    }

    /**
     * Pixel-perfect board center coordinates for (row r, col c)
     */
    getCoord(r, c) {
        const boardOuter = document.getElementById('boardOuter');
        const boardLayer = document.getElementById('boardLayer') || boardOuter;
        if (!boardLayer || !boardOuter) return { x: 0, y: 0 };

        const bRect = boardOuter.getBoundingClientRect();
        const lRect = boardLayer.getBoundingClientRect();
        const offsetX = lRect.left - bRect.left;
        const offsetY = lRect.top - bRect.top;

        const x = offsetX + ((5 + c * 11.25) / 100) * lRect.width;
        const y = offsetY + ((4.444 + r * 10) / 100) * lRect.height;
        return { x, y };
    }

    // ========================================================================
    // 🗡️ ADVISOR: LEGENDARY ANIME KATANA SLASH
    // ========================================================================
    playKatanaSlash(fromPos, toPos, onImpact) {
        const toCoord = this.getCoord(toPos.r, toPos.c);
        const fromCoord = this.getCoord(fromPos.r, fromPos.c);
        const angle = Math.atan2(toCoord.y - fromCoord.y, toCoord.x - fromCoord.x);

        // 1. Blinding Cyan/White Radial Flash (Radius 90px)
        this.addParticle({
            x: toCoord.x,
            y: toCoord.y,
            radius: 90,
            growth: 2.2,
            life: 0.24,
            type: 'flash',
            color: '#00ffff',
            alpha: 1.0
        });

        // 2. Colossal Crescent Katana Arc (Radius 120px, Sweeping across the screen!)
        this.addParticle({
            x: toCoord.x,
            y: toCoord.y,
            radius: 120,
            growth: 0.7,
            life: 0.55,
            type: 'blade_arc',
            color: '#00f5ff',
            rotation: angle + Math.PI / 4,
            alpha: 1.0,
            data: { strokeWidth: 24 }
        });

        // 3. Counter-Slash Crescent Arc ('X' Cleave, Radius 105px)
        this.addParticle({
            x: toCoord.x,
            y: toCoord.y,
            radius: 105,
            growth: 0.5,
            life: 0.48,
            type: 'blade_arc',
            color: '#38bdf8',
            rotation: angle - Math.PI / 4,
            alpha: 0.9,
            data: { strokeWidth: 18 }
        });

        // 4. Screen-Wide Diagonal Slice Streak (Blade Beam cutting right through)
        this.addParticle({
            x: toCoord.x,
            y: toCoord.y,
            life: 0.46,
            type: 'beam',
            color: '#00f5ff',
            rotation: angle + Math.PI / 4,
            data: { length: 280, strokeWidth: 7 },
            alpha: 1.0
        });

        // 5. Heavy Expanding Silver Shockwave Ring
        this.addParticle({
            x: toCoord.x,
            y: toCoord.y,
            radius: 15,
            growth: 7.5,
            life: 0.42,
            type: 'shockwave',
            color: '#e0f2fe',
            data: { strokeWidth: 7 },
            alpha: 1.0
        });

        // 6. 60+ Incandescent Razor Sparks Bursting Along Slice
        for (let i = 0; i < 60; i++) {
            const baseAngle = (angle + Math.PI / 4) + (Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2);
            const sparkAngle = baseAngle + (Math.random() - 0.5) * 0.8;
            const spd = 5 + Math.random() * 14;
            this.addParticle({
                x: toCoord.x + (Math.random() - 0.5) * 16,
                y: toCoord.y + (Math.random() - 0.5) * 16,
                vx: Math.cos(sparkAngle) * spd,
                vy: Math.sin(sparkAngle) * spd,
                drag: 0.92,
                radius: 2.8 + Math.random() * 2.2,
                life: 0.42 + Math.random() * 0.3,
                type: 'spark',
                color: Math.random() < 0.6 ? '#ffffff' : '#38bdf8',
                endColor: '#0284c7'
            });
        }

        if (onImpact) onImpact(toCoord.x, toCoord.y);
    }

    // ========================================================================
    // 💥 CANNON: HEAVY ARTILLERY BALLISTIC BARRAGE
    // ========================================================================
    playCannonBlast(fromPos, toPos, onImpact) {
        const fromCoord = this.getCoord(fromPos.r, fromPos.c);
        const toCoord = this.getCoord(toPos.r, toPos.c);
        const angle = Math.atan2(toCoord.y - fromCoord.y, toCoord.x - fromCoord.x);

        // 1. Swirling charge embers (200ms)
        for (let i = 0; i < 20; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = 25 + Math.random() * 20;
            this.addParticle({
                x: fromCoord.x + Math.cos(a) * d,
                y: fromCoord.y + Math.sin(a) * d,
                vx: -Math.cos(a) * 3,
                vy: -Math.sin(a) * 3,
                radius: 2.5,
                life: 0.22,
                type: 'spark',
                color: _themeColor('particleFire', '#ffea60')
            });
        }

        setTimeout(() => {
            // 2. Muzzle Flash & Smoke Rings
            this.addParticle({
                x: fromCoord.x + Math.cos(angle) * 12,
                y: fromCoord.y + Math.sin(angle) * 12,
                radius: 36,
                growth: 1.5,
                life: 0.12,
                type: 'flash',
                alpha: 1
            });

            for (let i = 0; i < 8; i++) {
                const spd = 2 + Math.random() * 4;
                this.addParticle({
                    x: fromCoord.x + Math.cos(angle) * 14,
                    y: fromCoord.y + Math.sin(angle) * 14,
                    vx: Math.cos(angle + (Math.random() - 0.5) * 0.9) * spd,
                    vy: Math.sin(angle + (Math.random() - 0.5) * 0.9) * spd - 0.5,
                    radius: 12 + Math.random() * 10,
                    growth: 1.1,
                    life: 0.5 + Math.random() * 0.25,
                    type: 'smoke',
                    alpha: 0.7
                });
            }

            // 3. Launch Ballistic Shell
            const durationMs = 160;
            const shell = new ArtilleryShell(
                fromCoord.x,
                fromCoord.y,
                toCoord.x,
                toCoord.y,
                durationMs,
                (hitX, hitY) => {
                    // 4. Cataclysmic Detonation Explosion
                    // Ground Scorch Crater
                    this.addParticle({
                        x: hitX,
                        y: hitY,
                        radius: 38,
                        life: 3.5,
                        type: 'scorch',
                        alpha: 0.9
                    });

                    // Blinding Core White Flash
                    this.addParticle({
                        x: hitX,
                        y: hitY,
                        radius: 52,
                        growth: 2.4,
                        life: 0.15,
                        type: 'flash',
                        alpha: 1
                    });

                    // Primary Spherical Fireball Detonation
                    for (let j = 0; j < 26; j++) {
                        const a = Math.random() * Math.PI * 2;
                        const spd = 2.5 + Math.random() * 7;
                        this.addParticle({
                            x: hitX,
                            y: hitY,
                            vx: Math.cos(a) * spd,
                            vy: Math.sin(a) * spd,
                            radius: 18 + Math.random() * 14,
                            growth: 0.8,
                            life: 0.32 + Math.random() * 0.18,
                            type: 'fire',
                            alpha: 0.95
                        });
                    }

                    // Violent Shrapnel & Fiery Spark Burst
                    for (let j = 0; j < 55; j++) {
                        const a = Math.random() * Math.PI * 2;
                        const spd = 3 + Math.random() * 12;
                        this.addParticle({
                            x: hitX,
                            y: hitY,
                            vx: Math.cos(a) * spd,
                            vy: Math.sin(a) * spd,
                            gravity: 0.18,
                            drag: 0.94,
                            radius: 2.5 + Math.random() * 2.2,
                            life: 0.38 + Math.random() * 0.35,
                            type: 'spark',
                            color: _themeColor('particleFire', Math.random() < 0.6 ? '#ffffff' : '#ffcc00')
                        });
                    }

                    // Huge Volumetric Rising Smoke Cloud
                    for (let j = 0; j < 18; j++) {
                        const a = Math.random() * Math.PI * 2;
                        const spd = 1.5 + Math.random() * 4;
                        this.addParticle({
                            x: hitX + Math.cos(a) * 10,
                            y: hitY + Math.sin(a) * 10,
                            vx: Math.cos(a) * spd,
                            vy: Math.sin(a) * spd - 1.2,
                            radius: 20 + Math.random() * 16,
                            growth: 1.4,
                            life: 0.65 + Math.random() * 0.35,
                            type: 'smoke',
                            alpha: 0.75
                        });
                    }

                    // Double Expanding Shockwave Rings
                    this.addParticle({
                        x: hitX,
                        y: hitY,
                        radius: 15,
                        growth: 7.0,
                        life: 0.32,
                        type: 'shockwave',
                        color: '#ffcc33',
                        data: { strokeWidth: 7 },
                        alpha: 1
                    });

                    if (onImpact) onImpact(hitX, hitY);
                },
                this
            );
            this.projectiles.push(shell);
            if (!this.running) this.start();
        }, 80);
    }

    // ========================================================================
    // 🐎 HORSE: COSMIC WARHORSE L-HOP & METEORITE STOMP (Vibrant Violet / Magenta)
    // ========================================================================
    playHorseStomp(fromPos, toPos, onImpact) {
        const toCoord = this.getCoord(toPos.r, toPos.c);

        // 1. Blinding Stomp Flash (Neon Magenta / Electric Violet, Radius 90px)
        this.addParticle({
            x: toCoord.x,
            y: toCoord.y,
            radius: 90,
            growth: 2.2,
            life: 0.25,
            type: 'flash',
            color: '#d946ef',
            alpha: 1.0
        });

        // 2. Heavy Ground Shockwave Ring (Cosmic Violet, Expanding 16 to 95px!)
        this.addParticle({
            x: toCoord.x,
            y: toCoord.y,
            radius: 16,
            growth: 7.2,
            life: 0.48,
            type: 'shockwave',
            color: '#a855f7',
            data: { strokeWidth: 8 },
            alpha: 1.0
        });

        // 3. Secondary Outer Shockwave (Neon Lavender)
        setTimeout(() => {
            this.addParticle({
                x: toCoord.x,
                y: toCoord.y,
                radius: 22,
                growth: 6.2,
                life: 0.4,
                type: 'shockwave',
                color: '#f0abfc',
                data: { strokeWidth: 5 },
                alpha: 0.85
            });
        }, 70);

        // 4. Ground Stomp Crater Scorch
        this.addParticle({
            x: toCoord.x,
            y: toCoord.y,
            radius: 40,
            life: 2.0,
            type: 'scorch',
            alpha: 0.85
        });

        // 5. 55+ Cosmic Lightning Sparks (Starlight White & Amethyst Violet)
        for (let i = 0; i < 55; i++) {
            const a = Math.random() * Math.PI * 2;
            const spd = 4 + Math.random() * 12;
            this.addParticle({
                x: toCoord.x,
                y: toCoord.y,
                vx: Math.cos(a) * spd,
                vy: Math.sin(a) * spd,
                drag: 0.93,
                radius: 2.6 + Math.random() * 2.2,
                life: 0.45 + Math.random() * 0.25,
                type: 'spark',
                color: Math.random() < 0.6 ? '#ffffff' : '#f0abfc',
                endColor: '#9333ea'
            });
        }

        // 6. Expanding Heavy Volumetric Dust Cloud (24 smoke puffs)
        for (let i = 0; i < 24; i++) {
            const a = Math.random() * Math.PI * 2;
            const spd = 2 + Math.random() * 5;
            this.addParticle({
                x: toCoord.x + Math.cos(a) * 12,
                y: toCoord.y + Math.sin(a) * 12,
                vx: Math.cos(a) * spd,
                vy: Math.sin(a) * spd - 1.0,
                radius: 18 + Math.random() * 14,
                growth: 1.2,
                life: 0.65 + Math.random() * 0.3,
                type: 'smoke',
                alpha: 0.75
            });
        }

        if (onImpact) onImpact(toCoord.x, toCoord.y);
    }

    // ========================================================================
    // 🏎️ CHARIOT: IRON CHARIOT SLOW THUNDER CHARGE & DIRECTIONAL RED KATANA
    // ========================================================================
    playChariotCharge(fromPos, toPos, onImpact) {
        const fromCoord = this.getCoord(fromPos.r, fromPos.c);
        const toCoord = this.getCoord(toPos.r, toPos.c);
        const dr = toPos.r - fromPos.r;
        const dc = toPos.c - fromPos.c;
        const isVertical = Math.abs(dr) > Math.abs(dc);
        const moveAngle = isVertical ? (dr > 0 ? Math.PI / 2 : -Math.PI / 2) : (dc > 0 ? 0 : Math.PI);
        const dist = Math.hypot(toCoord.x - fromCoord.x, toCoord.y - fromCoord.y);
        const chargeDuration = 600; // Slower, heavier cinematic charge!

        // 1. Dual Flaming Ruby Wheel Tracks with churning smoke & red sparks
        const steps = Math.max(16, Math.floor(dist / 14));
        const perpX = -Math.sin(moveAngle) * 12;
        const perpY = Math.cos(moveAngle) * 12;

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const px = fromCoord.x + (toCoord.x - fromCoord.x) * t;
            const py = fromCoord.y + (toCoord.y - fromCoord.y) * t;
            setTimeout(() => {
                [-1, 1].forEach(side => {
                    // Flaming red wheel ruts
                    this.addParticle({
                        x: px + perpX * side + (Math.random() - 0.5) * 4,
                        y: py + perpY * side + (Math.random() - 0.5) * 4,
                        vx: (Math.random() - 0.5) * 2 - Math.cos(moveAngle) * 1.5,
                        vy: (Math.random() - 0.5) * 2 - Math.sin(moveAngle) * 1.5,
                        radius: 4.5 + Math.random() * 2.5,
                        growth: -0.05,
                        life: 0.55,
                        type: 'fire',
                        alpha: 0.95
                    });
                    // Churning tire smoke
                    this.addParticle({
                        x: px + perpX * side,
                        y: py + perpY * side,
                        radius: 9 + Math.random() * 7,
                        growth: 0.6,
                        life: 0.5,
                        type: 'smoke',
                        alpha: 0.55
                    });
                    // Red wheel friction sparks
                    this.addParticle({
                        x: px + perpX * side,
                        y: py + perpY * side,
                        vx: perpX * side * 0.3 + (Math.random() - 0.5) * 3,
                        vy: perpY * side * 0.3 + (Math.random() - 0.5) * 3,
                        radius: 2.5,
                        life: 0.35,
                        type: 'spark',
                        color: '#ff4444',
                        endColor: '#990000'
                    });
                });
            }, t * (chargeDuration - 40));
        }

        // Terminal Impact: Epic Red Katana Slash in the direction of moving (vertical or horizontal)
        setTimeout(() => {
            // 1. Blinding Crimson Impact Flash
            this.addParticle({
                x: toCoord.x,
                y: toCoord.y,
                radius: 95,
                growth: 2.2,
                life: 0.25,
                type: 'flash',
                color: '#ff0033',
                alpha: 1.0
            });

            // 2. Colossal Red Katana Slicing Beam (Length 340px) Oriented in Direction of Moving!
            this.addParticle({
                x: toCoord.x,
                y: toCoord.y,
                life: 0.55,
                type: 'beam',
                color: '#ff0033',
                rotation: moveAngle,
                data: { length: 340, strokeWidth: 11 },
                alpha: 1.0
            });

            // 3. Parallel Razor Speed Slices (offset along perpendicular axis)
            [-14, 14].forEach(offset => {
                this.addParticle({
                    x: toCoord.x + perpX * (offset / 12),
                    y: toCoord.y + perpY * (offset / 12),
                    life: 0.45,
                    type: 'beam',
                    color: '#ff3366',
                    rotation: moveAngle,
                    data: { length: 240, strokeWidth: 4 },
                    alpha: 0.85
                });
            });

            // 4. Red Katana Crescent Blade Arc Sweeping in Movement Direction
            this.addParticle({
                x: toCoord.x,
                y: toCoord.y,
                radius: 130,
                growth: 0.65,
                life: 0.58,
                type: 'blade_arc',
                color: '#ff1744',
                rotation: moveAngle,
                alpha: 1.0,
                data: { strokeWidth: 26 }
            });

            // 5. Counter-Slash Crescent Arc
            this.addParticle({
                x: toCoord.x,
                y: toCoord.y,
                radius: 110,
                growth: 0.5,
                life: 0.48,
                type: 'blade_arc',
                color: '#dc2626',
                rotation: moveAngle + Math.PI,
                alpha: 0.9,
                data: { strokeWidth: 18 }
            });

            // 6. Cutting Crimson Shockwave Ring
            this.addParticle({
                x: toCoord.x,
                y: toCoord.y,
                radius: 16,
                growth: 7.5,
                life: 0.42,
                type: 'shockwave',
                color: _themeColor('shockwave', '#ff1744'),
                data: { strokeWidth: 8 },
                alpha: 1.0
            });

            // 7. 60+ Fiery Crimson & White Sparks Spraying Forward in Moving Direction
            for (let i = 0; i < 60; i++) {
                const spd = 4 + Math.random() * 14;
                const a = moveAngle + (Math.random() - 0.5) * 1.8;
                this.addParticle({
                    x: toCoord.x,
                    y: toCoord.y,
                    vx: Math.cos(a) * spd,
                    vy: Math.sin(a) * spd,
                    drag: 0.92,
                    radius: 2.5 + Math.random() * 2.5,
                    life: 0.48,
                    type: 'spark',
                    color: Math.random() < 0.5 ? '#ffffff' : '#fca5a5',
                    endColor: '#dc2626'
                });
            }

            if (onImpact) onImpact(toCoord.x, toCoord.y);
        }, chargeDuration);
    }

    // ========================================================================
    // 🐘 ELEPHANT: SEISMIC MOUNTAIN STOMP & TECTONIC FISSURE
    // ========================================================================
    playElephantFissure(fromPos, toPos, onImpact) {
        const fromCoord = this.getCoord(fromPos.r, fromPos.c);
        const toCoord = this.getCoord(toPos.r, toPos.c);
        const steps = 18;

        // Ground fracture tearing across diagonal
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const px = fromCoord.x + (toCoord.x - fromCoord.x) * t;
            const py = fromCoord.y + (toCoord.y - fromCoord.y) * t;
            setTimeout(() => {
                this.addParticle({
                    x: px + (Math.random() - 0.5) * 14,
                    y: py + (Math.random() - 0.5) * 14,
                    vx: (Math.random() - 0.5) * 3,
                    vy: -1.5 + (Math.random() - 0.5) * 2,
                    radius: 10 + Math.random() * 8,
                    growth: 0.8,
                    life: 0.45,
                    type: 'smoke',
                    alpha: 0.7
                });
                this.addParticle({
                    x: px,
                    y: py,
                    vx: (Math.random() - 0.5) * 4,
                    vy: (Math.random() - 0.5) * 4,
                    radius: 3,
                    life: 0.35,
                    type: 'spark',
                    color: '#34d399',
                    endColor: '#059669'
                });
            }, t * 180);
        }

        setTimeout(() => {
            // Emerald jade flash
            this.addParticle({
                x: toCoord.x,
                y: toCoord.y,
                radius: 80,
                growth: 2.2,
                life: 0.25,
                type: 'flash',
                color: '#10b981',
                alpha: 1
            });

            // Monumental Tectonic Jade Shockwave Ring (Expanding to 95px)
            this.addParticle({
                x: toCoord.x,
                y: toCoord.y,
                radius: 15,
                growth: 7.5,
                life: 0.5,
                type: 'shockwave',
                color: '#10b981',
                data: { strokeWidth: 8 },
                alpha: 1
            });

            // Secondary Earth Shockwave
            setTimeout(() => {
                this.addParticle({
                    x: toCoord.x,
                    y: toCoord.y,
                    radius: 20,
                    growth: 6.0,
                    life: 0.42,
                    type: 'shockwave',
                    color: '#6ee7b7',
                    data: { strokeWidth: 5 },
                    alpha: 0.8
                });
            }, 80);

            // Ground fracture crater
            this.addParticle({
                x: toCoord.x,
                y: toCoord.y,
                radius: 40,
                life: 2.0,
                type: 'scorch',
                alpha: 0.85
            });

            // 50+ Emerald & Earth Sparks
            for (let i = 0; i < 50; i++) {
                const a = Math.random() * Math.PI * 2;
                const spd = 3 + Math.random() * 12;
                this.addParticle({
                    x: toCoord.x,
                    y: toCoord.y,
                    vx: Math.cos(a) * spd,
                    vy: Math.sin(a) * spd,
                    drag: 0.93,
                    radius: 2.8 + Math.random() * 2.2,
                    life: 0.45,
                    type: 'spark',
                    color: Math.random() < 0.6 ? '#6ee7b7' : '#34d399',
                    endColor: '#047857'
                });
            }

            // 24 Volumetric Earth Dust Clouds
            for (let i = 0; i < 24; i++) {
                const a = Math.random() * Math.PI * 2;
                const spd = 2 + Math.random() * 5;
                this.addParticle({
                    x: toCoord.x + Math.cos(a) * 12,
                    y: toCoord.y + Math.sin(a) * 12,
                    vx: Math.cos(a) * spd,
                    vy: Math.sin(a) * spd - 1.2,
                    radius: 18 + Math.random() * 14,
                    growth: 1.2,
                    life: 0.7,
                    type: 'smoke',
                    alpha: 0.75
                });
            }

            if (onImpact) onImpact(toCoord.x, toCoord.y);
        }, 200);
    }

    // ========================================================================
    // 🔱 SOLDIER: SOLAR DRAGON SPEAR THRUST (Solar Flame / Fiery Sun Orange)
    // ========================================================================
    playSoldierThrust(fromPos, toPos, onImpact) {
        const fromCoord = this.getCoord(fromPos.r, fromPos.c);
        const toCoord = this.getCoord(toPos.r, toPos.c);
        const angle = Math.atan2(toCoord.y - fromCoord.y, toCoord.x - fromCoord.x);

        // 1. Blazing Solar Kinetic Spear Energy Beam (Length 220px, Molten Orange)
        this.addParticle({
            x: toCoord.x,
            y: toCoord.y,
            life: 0.48,
            type: 'beam',
            color: _themeColor('particleFire', '#ff5500'),
            rotation: angle,
            data: { length: 220, strokeWidth: 9 },
            alpha: 1.0
        });

        // Piercing solar spark trail
        for (let i = 0; i <= 16; i++) {
            const t = i / 16;
            this.addParticle({
                x: fromCoord.x + (toCoord.x - fromCoord.x) * t,
                y: fromCoord.y + (toCoord.y - fromCoord.y) * t,
                vx: Math.cos(angle) * (4 + Math.random() * 4),
                vy: Math.sin(angle) * (4 + Math.random() * 4),
                radius: 4.5,
                growth: -0.15,
                life: 0.35,
                type: 'spark',
                color: _themeColor('particleFire', '#ffa500'),
                endColor: '#ff3700'
            });
        }

        setTimeout(() => {
            // Solar thrust flash
            this.addParticle({
                x: toCoord.x,
                y: toCoord.y,
                radius: 75,
                growth: 2.0,
                life: 0.22,
                type: 'flash',
                color: _themeColor('particleFire', '#ff5500'),
                alpha: 1
            });

            // Molten orange thrust shockwave (Expanding to 70px)
            this.addParticle({
                x: toCoord.x,
                y: toCoord.y,
                radius: 14,
                growth: 6.2,
                life: 0.38,
                type: 'shockwave',
                color: _themeColor('shockwave', '#ff7700'),
                data: { strokeWidth: 7 },
                alpha: 1
            });

            // 45+ Piercing Sparks spraying along penetration vector
            for (let i = 0; i < 45; i++) {
                const spd = 3 + Math.random() * 10;
                const a = angle + (Math.random() - 0.5) * 1.2;
                this.addParticle({
                    x: toCoord.x,
                    y: toCoord.y,
                    vx: Math.cos(a) * spd,
                    vy: Math.sin(a) * spd,
                    drag: 0.92,
                    radius: 2.5 + Math.random() * 2,
                    life: 0.42,
                    type: 'spark',
                    color: _themeColor('particleFire', Math.random() < 0.5 ? '#ffffff' : '#fed7aa'),
                    endColor: '#ff5500'
                });
            }

            if (onImpact) onImpact(toCoord.x, toCoord.y);
        }, 140);
    }

    // ========================================================================
    // 👑 GENERAL: IMPERIAL ROYAL TRICOLOR SEAL (Dragon Purple + Carmine Red + Gold)
    // ========================================================================
    playGeneralSeal(fromPos, toPos, onImpact) {
        const toCoord = this.getCoord(toPos.r, toPos.c);

        // 1. Royal Imperial Flash
        this.addParticle({
            x: toCoord.x,
            y: toCoord.y,
            radius: 85,
            growth: 2.2,
            life: 0.25,
            type: 'flash',
            color: '#dc2626',
            alpha: 1
        });

        // 2. Imperial Seal Scorch Crater
        this.addParticle({
            x: toCoord.x,
            y: toCoord.y,
            radius: 46,
            life: 2.5,
            type: 'scorch',
            alpha: 0.95
        });

        // 3. Triple Concentric Imperial Shockwave Rings (Carmine Red, Dragon Purple, Celestial Gold)
        const ringColors = ['#dc2626', '#9333ea', '#ffd700'];
        [0, 70, 140].forEach((delay, idx) => {
            setTimeout(() => {
                this.addParticle({
                    x: toCoord.x,
                    y: toCoord.y,
                    radius: 12 + idx * 5,
                    growth: 6.8 + idx * 0.5,
                    life: 0.45,
                    type: 'shockwave',
                    color: ringColors[idx],
                    data: { strokeWidth: 7 - idx },
                    alpha: 1
                });
            }, delay);
        });

        // 4. 60+ Multi-Jewel Imperial Sparks (Gold, Ruby, Amethyst)
        for (let i = 0; i < 60; i++) {
            const a = Math.random() * Math.PI * 2;
            const spd = 4 + Math.random() * 12;
            const jewelColor = Math.random() < 0.33 ? '#ffd700' : (Math.random() < 0.66 ? '#f43f5e' : '#c084fc');
            this.addParticle({
                x: toCoord.x,
                y: toCoord.y,
                vx: Math.cos(a) * spd,
                vy: Math.sin(a) * spd,
                drag: 0.93,
                radius: 2.8 + Math.random() * 2.2,
                life: 0.48,
                type: 'spark',
                color: jewelColor,
                endColor: '#9333ea'
            });
        }

        if (onImpact) onImpact(toCoord.x, toCoord.y);
    }

    // ========================================================================
    // 🎯 CHECK THREAT LASER SIGHTLINE (Clean, Non-intrusive Standoff)
    // ========================================================================
    playCheckLaserSight(fromPos, toPos) {
        const fromCoord = this.getCoord(fromPos.r, fromPos.c);
        const toCoord = this.getCoord(toPos.r, toPos.c);

        this.addParticle({
            x: fromCoord.x,
            y: fromCoord.y,
            life: 1.2,
            type: 'laser_beam',
            color: _themeColor('laser', '#ef4444'),
            alpha: 0.95,
            data: { targetX: toCoord.x, targetY: toCoord.y }
        });
    }

    /**
     * ⚔️ Epic Check Banner 2D Canvas VFX (Golden Shockwaves & Radiant Sparks)
     */
    playCheckBannerVFX() {
        const cx = this.canvas ? this.canvas.width / (2 * (this.dpr || 1)) : 200;
        const cy = this.canvas ? this.canvas.height / (2 * (this.dpr || 1)) : 225;

        // 1. Center Imperial Flash (Crimson & Gold, instant flash)
        this.addParticle({
            x: cx,
            y: cy,
            radius: 110,
            growth: 4.8,
            life: 0.2,
            type: 'flash',
            color: '#dc2626',
            alpha: 1.0
        });

        // 2. High-speed Imperial Golden Shockwave Ring (Expands fast on impact)
        this.addParticle({
            x: cx,
            y: cy,
            radius: 16,
            growth: 12.5,
            life: 0.32,
            type: 'shockwave',
            color: '#ffd700',
            data: { strokeWidth: 7 },
            alpha: 1.0
        });

        // 3. Secondary Carmine Red Shockwave Ring
        setTimeout(() => {
            this.addParticle({
                x: cx,
                y: cy,
                radius: 20,
                growth: 10.5,
                life: 0.28,
                type: 'shockwave',
                color: _themeColor('shockwave', '#ef4444'),
                data: { strokeWidth: 5 },
                alpha: 0.9
            });
        }, 40);

        // 4. Fast Radiant Imperial Sparks Bursting from Banner Slam
        for (let i = 0; i < 32; i++) {
            const a = Math.random() * Math.PI * 2;
            const spd = 6 + Math.random() * 16;
            this.addParticle({
                x: cx,
                y: cy,
                vx: Math.cos(a) * spd,
                vy: Math.sin(a) * spd,
                drag: 0.90,
                radius: 2.5 + Math.random() * 2.0,
                life: 0.32 + Math.random() * 0.18,
                type: 'spark',
                color: Math.random() < 0.65 ? '#ffd700' : '#fca5a5',
                endColor: '#dc2626'
            });
        }
    }

    // ========================================================================
    // 👑 CHECKMATE ROYAL PIECE DISINTEGRATION (End Game Climax)
    // ========================================================================
    playCheckmateRoyalShatter(kingPos) {
        const kCoord = this.getCoord(kingPos.r, kingPos.c);

        // Permanent Throne Scorch Crater
        this.addParticle({
            x: kCoord.x,
            y: kCoord.y,
            radius: 46,
            life: 4.5,
            type: 'scorch',
            alpha: 0.95
        });

        // Blinding White Flash
        this.addParticle({
            x: kCoord.x,
            y: kCoord.y,
            radius: 65,
            growth: 2.5,
            life: 0.18,
            type: 'flash',
            alpha: 1
        });

        // Dual Imperial Shockwaves
        [0, 100].forEach(delay => {
            setTimeout(() => {
                this.addParticle({
                    x: kCoord.x,
                    y: kCoord.y,
                    radius: 14,
                    growth: 7.5,
                    life: 0.42,
                    type: 'shockwave',
                    color: _themeColor('shockwave', '#ef4444'),
                    data: { strokeWidth: 7 },
                    alpha: 1
                });
            }, delay);
        });

        // 60+ Fiery Sparks
        for (let i = 0; i < 60; i++) {
            const a = Math.random() * Math.PI * 2;
            const spd = 3 + Math.random() * 12;
            this.addParticle({
                x: kCoord.x,
                y: kCoord.y,
                vx: Math.cos(a) * spd,
                vy: Math.sin(a) * spd,
                gravity: 0.15,
                radius: 2.5 + Math.random() * 2.5,
                life: 0.45 + Math.random() * 0.35,
                type: 'spark',
                color: Math.random() < 0.5 ? '#ffffff' : '#f59e0b'
            });
        }
    }
}

// ============================================================================
// 6. MASTER AAA CINEMATIC ANIMATION DIRECTOR
// ============================================================================
class AAAEngine {
    constructor() {
        this.fx2d = new FX2DEngine();
        this.activeTimeline = null;
    }

    createDummyTarget(to, pieceChar = 'p') {
        if (typeof document === 'undefined') return null;
        const dummy = document.createElement('div');
        dummy.className = 'piece-wrap piece-showcase-dummy';
        dummy.style.left = `${5 + to.c * 11.25}%`;
        dummy.style.top = `${4.444 + to.r * 10}%`;
        dummy.style.zIndex = '30';
        dummy.innerHTML = (window.PieceRenderer || PieceRenderer).getSVG(pieceChar, 'luxury');
        const boardLayer = document.getElementById('boardLayer') || document.getElementById('boardOuter');
        if (boardLayer) boardLayer.appendChild(dummy);
        return dummy;
    }

    playCapture(pieceType, from, to, targetEl, movingEl, onComplete) {
        // Resolve DOM elements if not passed directly
        const target = targetEl || (typeof document !== 'undefined' ? document.querySelector(`.piece-wrap[data-row="${to.r}"][data-col="${to.c}"]`) : null);
        const moving = movingEl || (typeof document !== 'undefined' ? document.querySelector(`.piece-wrap[data-row="${from.r}"][data-col="${from.c}"]`) : null);

        const pt = (pieceType || '').toUpperCase();
        if (pt === 'A' || pt === 'SHI') return this.playAdvisorCapture(from, to, target, moving, onComplete);
        if (pt === 'C' || pt === 'PAO') return this.playCannonCapture(from, to, target, moving, onComplete);
        if (pt === 'H' || pt === 'MA') return this.playHorseCapture(from, to, target, moving, onComplete);
        if (pt === 'R' || pt === 'JU' || pt === 'CHE') return this.playChariotCapture(from, to, target, moving, onComplete);
        if (pt === 'E' || pt === 'XIANG') return this.playElephantCapture(from, to, target, moving, onComplete);
        if (pt === 'P' || pt === 'BING' || pt === 'ZU') return this.playSoldierCapture(from, to, target, moving, onComplete);
        if (pt === 'K' || pt === 'G' || pt === 'SHUAI' || pt === 'JIANG') return this.playGeneralCapture(from, to, target, moving, onComplete);

        if (target) target.style.display = 'none';
        if (onComplete) onComplete();
    }

    // -------------------------------------------------------------
    // 🗡️ 1. ADVISOR: Legendary Anime Katana Slash
    // -------------------------------------------------------------
    playAdvisorCapture(from, to, targetEl, movingEl, onComplete, opts) {
        if (this.activeTimeline) this.activeTimeline.kill();

        if (!opts || !opts.muteInternalAudio) playSfx('katana_unsheathe');

        const isShowcase = !onComplete;
        let dummyTarget = null;
        if (!targetEl) {
            dummyTarget = this.createDummyTarget(to, 'p');
            targetEl = dummyTarget;
        }
        if (!movingEl && typeof document !== 'undefined') {
            movingEl = document.querySelector(`.piece-wrap[data-row="${from.r}"][data-col="${from.c}"]`);
        }

        const dr = to.r - from.r;
        const dc = to.c - from.c;

        if (movingEl) {
            movingEl.style.transition = 'none';
            movingEl.style.zIndex = '60';
        }

        // Phase 1: Iaido Crouch & Shadow-Dash Stance (0 - 180ms)
        if (movingEl && typeof gsap !== 'undefined') {
            gsap.to(movingEl, {
                xPercent: -50,
                yPercent: -50,
                scale: 0.9,
                x: -dc * 8,
                y: -dr * 8,
                filter: 'drop-shadow(0 0 20px #00f5ff) brightness(1.3)',
                duration: 0.16,
                ease: 'power2.out'
            });
        }

        // Phase 2: Supersonic Dash & Slash Strike (180ms - 420ms)
        setTimeout(() => {
            if (!opts || !opts.muteInternalAudio) playSfx('advisor_capture');

            if (movingEl && typeof gsap !== 'undefined') {
                gsap.to(movingEl, {
                    x: 0,
                    y: 0,
                    left: `${5 + to.c * 11.25}%`,
                    top: `${4.444 + to.r * 10}%`,
                    scale: 1.15,
                    duration: 0.18,
                    ease: 'power3.inOut'
                });
            }

            // Impact at 100ms
            setTimeout(() => {
                hitStop(110);
                addTrauma(0.95);

                // 2D Epic Katana Slash: Giant Crescent Arcs, Diagonal Streak & 60 Sparks
                this.fx2d.playKatanaSlash(from, to);

                // 3D Physical Wood Splinters
                if (window.fx3dEngine) {
                    window.fx3dEngine.playCaptureShatter3D(to, 1.5);
                }

                // Victim splits diagonally along slash line
                if (targetEl) {
                    targetEl.classList.add('piece-split-cleave');
                    setTimeout(() => {
                        if (targetEl) targetEl.style.display = 'none';
                    }, 350);
                }
            }, 100);

            // Phase 3: Sheathe & Settle (300ms)
            setTimeout(() => {
                if (movingEl && typeof gsap !== 'undefined') {
                    gsap.to(movingEl, {
                        scale: 1.0,
                        filter: 'none',
                        duration: 0.18,
                        ease: 'power2.out'
                    });
                }
            }, 300);

            // Settle & Complete (480ms after Phase 2 = ~660ms total)
            setTimeout(() => {
                if (dummyTarget) dummyTarget.remove();
                if (isShowcase && movingEl && typeof gsap !== 'undefined') {
                    gsap.to(movingEl, {
                        left: `${5 + from.c * 11.25}%`,
                        top: `${4.444 + from.r * 10}%`,
                        scale: 1.0,
                        filter: 'none',
                        duration: 0.25,
                        ease: 'power2.inOut',
                        onComplete: () => {
                            if (movingEl) {
                                movingEl.style.transition = '';
                                movingEl.style.zIndex = '';
                            }
                        }
                    });
                } else {
                    if (movingEl) {
                        movingEl.style.transition = '';
                        movingEl.style.zIndex = '';
                    }
                    if (onComplete) onComplete();
                }
            }, 480);
        }, 180);
    }

    // -------------------------------------------------------------
    // 💥 2. CANNON: Heavy Artillery Ballistic Barrage
    // -------------------------------------------------------------
    playCannonCapture(from, to, targetEl, movingEl, onComplete, opts) {
        if (this.activeTimeline) this.activeTimeline.kill();

        const isShowcase = !onComplete;
        let dummyTarget = null;
        if (!targetEl) {
            dummyTarget = this.createDummyTarget(to, 'p');
            targetEl = dummyTarget;
        }
        if (!movingEl && typeof document !== 'undefined') {
            movingEl = document.querySelector(`.piece-wrap[data-row="${from.r}"][data-col="${from.c}"]`);
        }

        // Recoil back
        if (!opts || !opts.muteInternalAudio) playSfx('cannon_charge');
        if (!opts || !opts.muteInternalAudio) playSfx('fuse_hiss');

        if (movingEl) {
            movingEl.classList.add('piece-charging');
        }

        // Fire cannonball in arc
        setTimeout(() => {
            if (!opts || !opts.muteInternalAudio) playSfx('cannon_fire');
            if (!opts || !opts.muteInternalAudio) playSfx('ball_whistle');
            addTrauma(0.5);

            // 2D Ballistic Artillery Shell Flight & Impact Detonation
            this.fx2d.playCannonBlast(from, to, () => {
                hitStop(110);
                addTrauma(1.1);
                if (!opts || !opts.muteInternalAudio) playSfx('cannon_impact');
                if (!opts || !opts.muteInternalAudio) playSfx('debris_scatter');

                // 3D Physical Wood Splinters
                if (window.fx3dEngine) {
                    window.fx3dEngine.playCaptureShatter3D(to, 1.6);
                }

                if (targetEl) {
                    targetEl.classList.add('piece-captured');
                    setTimeout(() => {
                        if (targetEl) targetEl.style.display = 'none';
                    }, 180);
                }

                // Cannon rolls forward to take destination
                if (movingEl) {
                    movingEl.classList.remove('piece-charging');
                    movingEl.style.transition = 'none';
                    if (typeof gsap !== 'undefined') {
                        gsap.to(movingEl, {
                            xPercent: -50,
                            yPercent: -50,
                            left: `${5 + to.c * 11.25}%`,
                            top: `${4.444 + to.r * 10}%`,
                            duration: 0.15,
                            ease: 'power2.out'
                        });
                    } else {
                        movingEl.classList.add('piece-moving');
                        movingEl.style.left = `${5 + to.c * 11.25}%`;
                        movingEl.style.top = `${4.444 + to.r * 10}%`;
                    }
                }

                setTimeout(() => {
                    if (dummyTarget) dummyTarget.remove();
                    if (isShowcase && movingEl && typeof gsap !== 'undefined') {
                        gsap.to(movingEl, {
                            left: `${5 + from.c * 11.25}%`,
                            top: `${4.444 + from.r * 10}%`,
                            duration: 0.2,
                            ease: 'power2.inOut',
                            onComplete: () => {
                                if (movingEl) {
                                    movingEl.style.transition = '';
                                    movingEl.style.zIndex = '';
                                }
                            }
                        });
                    } else {
                        if (movingEl) {
                            movingEl.style.transition = '';
                            movingEl.style.zIndex = '';
                        }
                        if (onComplete) onComplete();
                    }
                }, 160);
            });
        }, 90);
    }

    // -------------------------------------------------------------
    // 🐎 3. HORSE: Celestial Warhorse L-Hop & Meteorite Stomp
    // -------------------------------------------------------------
    playHorseCapture(from, to, targetEl, movingEl, onComplete, opts) {
        if (this.activeTimeline) this.activeTimeline.kill();

        if (!opts || !opts.muteInternalAudio) playSfx('horse_run');

        const isShowcase = !onComplete;
        let dummyTarget = null;
        if (!targetEl) {
            dummyTarget = this.createDummyTarget(to, 'p');
            targetEl = dummyTarget;
        }
        if (!movingEl && typeof document !== 'undefined') {
            movingEl = document.querySelector(`.piece-wrap[data-row="${from.r}"][data-col="${from.c}"]`);
        }

        // Calculate authentic Xiangqi L-waypoint
        const dr = to.r - from.r;
        const dc = to.c - from.c;
        const midR = Math.abs(dr) === 2 ? from.r + Math.sign(dr) : from.r;
        const midC = Math.abs(dr) === 2 ? from.c : from.c + Math.sign(dc);

        if (movingEl) {
            movingEl.style.transition = 'none';
            movingEl.style.zIndex = '60';
        }

        // Phase 1: Orthogonal Gallop to L-Elbow (0ms - 180ms)
        if (movingEl && typeof gsap !== 'undefined') {
            gsap.to(movingEl, {
                xPercent: -50,
                yPercent: -50,
                left: `${5 + midC * 11.25}%`,
                top: `${4.444 + midR * 10}%`,
                scale: 1.25,
                y: -18,
                filter: 'drop-shadow(0 0 20px #a855f7) brightness(1.25)',
                duration: 0.18,
                ease: 'power2.out'
            });
        }

        // Galloping dust puffs & cosmic sparks along Leg 1 on Canvas
        const fromCoord = this.fx2d.getCoord(from.r, from.c);
        const midCoord = this.fx2d.getCoord(midR, midC);
        for (let i = 0; i < 7; i++) {
            const t = i / 7;
            setTimeout(() => {
                this.fx2d.addParticle({
                    x: fromCoord.x + (midCoord.x - fromCoord.x) * t + (Math.random() - 0.5) * 10,
                    y: fromCoord.y + (midCoord.y - fromCoord.y) * t + (Math.random() - 0.5) * 10,
                    vx: (Math.random() - 0.5) * 2,
                    vy: -1.5 + (Math.random() - 0.5) * 2,
                    radius: 8 + Math.random() * 6,
                    growth: 0.7,
                    life: 0.35,
                    type: 'smoke',
                    alpha: 0.65
                });
                this.fx2d.addParticle({
                    x: fromCoord.x + (midCoord.x - fromCoord.x) * t,
                    y: fromCoord.y + (midCoord.y - fromCoord.y) * t,
                    radius: 3,
                    life: 0.25,
                    type: 'spark',
                    color: '#c084fc',
                    endColor: '#9333ea'
                });
            }, t * 150);
        }

        // Phase 2: Skyward Celestial Leap & Turn (180ms - 360ms)
        setTimeout(() => {
            if (movingEl && typeof gsap !== 'undefined') {
                gsap.to(movingEl, {
                    left: `${5 + to.c * 11.25}%`,
                    top: `${4.444 + to.r * 10}%`,
                    scale: 1.45,
                    y: -55,
                    filter: 'drop-shadow(0 0 30px #d946ef) brightness(1.35)',
                    duration: 0.18,
                    ease: 'power1.inOut'
                });
            }

            // Phase 3: Meteorite Stomp Impact (180ms after Phase 2 begins = 360ms total)
            setTimeout(() => {
                stopSfx('horse_run');
                if (!opts || !opts.muteInternalAudio) playSfx('horse_capture');
                hitStop(100);
                addTrauma(1.05);

                if (movingEl && typeof gsap !== 'undefined') {
                    gsap.to(movingEl, {
                        scale: 1.0,
                        y: 0,
                        duration: 0.12,
                        ease: 'power4.in'
                    });
                }

                // 2D Canvas Stomp: Cosmic Violet 95px Shockwaves & Amethyst Lightning
                this.fx2d.playHorseStomp(from, to);

                // 3D Physical Wood Splinters
                if (window.fx3dEngine) {
                    window.fx3dEngine.playCaptureShatter3D(to, 1.5);
                }

                // Victim squashed flat
                if (targetEl) {
                    targetEl.classList.add('piece-flattened');
                    setTimeout(() => {
                        if (targetEl) targetEl.style.display = 'none';
                    }, 350);
                }
            }, 180);

            // Phase 4: Settle & Complete (480ms after Phase 2 = ~660ms total)
            setTimeout(() => {
                if (dummyTarget) dummyTarget.remove();
                if (isShowcase && movingEl && typeof gsap !== 'undefined') {
                    gsap.to(movingEl, {
                        left: `${5 + from.c * 11.25}%`,
                        top: `${4.444 + from.r * 10}%`,
                        scale: 1.0,
                        filter: 'none',
                        duration: 0.25,
                        ease: 'power2.inOut',
                        onComplete: () => {
                            if (movingEl) {
                                movingEl.style.transition = '';
                                movingEl.style.zIndex = '';
                            }
                        }
                    });
                } else {
                    if (movingEl) {
                        movingEl.style.filter = 'none';
                        movingEl.style.transition = '';
                        movingEl.style.zIndex = '';
                    }
                    if (onComplete) onComplete();
                }
            }, 480);
        }, 180);
    }

    // -------------------------------------------------------------
    // 🏎️ 4. CHARIOT: Iron Chariot Slow Thunder Charge & Red Katana
    // -------------------------------------------------------------
    playChariotCapture(from, to, targetEl, movingEl, onComplete, opts) {
        if (this.activeTimeline) this.activeTimeline.kill();

        if (!opts || !opts.muteInternalAudio) playSfx('chariot_capture');

        const isShowcase = !onComplete;
        let dummyTarget = null;
        if (!targetEl) {
            dummyTarget = this.createDummyTarget(to, 'p');
            targetEl = dummyTarget;
        }
        if (!movingEl && typeof document !== 'undefined') {
            movingEl = document.querySelector(`.piece-wrap[data-row="${from.r}"][data-col="${from.c}"]`);
        }

        const dr = to.r - from.r;
        const dc = to.c - from.c;
        const sdr = Math.sign(dr);
        const sdc = Math.sign(dc);

        if (movingEl) {
            movingEl.style.transition = 'none';
            movingEl.style.zIndex = '60';
        }

        // Phase 1: Engine Rev & Pullback with Crimson Aura (0 - 110ms)
        if (movingEl && typeof gsap !== 'undefined') {
            gsap.to(movingEl, {
                xPercent: -50,
                yPercent: -50,
                x: -sdc * 18,
                y: -sdr * 18,
                scale: 1.15,
                filter: 'drop-shadow(0 0 24px #ff0033) brightness(1.25)',
                duration: 0.11,
                ease: 'power2.out'
            });
        }

        // Phase 2: Thundering Lane Charge (110ms - 290ms, duration 180ms)
        setTimeout(() => {
            // Dual flaming ruby wheel tracks & directional red katana slash at impact
            this.fx2d.playChariotCharge(from, to);

            if (movingEl && typeof gsap !== 'undefined') {
                gsap.to(movingEl, {
                    x: 0,
                    y: 0,
                    left: `${5 + to.c * 11.25}%`,
                    top: `${4.444 + to.r * 10}%`,
                    scale: 1.25,
                    duration: 0.18,
                    ease: 'power2.in'
                });
            }

            // Phase 3: Violent Collision & Impact at 180ms
            setTimeout(() => {
                hitStop(110);
                addTrauma(1.3);

                if (movingEl && typeof gsap !== 'undefined') {
                    gsap.to(movingEl, {
                        scale: 1.0,
                        duration: 0.12,
                        ease: 'power2.out'
                    });
                }

                // 3D Physical Wood Splinters
                if (window.fx3dEngine) {
                    window.fx3dEngine.playCaptureShatter3D(to, 1.8);
                }

                // Target piece cleaved along direction of motion
                if (targetEl) {
                    targetEl.classList.add('piece-split-cleave');
                    setTimeout(() => {
                        if (targetEl) targetEl.style.display = 'none';
                    }, 180);
                }
            }, 180);

            // Phase 4: Settle & Complete
            setTimeout(() => {
                if (dummyTarget) dummyTarget.remove();
                if (isShowcase && movingEl && typeof gsap !== 'undefined') {
                    gsap.to(movingEl, {
                        left: `${5 + from.c * 11.25}%`,
                        top: `${4.444 + from.r * 10}%`,
                        scale: 1.0,
                        filter: 'none',
                        duration: 0.2,
                        ease: 'power2.inOut',
                        onComplete: () => {
                            if (movingEl) {
                                movingEl.style.transition = '';
                                movingEl.style.zIndex = '';
                            }
                        }
                    });
                } else {
                    if (movingEl) {
                        movingEl.style.filter = 'none';
                        movingEl.style.transition = '';
                        movingEl.style.zIndex = '';
                    }
                    if (onComplete) onComplete();
                }
            }, 240);
        }, 110);
    }

    // -------------------------------------------------------------
    // 🐘 5. ELEPHANT: Seismic Mountain Leap & Tectonic Fissure
    // -------------------------------------------------------------
    playElephantCapture(from, to, targetEl, movingEl, onComplete, opts) {
        if (this.activeTimeline) this.activeTimeline.kill();

        if (!opts || !opts.muteInternalAudio) playSfx('elephant_capture');

        const isShowcase = !onComplete;
        let dummyTarget = null;
        if (!targetEl) {
            dummyTarget = this.createDummyTarget(to, 'p');
            targetEl = dummyTarget;
        }
        if (!movingEl && typeof document !== 'undefined') {
            movingEl = document.querySelector(`.piece-wrap[data-row="${from.r}"][data-col="${from.c}"]`);
        }

        const midC = (from.c + to.c) / 2;
        const midR = (from.r + to.r) / 2;

        if (movingEl) {
            movingEl.style.transition = 'none';
            movingEl.style.zIndex = '60';
        }

        // Phase 1: High Skyward Leap (0ms - 110ms)
        if (movingEl && typeof gsap !== 'undefined') {
            gsap.to(movingEl, {
                xPercent: -50,
                yPercent: -50,
                left: `${5 + midC * 11.25}%`,
                top: `${4.444 + midR * 10}%`,
                scale: 1.45,
                y: -60,
                filter: 'drop-shadow(0 0 25px #10b981) brightness(1.2)',
                duration: 0.12,
                ease: 'power2.out'
            });
        }

        // Phase 2: Tectonic Descent (110ms - 220ms)
        setTimeout(() => {
            // Tectonic Ground Fissure tearing diagonally
            this.fx2d.playElephantFissure(from, to);

            if (movingEl && typeof gsap !== 'undefined') {
                gsap.to(movingEl, {
                    left: `${5 + to.c * 11.25}%`,
                    top: `${4.444 + to.r * 10}%`,
                    scale: 1.0,
                    y: 0,
                    duration: 0.12,
                    ease: 'power4.in'
                });
            }

            // Phase 3: Monumental Seismic Impact (110ms)
            setTimeout(() => {
                hitStop(110);
                addTrauma(1.35);

                // 3D Physical Wood Splinters
                if (window.fx3dEngine) {
                    window.fx3dEngine.playCaptureShatter3D(to, 1.6);
                }

                if (targetEl) {
                    targetEl.classList.add('piece-flattened');
                    setTimeout(() => {
                        if (targetEl) targetEl.style.display = 'none';
                    }, 180);
                }
            }, 110);

            // Phase 4: Settle & Complete
            setTimeout(() => {
                if (dummyTarget) dummyTarget.remove();
                if (isShowcase && movingEl && typeof gsap !== 'undefined') {
                    gsap.to(movingEl, {
                        left: `${5 + from.c * 11.25}%`,
                        top: `${4.444 + from.r * 10}%`,
                        scale: 1.0,
                        filter: 'none',
                        duration: 0.2,
                        ease: 'power2.inOut',
                        onComplete: () => {
                            if (movingEl) {
                                movingEl.style.transition = '';
                                movingEl.style.zIndex = '';
                            }
                        }
                    });
                } else {
                    if (movingEl) {
                        movingEl.style.filter = 'none';
                        movingEl.style.transition = '';
                        movingEl.style.zIndex = '';
                    }
                    if (onComplete) onComplete();
                }
            }, 220);
        }, 110);
    }

    // -------------------------------------------------------------
    // 🔱 6. SOLDIER: Dragon Spear Thrust
    // -------------------------------------------------------------
    playSoldierCapture(from, to, targetEl, movingEl, onComplete, opts) {
        if (this.activeTimeline) this.activeTimeline.kill();

        if (!opts || !opts.muteInternalAudio) playSfx('soldier_capture');

        const isShowcase = !onComplete;
        let dummyTarget = null;
        if (!targetEl) {
            dummyTarget = this.createDummyTarget(to, 'p');
            targetEl = dummyTarget;
        }
        if (!movingEl && typeof document !== 'undefined') {
            movingEl = document.querySelector(`.piece-wrap[data-row="${from.r}"][data-col="${from.c}"]`);
        }

        const dr = to.r - from.r;
        const dc = to.c - from.c;

        if (movingEl) {
            movingEl.style.transition = 'none';
            movingEl.style.zIndex = '60';
        }

        // Phase 1: Drawback & Ready Stance (0ms - 80ms)
        if (movingEl && typeof gsap !== 'undefined') {
            gsap.to(movingEl, {
                xPercent: -50,
                yPercent: -50,
                x: -dc * 14,
                y: -dr * 14,
                scale: 1.15,
                filter: 'drop-shadow(0 0 22px #ff5500) brightness(1.3)',
                duration: 0.08,
                ease: 'power2.out'
            });
        }

        // Phase 2: Piercing Dragon Lunge (80ms - 190ms)
        setTimeout(() => {
            // Blazing Crimson Spear Energy Beam & Shockwave
            this.fx2d.playSoldierThrust(from, to);

            if (movingEl && typeof gsap !== 'undefined') {
                gsap.to(movingEl, {
                    x: 0,
                    y: 0,
                    left: `${5 + to.c * 11.25}%`,
                    top: `${4.444 + to.r * 10}%`,
                    scale: 1.2,
                    duration: 0.11,
                    ease: 'power3.inOut'
                });
            }

            // Phase 3: Impact Impale (100ms)
            setTimeout(() => {
                hitStop(90);
                addTrauma(0.85);

                // 3D Physical Wood Splinters
                if (window.fx3dEngine) {
                    window.fx3dEngine.playCaptureShatter3D(to, 1.2);
                }

                if (targetEl) {
                    targetEl.classList.add('piece-skewered');
                    setTimeout(() => {
                        if (targetEl) targetEl.style.display = 'none';
                    }, 160);
                }

                if (movingEl && typeof gsap !== 'undefined') {
                    gsap.to(movingEl, {
                        scale: 1.0,
                        duration: 0.1,
                        ease: 'power2.out'
                    });
                }
            }, 100);

            // Phase 4: Settle & Complete
            setTimeout(() => {
                if (dummyTarget) dummyTarget.remove();
                if (isShowcase && movingEl && typeof gsap !== 'undefined') {
                    gsap.to(movingEl, {
                        left: `${5 + from.c * 11.25}%`,
                        top: `${4.444 + from.r * 10}%`,
                        scale: 1.0,
                        filter: 'none',
                        duration: 0.2,
                        ease: 'power2.inOut',
                        onComplete: () => {
                            if (movingEl) {
                                movingEl.style.transition = '';
                                movingEl.style.zIndex = '';
                            }
                        }
                    });
                } else {
                    if (movingEl) {
                        movingEl.style.filter = 'none';
                        movingEl.style.transition = '';
                        movingEl.style.zIndex = '';
                    }
                    if (onComplete) onComplete();
                }
            }, 200);
        }, 80);
    }

    // -------------------------------------------------------------
    // 👑 7. GENERAL: Imperial Jade Seal Slam
    // -------------------------------------------------------------
    playGeneralCapture(from, to, targetEl, movingEl, onComplete, opts) {
        if (this.activeTimeline) this.activeTimeline.kill();

        if (!opts || !opts.muteInternalAudio) playSfx('general_capture');

        const isShowcase = !onComplete;
        let dummyTarget = null;
        if (!targetEl) {
            dummyTarget = this.createDummyTarget(to, 'p');
            targetEl = dummyTarget;
        }
        if (!movingEl && typeof document !== 'undefined') {
            movingEl = document.querySelector(`.piece-wrap[data-row="${from.r}"][data-col="${from.c}"]`);
        }

        if (movingEl) {
            movingEl.style.transition = 'none';
            movingEl.style.zIndex = '60';
        }

        // Phase 1: Imperial Ascent (0ms - 110ms)
        if (movingEl && typeof gsap !== 'undefined') {
            gsap.to(movingEl, {
                xPercent: -50,
                yPercent: -50,
                scale: 1.4,
                y: -42,
                filter: 'drop-shadow(0 0 24px #dc2626) drop-shadow(0 0 16px #9333ea) brightness(1.35)',
                duration: 0.11,
                ease: 'power2.out'
            });
        }

        // Phase 2: Imperial Seal Stampdown (110ms - 220ms)
        setTimeout(() => {
            if (movingEl && typeof gsap !== 'undefined') {
                gsap.to(movingEl, {
                    left: `${5 + to.c * 11.25}%`,
                    top: `${4.444 + to.r * 10}%`,
                    scale: 1.0,
                    y: 0,
                    duration: 0.11,
                    ease: 'power4.in'
                });
            }

            // Phase 3: Monumental Impact (100ms)
            setTimeout(() => {
                hitStop(110);
                addTrauma(1.2);

                // 2D Imperial Seal Shockwaves, Scorch Crater & Golden Sparks
                this.fx2d.playGeneralSeal(from, to);

                // 3D Physical Wood Splinters
                if (window.fx3dEngine) {
                    window.fx3dEngine.playCaptureShatter3D(to, 1.6);
                }

                if (targetEl) {
                    targetEl.classList.add('piece-captured');
                    setTimeout(() => {
                        if (targetEl) targetEl.style.display = 'none';
                    }, 180);
                }
            }, 100);

            // Phase 4: Settle & Complete
            setTimeout(() => {
                if (dummyTarget) dummyTarget.remove();
                if (isShowcase && movingEl && typeof gsap !== 'undefined') {
                    gsap.to(movingEl, {
                        left: `${5 + from.c * 11.25}%`,
                        top: `${4.444 + from.r * 10}%`,
                        scale: 1.0,
                        filter: 'none',
                        duration: 0.2,
                        ease: 'power2.inOut',
                        onComplete: () => {
                            if (movingEl) {
                                movingEl.style.transition = '';
                                movingEl.style.zIndex = '';
                            }
                        }
                    });
                } else {
                    if (movingEl) {
                        movingEl.style.filter = 'none';
                        movingEl.style.transition = '';
                        movingEl.style.zIndex = '';
                    }
                    if (onComplete) onComplete();
                }
            }, 200);
        }, 110);
    }

    // -------------------------------------------------------------
    // 🎯 8. CHECK THREAT SIGHTLINE (Clean, Non-intrusive)
    // -------------------------------------------------------------
    playCheckThreat(fromPos, toPos, pieceType) {
        if (this.fx2d) {
            this.fx2d.playCheckLaserSight(fromPos, toPos);
        }
    }

    // -------------------------------------------------------------
    // 🔒 9. CHECKMATE FINALE: 3D Iron Bolt (铁门栓 绝杀)
    // -------------------------------------------------------------
    playCheckmate(kingEl, onComplete) {
        let targetPos = { r: 0, c: 4 };
        if (kingEl) {
            const rAttr = kingEl.getAttribute ? kingEl.getAttribute('data-row') : (kingEl.dataset ? kingEl.dataset.row : null);
            const cAttr = kingEl.getAttribute ? kingEl.getAttribute('data-col') : (kingEl.dataset ? kingEl.dataset.col : null);
            targetPos.r = (rAttr !== null && !isNaN(parseInt(rAttr))) ? parseInt(rAttr) : 0;
            targetPos.c = (cAttr !== null && !isNaN(parseInt(cAttr))) ? parseInt(cAttr) : 4;
            if (kingEl.classList && kingEl.classList.add) {
                kingEl.classList.add('king-paralyzed');
            }
        }

        const tl = gsap.timeline({ onComplete: onComplete });
        this.activeTimeline = tl;

        // Duck audio & trigger fanfare
        tl.call(() => {
            for (let key in sfx) {
                if (sfx[key].state() !== 'unloaded') {
                    try { sfx[key].fade(sfx[key].volume(), 0, 100); } catch(e) {}
                }
            }
        }, [], 0);

        // 1. Checkmate sound & trauma
        tl.call(() => {
            hitStop(180);
            addTrauma(1.6);
            playSfx('checkmate');

            // 2. 2D Royal Disintegration & Scorch Crater
            this.fx2d.playCheckmateRoyalShatter(targetPos);

            // 3. 3D Iron Bolts Slamming Shut
            if (window.fx3dEngine) {
                window.fx3dEngine.playCheckmateIronBolt3D(targetPos);
            }
        }, [], 0.2);

        // 4. Grand Chinese Calligraphy Stamp Banner: 铁门栓 · 绝杀
        tl.call(() => {
            const board = document.getElementById('boardOuter');
            if (!board) return;
            const text = document.createElement('div');
            text.textContent = '铁门栓 · 绝杀';
            text.className = 'checkmate-calligraphy-text';
            text.style.position = 'absolute';
            text.style.left = '50%';
            text.style.top = '50%';
            text.style.transform = 'translate(-50%, -50%) scale(3)';
            text.style.fontFamily = "'Ma Shan Zheng', 'Kaiti SC', serif";
            text.style.fontWeight = 'bold';
            text.style.color = '#fff';
            text.style.fontSize = '54px';
            text.style.zIndex = '1000';
            text.style.textShadow = '0 0 20px ' + _themeColor('bannerInk', '#ff0000') + ', 0 0 40px #ff5500, 0 0 80px #ffaa00';
            text.style.opacity = '0';
            text.style.pointerEvents = 'none';
            board.appendChild(text);

            gsap.to(text, { scale: 1, opacity: 1, duration: 0.2, ease: 'power4.in' });
            gsap.to(text, { filter: 'brightness(2.5)', duration: 0.15, delay: 0.3, yoyo: true, repeat: 1 });
            gsap.to(text, { opacity: 0, scale: 1.4, duration: 0.5, delay: 1.5, onComplete: () => text.remove() });
        }, [], 0.6);

        // 5. Brief dramatic victory contrast, then automatically restore clean brightness
        tl.to('#boardOuter', { filter: 'brightness(0.75) contrast(1.08)', duration: 0.5 }, 1.8);
        tl.to('#boardOuter', { filter: 'none', duration: 0.5, clearProps: 'filter' }, 2.8);
    }

    // Backward-compatibility delegation methods
    fireArtilleryCannon(from, to, isMega, onImpact) { this.fx2d.playCannonBlast(from, to, onImpact); }
    fireChariotSlash(from, to, isMega, onImpact) { this.fx2d.playChariotCharge(from, to, onImpact); }
    fireHorseStomp(from, to, isMega, onImpact) { this.fx2d.playHorseStomp(from, to, onImpact); }
    fireElephantFissure(from, to, isMega, onImpact) { this.fx2d.playElephantFissure(from, to, onImpact); }
    fireAdvisorSlash(from, to, onImpact) { this.fx2d.playKatanaSlash(from, to, onImpact); }
    fireSoldierThrust(from, to, onImpact) { this.fx2d.playSoldierThrust(from, to, onImpact); }
    triggerVictoryEmberRain(duration) {}
}

// Global engine singletons
window.vfxEngine = window.aaaEngine = window.fxEngine = new AAAEngine();

// Safe sound controller proxy
window.soundFx = new Proxy({
    enabled: true,
    playMove: () => playSfx('cannon_charge'),
    playCapture: () => playSfx('cannon_impact'),
    playCheck: (pieceType) => {
        playSfx('epic_check');
        playSfx('epic_gong');
        if (pieceType === 'C') playSfx('cannon_check');
        else if (pieceType === 'R') playSfx('chariot_check');
        else if (pieceType === 'H') playSfx('horse_check');
        else if (pieceType === 'P') playSfx('soldier_check');
        else playSfx('general_check');
    },
    playVictory: () => playSfx('general_capture'),
    playSelect: () => {},
    playStandoffTension: () => playSfx('fuse_hiss'),
    playCheckmateClimax: () => playSfx('checkmate'),
    playCannonCharging: () => playSfx('cannon_charge'),
    playMechanicalLock: () => playSfx('cannon_charge'),
    playSizzlingFuse: () => playSfx('fuse_hiss'),
    playBladeUnsheathe: () => playSfx('katana_unsheathe'),
    playEnergyHum: () => playSfx('fuse_hiss'),
    playHorseRear: () => playSfx('horse_capture'),
    playLightningCrack: () => playSfx('chariot_capture'),
    playSpearLevel: () => playSfx('soldier_capture'),
    playCannonBlast: () => playSfx('cannon_fire'),
    playElephantTremor: () => playSfx('elephant_capture'),
    playHorseGallop: () => playSfx('horse_run'),
    playSwordSlash: () => playSfx('advisor_capture'),
    playSpearThrust: () => playSfx('soldier_capture')
}, {
    get: (target, prop) => target[prop] || (() => {})
});
