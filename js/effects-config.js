/**
 * EFFECTS_CONFIG — Phase 1 cinematic effects system (AntiGravity Xiangqi)
 *
 * Contract (frozen):
 *   window.EFFECTS_CONFIG = {
 *     version: 1,
 *     pieces: { C: {...}, R: {...}, H: {...}, E: {...}, A: {...}, P: {...}, K: {...} }
 *   }
 *   - Piece keys are UPPERCASE single chars; the manager indexes with move.piece.toUpperCase().
 *   - Capture block shape: { durationMs, phases: [{ t, visual, audio }], colors: {...} }.
 *     t is in milliseconds; `audio` is OPTIONAL per phase (visual-only beats omit
 *     it so the scheduler never re-triggers a sound); when present it must be an
 *     exact key from the vfx.js `sfx` map. (Amended at Phase 2 integration.)
 *   - Check/checkmate blocks are Phase 3/4 placeholders; the Phase 1 manager ignores them.
 *
 * Cannon capture phases mirror js/vfx.js playCannonCapture + fx2d.playCannonBlast exactly:
 *   t=0    playSfx('cannon_charge'), playSfx('fuse_hiss'), movingEl gains 'piece-charging'
 *   t=90   setTimeout(90): playSfx('cannon_fire'), playSfx('ball_whistle'), fx2d.playCannonBlast()
 *   t=170  playCannonBlast's setTimeout(80): muzzle flash + smoke ring particles launch;
 *          shell launched with durationMs=160 (visual only — see note below)
 *   t=330  shell impact (90+80+160): playSfx('cannon_impact'), playSfx('debris_scatter'),
 *          fx3d shatter, targetEl gains 'piece-captured'
 *   t=490  setTimeout(160) after impact: cleanup / onComplete()
 *
 * NOTE: the audio phases below are pinned to the exact playSfx call sites (t=0, 90, 330).
 * The muzzle-flash *particle* itself renders at t≈170 and the detonation at t≈330 — those are
 * driven by playCannonBlast's internal setTimeout(80) + 160ms shell flight when W1's manager
 * calls aaaEngine.playCannonCapture(..., { muteInternalAudio: true }) for the visuals.
 *
 * trauma / hitStop stay 0 per binding user decision (addTrauma + hitStop are no-ops in vfx.js).
 */
window.EFFECTS_CONFIG = {
    version: 1,
    pieces: {
        C: {
            capture: {
                durationMs: 490, // 90 (fire) + 80 (flash delay) + 160 (shell flight) + 160 (settle)
                phases: [
                    { t: 0,   visual: 'barrel-elevate', audio: 'cannon_charge' },
                    { t: 0,   visual: 'fuse-spark',     audio: 'fuse_hiss' },
                    { t: 90,  visual: 'muzzle-flash',   audio: 'cannon_fire' },
                    { t: 90,  visual: 'shell-arc',      audio: 'ball_whistle' },
                    { t: 330, visual: 'impact',         audio: 'cannon_impact' },
                    { t: 330, visual: 'debris',         audio: 'debris_scatter' }
                ],
                colors: {
                    flash: '#ffffff',   // 'flash' FXParticle default ('#fff'): muzzle + core flash
                    smoke: '#808080',   // smoke particles carry no explicit color; renderer draws
                                        // a gray gradient (~rgb 45–100); mid-gray is representative
                    shockwave: '#ffcc33' // explicit color on the detonation shockwave rings
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            },
            check: {
                // Cannon check cinematic (~1500ms). The manager plays the app's
                // 「將軍!」 banner + legacy check sting first (triggerCheckBanner), then
                // runs these config-driven phases: visuals are CheckVFX method names,
                // audio keys are exact vfx.js sfx keys (optional per phase).
                //   t=0    general trembles under the threat; fuse-hiss tension
                //   t=250  cannon laser-aim locks from the cannon to the general
                //   t=600  sweat drops on the threatened general
                //   t=900  palace glow washes the side in check; smoke-hiss settle
                //   t=1200 re-lock pulse on the laser aim; shell-whistle whine
                durationMs: 1500,
                phases: [
                    { t: 0,    visual: 'trembleGeneral', audio: 'fuse_hiss' },
                    { t: 250,  visual: 'cannonLaserAim' },
                    { t: 600,  visual: 'sweatDrops' },
                    { t: 900,  visual: 'palaceGlow',     audio: 'smoke_hiss' },
                    { t: 1200, visual: 'cannonLaserAim', audio: 'ball_whistle' }
                ],
                colors: {
                    glow: '#ffcc33',   // palace alarm wash
                    laser: '#ff2222'   // cannon laser sightline
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            },
            checkmate: {
                // Cannon checkmate finale (~5500ms). The manager runs the global
                // sequence first (freeze-flash / slow-mo ramp / push-in / dim),
                // then these config-driven phases (visuals = CheckmateVFX method
                // names; audio = exact vfx.js sfx keys, optional per phase).
                //   t=0    palace explosion; cannon_fire
                //   t=700  secondary detonation rumble (audio-only)
                //   t=1400 fireworks erupt for the winner
                //   t=2300 losing general's crown falls
                //   t=2700 his flag lowers
                //   t=3100 palace crumbles
                //   t=3700 「絕殺」 calligraphy, stroke by stroke; gong
                //   t=4700 confetti + lanterns; victory sting
                durationMs: 5500,
                phases: [
                    { t: 0,    visual: 'cannonPalaceExplosion', audio: 'cannon_fire' },
                    { t: 700,  audio: 'cannon_impact' },
                    { t: 1400, visual: 'cannonFireworks',       audio: 'debris_scatter' },
                    { t: 2300, visual: 'crownFall' },
                    { t: 2700, visual: 'flagLower' },
                    { t: 3100, visual: 'palaceCrumble',         audio: 'debris_scatter' },
                    { t: 3700, visual: 'paintJueSha',           audio: 'epic_gong' },
                    { t: 4700, visual: 'celebrate',             audio: 'checkmate' }
                ],
                colors: {
                    explosion: '#ff6a00', // palace fireball core
                    shockwave: '#ffcc33', // blast shockwave ring
                    ember: '#ff3700'      // lingering embers
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            }
        },
        // Chariot capture phases mirror js/vfx.js AAAEngine.playChariotCapture exactly
        // (fx2d.playChariotCharge sub-method plays no audio of its own — verified):
        //   t=0    playSfx('chariot_capture'); Phase 1 engine rev & pullback (crimson aura)
        //   t=110  setTimeout(110): fx2d.playChariotCharge() — flaming ruby wheel tracks +
        //          directional red katana slash visuals; movingEl charges 0.18s
        //   t=290  setTimeout(180) after Phase 2: violent collision impact, 3D shatter,
        //          targetEl gains 'piece-split-cleave' (hidden at t=470)
        //   t=350  setTimeout(240) after Phase 2: settle & onComplete
        // Audio entries are pinned to the exact playSfx call sites (t=0 only);
        // visual-only phases carry no `audio` key. Engine-native total ≈350ms;
        // durationMs 1200 is the manager's cinematic window (per Phase 2 spec).
        R: {
            capture: {
                durationMs: 1200,
                phases: [
                    { t: 0,   visual: 'pullback-rev',   audio: 'chariot_capture' },
                    { t: 110, visual: 'charge-slash' },
                    { t: 290, visual: 'collision-impact' },
                    { t: 350, visual: 'settle-complete' }
                ],
                colors: {
                    flash: '#ff0033',   // crimson flash particle (fx2d.playChariotCharge)
                    smoke: '#808080',   // fire/smoke particles carry no explicit color;
                                        // renderer draws a gray gradient (~rgb 45–100)
                    shockwave: '#ff1744' // cutting crimson shockwave ring
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            },
            check: {
                // Chariot check cinematic (~1500ms). The manager plays the app's
                // 「將軍!」 banner + legacy check sting first (triggerCheckBanner), then
                // these config-driven phases (visuals = CheckVFX method names; audio =
                // exact vfx.js sfx keys, optional per phase).
                //   t=0    general trembles; blade-draw anticipation
                //   t=200  chariot energy lane ignites along the threat line
                //   t=550  sweat drops on the threatened general
                //   t=900  palace glow washes the side in check; smoke-hiss settle
                //   t=1150 lane re-ignites; fuse-hiss tension swell
                durationMs: 1500,
                phases: [
                    { t: 0,    visual: 'trembleGeneral', audio: 'katana_unsheathe' },
                    { t: 200,  visual: 'chariotLane' },
                    { t: 550,  visual: 'sweatDrops' },
                    { t: 900,  visual: 'palaceGlow',     audio: 'smoke_hiss' },
                    { t: 1150, visual: 'chariotLane',    audio: 'fuse_hiss' }
                ],
                colors: {
                    glow: '#ffcc33',   // palace alarm wash
                    lane: '#ff1744'    // chariot crimson energy lane
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            },
            checkmate: {
                // Chariot checkmate finale (~5700ms). Global sequence first (manager),
                // then these config-driven phases.
                //   t=0    palace gate smashed open; chariot_capture
                //   t=700  fullscreen katana slash; katana_unsheathe
                //   t=1400 cavalry charge sweeps the board; horse_run
                //   t=2200 splinter settle (audio-only)
                //   t=2500 crown falls; t=2900 flag lowers; t=3300 palace crumbles
                //   t=3900 「絕殺」 calligraphy (side-themed); gong
                //   t=4900 confetti + lanterns; victory sting
                durationMs: 5700,
                phases: [
                    { t: 0,    visual: 'chariotGateSmash',    audio: 'chariot_capture' },
                    { t: 700,  visual: 'katanaSlash',         audio: 'katana_unsheathe' },
                    { t: 1400, visual: 'chariotCavalrySweep',  audio: 'horse_run' },
                    { t: 2200, audio: 'debris_scatter' },
                    { t: 2500, visual: 'crownFall' },
                    { t: 2900, visual: 'flagLower' },
                    { t: 3300, visual: 'palaceCrumble',        audio: 'debris_scatter' },
                    { t: 3900, visual: 'paintJueSha',           audio: 'epic_gong' },
                    { t: 4900, visual: 'celebrate',             audio: 'checkmate' }
                ],
                colors: {
                    splinter: '#8b5a2b',  // wooden gate splinters
                    dust: '#a89f91',      // cavalry dust clouds
                    shockwave: '#ff1744'  // chariot crimson accent
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            }
        },
        // Horse capture phases mirror js/vfx.js AAAEngine.playHorseCapture exactly
        // (fx2d.playHorseStomp sub-method plays no audio of its own — verified):
        //   t=0    playSfx('horse_run'); Phase 1 orthogonal gallop to L-elbow (0.18s),
        //          dust puffs & cosmic sparks trail along Leg 1
        //   t=180  setTimeout(180): Phase 2 skyward celestial leap & turn (0.18s)
        //   t=360  setTimeout(180) after Phase 2: stopSfx('horse_run'),
        //          playSfx('horse_capture'); meteorite stomp impact —
        //          fx2d.playHorseStomp(), 3D shatter, victim squashed flat (hidden t=710)
        //   t=660  setTimeout(480) after Phase 2: settle & onComplete
        // Audio entries are pinned to the exact playSfx call sites (t=0, t=360);
        // visual-only phases carry no `audio` key. Engine-native total ≈660ms;
        // durationMs 1500 is the manager's cinematic window (per Phase 2 spec).
        H: {
            capture: {
                durationMs: 1500,
                phases: [
                    { t: 0,   visual: 'gallop-leg1',     audio: 'horse_run' },
                    { t: 180, visual: 'celestial-leap' },
                    { t: 360, visual: 'meteorite-stomp', audio: 'horse_capture' },
                    { t: 660, visual: 'settle-complete' }
                ],
                colors: {
                    flash: '#d946ef',   // magenta flash particle (fx2d.playHorseStomp)
                    smoke: '#808080',   // smoke particles carry no explicit color;
                                        // renderer draws a gray gradient (~rgb 45–100)
                    shockwave: '#a855f7' // cosmic violet ground shockwave ring
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            },
            check: {
                // Horse check cinematic (~1500ms). The manager plays the app's
                // 「將軍!」 banner + legacy check sting first (triggerCheckBanner), then
                // these config-driven phases (visuals = CheckVFX method names; audio =
                // exact vfx.js sfx keys, optional per phase).
                //   t=0    general trembles under the threat
                //   t=250  ghost L-trail flashes from the horse toward the general
                //   t=600  sweat drops on the threatened general
                //   t=900  palace glow washes the side in check; smoke-hiss settle
                //   t=1200 trail re-flash pulse
                durationMs: 1500,
                phases: [
                    { t: 0,    visual: 'trembleGeneral' },
                    { t: 250,  visual: 'horseGhostTrail' },
                    { t: 600,  visual: 'sweatDrops' },
                    { t: 900,  visual: 'palaceGlow',     audio: 'smoke_hiss' },
                    { t: 1200, visual: 'horseGhostTrail' }
                ],
                colors: {
                    glow: '#ffcc33',   // palace alarm wash
                    trail: '#d946ef'   // ghost-trail magenta (horse capture accent)
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            },
            checkmate: {
                // Horse checkmate finale (~5500ms). Global sequence first (manager),
                // then these config-driven phases.
                //   t=0    horse leaps in silhouette against the moon; horse_run
                //   t=1200 lightning strikes the palace; epic_check
                //   t=1800 landing impact (audio-only)
                //   t=2300 crown falls; t=2700 flag lowers; t=3100 palace crumbles
                //   t=3700 「絕殺」 calligraphy; gong
                //   t=4700 confetti + lanterns; victory sting
                durationMs: 5500,
                phases: [
                    { t: 0,    visual: 'horseMoonLeap',       audio: 'horse_run' },
                    { t: 1200, visual: 'horseLightningStrike', audio: 'epic_check' },
                    { t: 1800, audio: 'horse_capture' },
                    { t: 2300, visual: 'crownFall' },
                    { t: 2700, visual: 'flagLower' },
                    { t: 3100, visual: 'palaceCrumble',        audio: 'debris_scatter' },
                    { t: 3700, visual: 'paintJueSha',          audio: 'epic_gong' },
                    { t: 4700, visual: 'celebrate',            audio: 'checkmate' }
                ],
                colors: {
                    moon: '#fef9c3',     // full-moon backdrop
                    bolt: '#fef08a',     // lightning core
                    shockwave: '#a855f7' // cosmic violet accent
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            }
        },
        E: {
            capture: {
                // Timings mirrored from js/vfx.js playElephantCapture + fx2d.playElephantFissure:
                //   t=0    playSfx('elephant_capture'); Phase 1 skyward leap (gsap 0.12s, ends ~110ms)
                //   t=110  Phase 2 tectonic descent (gsap 0.12s, ends ~220ms);
                //          playElephantFissure: fissure tears diagonally over 18 steps x 180ms (110-290ms)
                //   t=220  Phase 3 monumental seismic impact (hitStop/addTrauma are no-ops per
                //          binding decision); victim gains 'piece-flattened', hidden at +180ms (t=400)
                //   t=310  fissure impact block (internal setTimeout 200ms): emerald jade flash
                //          (life 0.25s), jade shockwave (life 0.5s), secondary shockwave +80ms,
                //          scorch crater (life 2.0s, ambient), 50 emerald sparks + 24 dust clouds
                //   t=330  Phase 4 settle & complete -> onComplete()
                // durationMs 1800 covers the cinematic beat (shockwaves/dust settle by ~1010ms)
                // and most of the ambient crater fade (full 2.0s tail ends ~2310ms).
                // Visual-only phases omit `audio` (contract amendment, Phase 2 integration).
                durationMs: 1800,
                phases: [
                    { t: 0,   visual: 'skyward-leap',     audio: 'elephant_capture' },
                    { t: 110, visual: 'tectonic-descent' },
                    { t: 110, visual: 'fissure-tear' },
                    { t: 220, visual: 'seismic-impact' },
                    { t: 310, visual: 'fissure-detonate' },
                    { t: 330, visual: 'settle' }
                ],
                colors: {
                    flash: '#10b981',     // emerald jade impact flash
                    shockwave: '#10b981', // monumental tectonic jade shockwave ring
                    shockwave2: '#6ee7b7', // secondary earth shockwave
                    spark: '#34d399',    // emerald/earth sparks (end '#059669')
                    smoke: '#808080'      // fissure dust clouds carry no explicit color; mid-gray is representative
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            },
            check: { durationMs: 1500, note: 'Phase 3' },
            checkmate: { durationMs: 4500, phases: [], note: 'N/A — elephant cannot give check, so no checkmate path; manager never routes here' }
        },
        A: {
            capture: {
                // Timings mirrored from js/vfx.js playAdvisorCapture + fx2d.playKatanaSlash:
                //   t=0    playSfx('katana_unsheathe'); Phase 1 iaido crouch & shadow-dash stance
                //          (gsap 0.16s, ends ~160ms)
                //   t=180  playSfx('advisor_capture'); Phase 2 supersonic dash & slash strike
                //          (gsap 0.18s, ends ~360ms)
                //   t=280  katana slash impact (Phase 2 +100ms; hitStop/addTrauma are no-ops per
                //          binding decision): playKatanaSlash crescent arcs (life 0.55s), diagonal
                //          beam (0.46s), silver shockwave (0.42s), 60 razor sparks (up to 0.72s);
                //          victim gains 'piece-split-cleave', hidden at +350ms (t=630)
                //   t=480  Phase 3 sheathe & settle (gsap 0.18s, ends ~660ms)
                //   t=660  settle & complete -> onComplete()
                // durationMs 1200 covers the spark tail (~1000ms) and the settle (660ms).
                // Visual-only phases omit `audio` (contract amendment, Phase 2 integration).
                durationMs: 1200,
                phases: [
                    { t: 0,   visual: 'iaido-crouch',   audio: 'katana_unsheathe' },
                    { t: 180, visual: 'shadow-dash',    audio: 'advisor_capture' },
                    { t: 280, visual: 'katana-slash' },
                    { t: 480, visual: 'sheathe-settle' }
                ],
                colors: {
                    flash: '#00ffff',     // blinding cyan/white radial flash
                    blade: '#00f5ff',     // colossal crescent katana arc + diagonal slice beam
                    blade2: '#38bdf8',    // counter-slash crescent arc
                    shockwave: '#e0f2fe', // heavy expanding silver shockwave ring
                    spark: '#ffffff'      // incandescent razor sparks (alt '#38bdf8', end '#0284c7')
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            },
            check: { durationMs: 1500, note: 'Phase 3' },
            checkmate: { durationMs: 4500, phases: [], note: 'N/A — advisor cannot give check, so no checkmate path; manager never routes here' }
        },
        /* Soldier (P) capture phases mirror js/vfx.js playSoldierCapture + fx2d.playSoldierThrust:
         *   t=0    playSfx('soldier_capture'); Phase 1 drawback stance 0–80ms
         *          (gsap 0.08s: pull-back -dc*14, scale 1.15, #ff5500 crimson glow)
         *   t=80   Phase 2 lunge 80–190ms (gsap 0.11s) + playSoldierThrust:
         *          220px solar beam (#ff5500, life 0.48) + 17-spark trail (#ffa500→#ff3700)
         *   t=180  Phase 3 impact (Thrust setTimeout 140): flash r75 #ff5500 (life 0.22),
         *          shockwave #ff7700 (life 0.38), 45 piercing sparks (life 0.42),
         *          'piece-skewered', playCaptureShatter3D; hitStop(90)/addTrauma(0.85) are no-ops
         *   t=280  Phase 4 settle → onComplete()
         * Cinematic stretch ×4 maps the source beat grid [0,80,180,280] onto
         * [0,320,720,1120]; durationMs 1400 gives the settle beat a 280ms tail,
         * covering the impact spark tail (720+420=1140).
         * Audio: the source's single playSfx('soldier_capture') at t=0 is re-anchored
         * to the thrust beat in the stretched timeline; 'katana_unsheathe' (clean
         * blade-draw character) covers the anticipation stance; 'debris_scatter'
         * is the game's generic wood-splinter cue for the skewer shatter;
         * 'smoke_hiss' carries the follow-through dust settle.
         * trauma / hitStop absent per binding user decision (no-ops in vfx.js). */
        P: {
            capture: {
                durationMs: 1400, // ×4 stretch of source beats [0,80,180,280] + 280ms settle tail
                phases: [
                    { t: 0,   visual: 'drawback-stance',  audio: 'katana_unsheathe' },
                    { t: 320, visual: 'spear-thrust',     audio: 'soldier_capture' },
                    { t: 720, visual: 'impale-flash',     audio: 'debris_scatter' },
                    { t: 720, visual: 'thrust-shockwave', audio: 'smoke_hiss' }
                ],
                colors: {
                    flash: '#ff5500',   // solar thrust flash particle (explicit in playSoldierThrust)
                    smoke: '#808080',   // neutral gray; no smoke particle in source — used for
                                        // ambient dust from the skewer shatter
                    shockwave: '#ff7700' // molten-orange thrust shockwave (explicit in playSoldierThrust)
                }
            },
            check: {
                // Soldier check cinematic (~1500ms). The manager plays the app's
                // 「將軍!」 banner + legacy check sting first (triggerCheckBanner), then
                // these config-driven phases (visuals = CheckVFX method names; audio =
                // exact vfx.js sfx keys, optional per phase).
                //   t=0    general trembles under the threat
                //   t=250  soldier lowers spear toward the general; squad silhouette
                //   t=600  sweat drops on the threatened general
                //   t=900  palace glow washes the side in check; smoke-hiss settle
                //   t=1200 spear re-level pulse
                durationMs: 1500,
                phases: [
                    { t: 0,    visual: 'trembleGeneral' },
                    { t: 250,  visual: 'soldierAim' },
                    { t: 600,  visual: 'sweatDrops' },
                    { t: 900,  visual: 'palaceGlow',     audio: 'smoke_hiss' },
                    { t: 1200, visual: 'soldierAim' }
                ],
                colors: {
                    glow: '#ffcc33',   // palace alarm wash
                    spear: '#e8e8e8'   // lowered spear glint
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            },
            checkmate: {
                // Soldier checkmate finale (~5000ms) — quiet, then dramatic.
                // Global sequence first (manager), then these config-driven phases.
                //   t=0    golden spotlight finds the tiny soldier; soldier_check
                //   t=1500 other pieces bow
                //   t=2300 crown falls; t=2700 flag lowers
                //   t=3100 palace crumbles; smoke-hiss settle
                //   t=3700 「絕殺」 calligraphy; gong
                //   t=4500 confetti + lanterns; victory sting
                // "Tiny but mighty" tagline is rendered by the soldierSpotlight visual.
                durationMs: 5000,
                phases: [
                    { t: 0,    visual: 'soldierSpotlight', audio: 'soldier_check' },
                    { t: 1500, visual: 'soldierBow' },
                    { t: 2300, visual: 'crownFall' },
                    { t: 2700, visual: 'flagLower' },
                    { t: 3100, visual: 'palaceCrumble',   audio: 'smoke_hiss' },
                    { t: 3700, visual: 'paintJueSha',     audio: 'epic_gong' },
                    { t: 4500, visual: 'celebrate',       audio: 'checkmate' }
                ],
                colors: {
                    spotlight: '#ffd700', // golden spotlight
                    glow: '#fff7cc'       // rising golden aura
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            }
        },
        /* General (K) capture phases mirror js/vfx.js playGeneralCapture + fx2d.playGeneralSeal:
         *   t=0    playSfx('general_capture'); Phase 1 Imperial Ascent 0–110ms
         *          (gsap 0.11s: scale 1.4, y −42, #dc2626 + #9333ea glow)
         *   t=110  Phase 2 Seal Stampdown 110–220ms (gsap 0.11s, power4.in)
         *   t=210  Phase 3 Monumental Impact: playGeneralSeal — flash r85 #dc2626
         *          (life 0.25), scorch crater r46 (life 2.5s), 60 jewel sparks
         *          (life 0.48), triple shockwave rings at +0/+70/+140ms
         *          (#dc2626, #9333ea, #ffd700; life 0.45), 'piece-captured',
         *          playCaptureShatter3D; hitStop(110)/addTrauma(1.2) are no-ops
         *   t=310  Phase 4 Settle & Complete → onComplete()
         * Cinematic stretch ×4 maps the source beat grid [0,110,210,310] onto
         * [0,440,840,1240] and the seal's internal ring delays [0,70,140] onto
         * [840,1120,1400]; durationMs 2000 clears the final gold ring
         * (1400+450=1850). The 2.5s scorch crater tail outlives the window —
         * same convention as the cannon's particle tails past its 490ms.
         * Audio: the source's playSfx('general_capture') at t=0 is re-anchored to
         * the stampdown beat; 'epic_gong' carries the imperial ascent;
         * 'debris_scatter' is the generic splinter cue for the seal slam;
         * 'smoke_hiss' retriggers under each ring for the scorch smolder.
         * trauma / hitStop absent per binding user decision (no-ops in vfx.js). */
        K: {
            capture: {
                durationMs: 2000, // ×4 stretch of source beats [0,110,210,310] + rings [840,1120,1400] + 600ms tail
                phases: [
                    { t: 0,    visual: 'imperial-ascent',     audio: 'epic_gong' },
                    { t: 440,  visual: 'seal-stampdown',      audio: 'general_capture' },
                    { t: 840,  visual: 'seal-flash',          audio: 'debris_scatter' },
                    { t: 840,  visual: 'seal-ring-carmine',   audio: 'smoke_hiss' },
                    { t: 1120, visual: 'seal-ring-purple',    audio: 'smoke_hiss' },
                    { t: 1400, visual: 'seal-ring-gold',      audio: 'smoke_hiss' }
                ],
                colors: {
                    flash: '#dc2626',   // Royal Imperial Flash (explicit in playGeneralSeal)
                    smoke: '#808080',   // neutral gray; no smoke particle in source — used for
                                        // ambient scorch dust from the seal crater
                    shockwave: '#ffd700' // celestial-gold final ring of the triple imperial shockwave
                }
            },
            check: { durationMs: 1500, note: 'Phase 3' },
            checkmate: { durationMs: 4500, phases: [], note: 'Routes to flyingGeneral — generals mate only via flying capture (manager maps K to flyingGeneral)' }
        },
        // Flying-general check: not a normal piece — the manager addresses it as
        // pieces.flyingGeneral when a check event carries pieceKey 'flyingGeneral',
        // and W1's _onCapture plays the duel as the cinematic variant when a general
        // captures the enemy general along a file. (Generals facing is illegal as a
        // resting position, so the check trigger is rare by construction.)
        flyingGeneral: {
            check: {
                durationMs: 1500,
                phases: [
                    { t: 0,    visual: 'trembleGeneral',     audio: 'flying_general_check' },
                    { t: 0,    visual: 'palaceGlow' },
                    { t: 200,  visual: 'flyingGeneralDuel' },
                    { t: 500,  visual: 'sweatDrops' },
                    { t: 1450, visual: 'clearAll' }
                ],
                colors: {
                    bolt: '#fef08a',   // lightning core (fx-check-bolt stroke)
                    glow: '#ef4444',   // bolt aura, palace glow, tremble danger aura
                    sweat: '#7dd3fc'   // sweat droplet glow
                }
            },
            checkmate: {
                // Flying-general checkmate finale (~5000ms) — samurai duel.
                // Global sequence first (manager), then these config-driven phases.
                //   t=0    slash line across the screen; duel sting
                //   t=1200 sword-ring shimmer (audio-only)
                //   t=2000 crown falls; t=2400 flag lowers; t=2800 palace crumbles
                //   t=3400 「絕殺」 calligraphy; gong
                //   t=4300 confetti + lanterns; victory sting
                durationMs: 5000,
                phases: [
                    { t: 0,    visual: 'flyingDuelSlash', audio: 'flying_general_check' },
                    { t: 1200, audio: 'katana_unsheathe' },
                    { t: 2000, visual: 'crownFall' },
                    { t: 2400, visual: 'flagLower' },
                    { t: 2800, visual: 'palaceCrumble',  audio: 'debris_scatter' },
                    { t: 3400, visual: 'paintJueSha',    audio: 'epic_gong' },
                    { t: 4300, visual: 'celebrate',      audio: 'checkmate' }
                ],
                colors: {
                    slash: '#ffffff',  // duel slash line
                    bolt: '#fef08a',   // lightning aura (duel motif)
                    ink: '#111111'     // calligraphy ink
                }
                // trauma: 0, hitStop: 0 — disabled per binding user decision (no-ops in vfx.js)
            }
        },
    }
};
