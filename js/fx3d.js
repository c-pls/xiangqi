/**
 * FX3DEngine - Focused 3D Physical VFX Engine for Xiangqi
 * - 100% Offline Three.js WebGL Rendering on fxCanvas3D
 * - Physical 3D Wooden Splinters & Lacquer Shards with Gravity and Tumbling Rotation
 * - Checkmate 3D Iron Bolt Finale (铁门栓 绝杀) with 4 Heavy Metallic Pillars
 * - ZERO crude unshaded geometric blobs (no orange toruses, no yellow sticks)
 * - 100% Leak-Proof Memory and Scene Management
 */

class FX3DEngine {
    constructor() {
        this.canvas = document.getElementById('fxCanvas3D');
        this.boardOuter = document.getElementById('boardOuter');
        this.activeThreats = [];
        this.running = false;
        this.currentW = 0;
        this.currentH = 0;

        if (this.canvas && typeof THREE !== 'undefined') {
            try {
                this.initThreeJS();
                this.startLoop();
            } catch(e) {
                console.warn('FX3DEngine init fallback:', e);
            }
        }
    }

    initThreeJS() {
        const w = (this.boardOuter && this.boardOuter.clientWidth) || 400;
        const h = (this.boardOuter && this.boardOuter.clientHeight) || 450;
        this.currentW = w;
        this.currentH = h;
        
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 1000);
        this.camera.position.set(0, -6, 15);
        this.camera.lookAt(0, 0, 0);

        try {
            this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
            this.renderer.setClearColor(0x000000, 0);
            this.renderer.setSize(w, h, false);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        } catch(err) {
            console.warn('WebGLRenderer fallback:', err);
        }

        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(this.ambientLight);

        this.dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
        this.dirLight.position.set(5, 5, 10);
        this.scene.add(this.dirLight);

        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('resize', () => this.resize());
        }
        if (window.ResizeObserver && this.boardOuter) {
            let resizeRaf = null;
            new ResizeObserver(() => {
                if (resizeRaf) cancelAnimationFrame(resizeRaf);
                resizeRaf = requestAnimationFrame(() => this.resize());
            }).observe(this.boardOuter);
        }
    }

    resize() {
        if (!this.renderer || !this.boardOuter || !this.camera) return;
        const w = this.boardOuter.clientWidth || 400;
        const h = this.boardOuter.clientHeight || 450;
        if (this.currentW === w && this.currentH === h) return;
        this.currentW = w;
        this.currentH = h;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, false);
    }

    startLoop() {
        if (this.loopActive) return;
        this.loopActive = true;
        this.clock = this.clock || new THREE.Clock();
        const loop = () => {
            if (!this.loopActive) return;
            const dt = Math.min(this.clock.getDelta(), 0.05);
            const now = performance.now();
            
            this.activeThreats = this.activeThreats.filter(t => {
                try {
                    const alive = t.update(dt, now);
                    if (!alive && t.cleanup) t.cleanup();
                    return alive;
                } catch(e) {
                    if (t.cleanup) try { t.cleanup(); } catch(err) {}
                    return false;
                }
            });
            
            if (this.activeThreats.length > 0) {
                this.isDirty = true;
                if (this.renderer && this.scene && this.camera) {
                    this.renderer.render(this.scene, this.camera);
                }
                requestAnimationFrame(loop);
            } else {
                if (this.isDirty && this.renderer && this.scene && this.camera) {
                    this.renderer.setClearColor(0x000000, 0);
                    this.renderer.render(this.scene, this.camera);
                    this.isDirty = false;
                }
                this.loopActive = false;
            }
        };
        requestAnimationFrame(loop);
    }

    gridToWorld(r, c) {
        return new THREE.Vector3((c - 4) * 1.05, (4.5 - r) * 1.05, 0.5);
    }

    /**
     * Completely clear all active animations and guarantee removal of all dynamic objects
     */
    clearThreats() {
        for (const t of this.activeThreats) {
            if (t.cleanup) {
                try { t.cleanup(); } catch(e) {}
            }
        }
        this.activeThreats = [];

        // Purge any dynamic objects left in the scene
        if (this.scene) {
            const toRemove = [];
            this.scene.children.forEach(child => {
                if (child !== this.ambientLight && child !== this.dirLight) {
                    toRemove.push(child);
                }
            });
            toRemove.forEach(child => {
                this.scene.remove(child);
                if (child.traverse) {
                    child.traverse(obj => {
                        if (obj.geometry) obj.geometry.dispose();
                        if (obj.material) {
                            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                            else obj.material.dispose();
                        }
                    });
                }
            });
        }

        this.isFlipped = (this.boardOuter && this.boardOuter.classList.contains('flipped')) || false;
        if (this.camera) {
            this.camera.position.set(0, this.isFlipped ? 6 : -6, 15);
            this.camera.lookAt(0, 0, 0);
        }

        if (this.renderer && this.scene && this.camera) {
            this.renderer.setClearColor(0x000000, 0);
            this.renderer.render(this.scene, this.camera);
        }
        this.isDirty = false;
        this.loopActive = false;
    }

    setFlipped(flipped) {
        this.isFlipped = !!flipped;
        if (this.camera) {
            this.camera.position.set(0, this.isFlipped ? 6 : -6, 15);
            this.camera.lookAt(0, 0, 0);
        }
    }

    // ==========================================
    // 1. PHYSICAL 3D PIECE SPLINTERS & SHARDS
    // ==========================================
    playCaptureShatter3D(targetPos, intensity = 1.0) {
        if (!this.scene) return;
        const cPos = this.gridToWorld(targetPos.r, targetPos.c);
        const group = new THREE.Group();
        group.position.copy(cPos);
        this.scene.add(group);

        const shards = [];
        const woodMat = new THREE.MeshStandardMaterial({ 
            color: 0x5a3418, 
            roughness: 0.85, 
            metalness: 0.15 
        });
        
        const numShards = Math.floor(24 * intensity);
        for (let i = 0; i < numShards; i++) {
            const size = Math.random() * 0.16 + 0.06;
            const geom = new THREE.TetrahedronGeometry(size, 0);
            geom.scale(Math.random() * 0.5 + 0.5, Math.random() * 3.0 + 1.5, Math.random() * 0.5 + 0.5);
            const shard = new THREE.Mesh(geom, woodMat);
            
            const angle = Math.random() * Math.PI * 2;
            const speed = (Math.random() * 8 + 4) * intensity;
            const upSpeed = (Math.random() * 10 + 6) * intensity;
            
            shard.userData = {
                vel: new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, upSpeed),
                angVel: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14)
            };
            
            group.add(shard);
            shards.push(shard);
        }

        const startTime = performance.now();
        this.startLoop();
        this.activeThreats.push({
            update: (dt, now) => {
                const elapsed = (now - startTime) / 1000;
                shards.forEach(s => {
                    if (s.position.z < -3) return;
                    s.position.addScaledVector(s.userData.vel, dt);
                    s.rotation.x += s.userData.angVel.x * dt;
                    s.rotation.y += s.userData.angVel.y * dt;
                    s.rotation.z += s.userData.angVel.z * dt;
                    s.userData.vel.z -= 32 * dt;
                    s.userData.vel.x *= (1 - 2.5 * dt);
                    s.userData.vel.y *= (1 - 2.5 * dt);
                });

                if (elapsed > 0.8) {
                    group.scale.setScalar(Math.max(0, 1 - (elapsed - 0.8) * 3));
                }

                if (elapsed > 1.2) return false;
                return true;
            },
            cleanup: () => {
                this.scene.remove(group);
                shards.forEach(s => {
                    if (s.geometry) s.geometry.dispose();
                });
                woodMat.dispose();
            }
        });
    }

    // ==========================================
    // 2. CHECKMATE 3D IRON BOLT FINALE (铁门栓 绝杀)
    // ==========================================
    playCheckmateIronBolt3D(targetPos, onComplete) {
        if (!this.scene) { if (onComplete) onComplete(); return; }
        const cPos = this.gridToWorld(targetPos.r, targetPos.c);
        const group = new THREE.Group();
        group.position.copy(cPos);
        this.scene.add(group);

        // 1. Core Dramatic Light
        const explosionLight = new THREE.PointLight(0xff6600, 40, 20);
        explosionLight.position.set(0, 0, 1.5);
        group.add(explosionLight);

        // 2. 3D Wooden Palace Shards
        const shards = [];
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9, metalness: 0.1 });
        
        for (let i = 0; i < 60; i++) {
            const size = Math.random() * 0.2 + 0.1;
            const geom = new THREE.TetrahedronGeometry(size, 0);
            geom.scale(Math.random() * 0.5 + 0.5, Math.random() * 3 + 2, Math.random() * 0.5 + 0.5);
            const shard = new THREE.Mesh(geom, woodMat);
            
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 12 + 4;
            const upSpeed = Math.random() * 14 + 8;
            
            shard.userData = {
                vel: new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, upSpeed),
                angVel: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10)
            };
            
            group.add(shard);
            shards.push(shard);
        }

        // 3. 4 Massive Iron Bolts Clamping Shut
        const bolts = [];
        const ironMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.95, roughness: 0.3 });
        const boltGeom = new THREE.CylinderGeometry(0.55, 0.55, 28, 16);
        boltGeom.rotateZ(Math.PI / 2);
        
        const directions = [
            { x: -28, y: 0, rz: 0 },
            { x: 28, y: 0, rz: 0 },
            { x: 0, y: 28, rz: Math.PI / 2 },
            { x: 0, y: -28, rz: Math.PI / 2 }
        ];

        directions.forEach(d => {
            const bolt = new THREE.Mesh(boltGeom, ironMat);
            bolt.position.set(d.x, d.y, 1.8);
            bolt.rotation.z = d.rz;
            bolt.userData = { 
                startX: d.x, 
                startY: d.y, 
                targetX: d.x > 0 ? 4.5 : (d.x < 0 ? -4.5 : 0), 
                targetY: d.y > 0 ? 4.5 : (d.y < 0 ? -4.5 : 0) 
            };
            group.add(bolt);
            bolts.push(bolt);
        });

        const startTime = performance.now();
        const traumaRef = { val: 1.5 };
        this.startLoop();
        this.activeThreats.push({
            update: (dt, now) => {
                const elapsed = (now - startTime) / 1000;
                
                // Camera screenshake - disabled per user request
                const baseY = this.isFlipped ? 6 : -6;
                this.camera.position.x = 0;
                this.camera.position.y = baseY;
                traumaRef.val = 0;

                if (explosionLight.intensity > 0) {
                    explosionLight.intensity = Math.max(0, explosionLight.intensity - dt * 60);
                }

                // Shards Physics
                shards.forEach(s => {
                    if (s.position.z < -2) return;
                    s.position.addScaledVector(s.userData.vel, dt);
                    s.rotation.x += s.userData.angVel.x * dt;
                    s.rotation.y += s.userData.angVel.y * dt;
                    s.rotation.z += s.userData.angVel.z * dt;
                    s.userData.vel.z -= 35 * dt;
                    s.userData.vel.x *= (1 - 2.5 * dt);
                    s.userData.vel.y *= (1 - 2.5 * dt);
                });

                // Slam Bolts inwards (heavy mechanical clamp)
                if (elapsed > 0.15 && elapsed < 0.32) {
                    const progress = (elapsed - 0.15) / 0.17;
                    const e = Math.pow(progress, 3);
                    bolts.forEach(b => {
                        b.position.x = b.userData.startX + (b.userData.targetX - b.userData.startX) * e;
                        b.position.y = b.userData.startY + (b.userData.targetY - b.userData.startY) * e;
                    });
                } else if (elapsed >= 0.32 && elapsed < 0.38 && traumaRef.val < 1.0) {
                    traumaRef.val = 2.0;
                    explosionLight.intensity = 80;
                }

                if (elapsed > 2.0) {
                    group.scale.setScalar(Math.max(0, 1 - (elapsed - 2.0) * 1.8));
                }

                if (elapsed > 2.8) return false;
                return true;
            },
            cleanup: () => {
                this.scene.remove(group);
                this.camera.position.set(0, -6, 15);
                shards.forEach(s => { if (s.geometry) s.geometry.dispose(); });
                bolts.forEach(b => { if (b.geometry) b.geometry.dispose(); });
                woodMat.dispose();
                ironMat.dispose();
                if (onComplete) onComplete();
            }
        });
    }

    // ==========================================
    // 3. PIECE CAPTURE COMPATIBILITY DELEGATES
    // (Trigger 3D splinters safely without crude meshes)
    // ==========================================
    playKatanaSlash3D(targetPos, onComplete) {
        this.playCaptureShatter3D(targetPos, 1.2);
        if (onComplete) setTimeout(onComplete, 350);
    }

    playCannonCapture3D(startPos, endPos, onComplete) {
        this.playCaptureShatter3D(endPos, 1.5);
        if (onComplete) setTimeout(onComplete, 450);
    }

    playHorseCapture3D(startPos, endPos, onComplete) {
        this.playCaptureShatter3D(endPos, 1.1);
        if (onComplete) setTimeout(onComplete, 400);
    }

    playChariotCapture3D(startPos, endPos, onComplete) {
        this.playCaptureShatter3D(endPos, 1.4);
        if (onComplete) setTimeout(onComplete, 350);
    }

    playElephantCapture3D(startPos, endPos, onComplete) {
        this.playCaptureShatter3D(endPos, 1.6);
        if (onComplete) setTimeout(onComplete, 400);
    }

    playSoldierCapture3D(startPos, endPos, onComplete) {
        this.playCaptureShatter3D(endPos, 0.9);
        if (onComplete) setTimeout(onComplete, 300);
    }

    playGeneralCapture3D(startPos, endPos, onComplete) {
        this.playCaptureShatter3D(endPos, 1.5);
        if (onComplete) setTimeout(onComplete, 400);
    }

    // Harmless threat stubs (eliminates flat orange discs & yellow sticks completely)
    playCannonThreat(start, end, onReady) { if (onReady) onReady(); }
    playChariotThreat(start, end, onReady) { if (onReady) onReady(); }
    playHorseThreat(start, end, onReady) { if (onReady) onReady(); }
    playSoldierThreat(start, end, onReady) { if (onReady) onReady(); }
    checkCannon(start, end, onReady) { if (onReady) onReady(); }
    checkChariot(start, end, onReady) { if (onReady) onReady(); }
    checkHorse(start, end, onReady) { if (onReady) onReady(); }
    checkSoldier(start, end, onReady) { if (onReady) onReady(); }
}

window.fx3dEngine = new FX3DEngine();
