var soundFx = (typeof window !== 'undefined' && window.soundFx) ? window.soundFx : new Proxy({}, { get: () => () => {} });

/**
 * Xiangqi Modern Offline 2-Player Application Controller
 * - Original Chinese UI text & notation
 * - Fixed screen orientation (no flipping)
 * - Fluid click lift & move slide animations
 * - Dynamic enemy takeout explosion with impact shockwave & board shake
 */

class XiangqiApp {
    constructor() {
        this.game = new (window.XiangqiGame || XiangqiGame)();
        this.selectedSquare = null;
        this.legalMovesForSelected = [];
        this.pieceStyle = 'characters'; // 'characters' | 'pictograms' | 'english_letters'
        this.isAnimating = false;
        this.isFlipped = false;
        this.playerSide = null; // 'red' | 'black' | 'spectator'
        this.multiplayerMode = false;

        // Clocks (seconds)
        this.timeMode = 'unlimited'; // 'unlimited' | '3min' | '5min' | '10min'
        this.clocks = { red: 0, black: 0 };
        this.timerInterval = null;

        // DOM elements
        this.boardOuter = document.getElementById('boardOuter');
        this.boardLayer = document.getElementById('boardLayer');
        this.checkBanner = document.getElementById('checkBanner');
        this.cardRed = document.getElementById('cardRed');
        this.cardBlack = document.getElementById('cardBlack');
        this.clockRed = document.getElementById('clockRed');
        this.clockBlack = document.getElementById('clockBlack');
        this.trayRed = document.getElementById('trayRed');
        this.trayBlack = document.getElementById('trayBlack');
        this.historyList = document.getElementById('historyList');
        this.modal = document.getElementById('gameOverModal');

        this.init();
    }

    init() {
        this.setupBoardSVG();
        this.setupEventListeners();
        this.resetGame();
    }

    setupBoardSVG() {
        const svg = document.getElementById('boardSvg');
        svg.setAttribute('shape-rendering', 'geometricPrecision');
        svg.setAttribute('text-rendering', 'geometricPrecision');
        // Grid coordinates: viewBox 0 0 400 450
        // 9 columns from x=20 to x=380 (dx = 45)
        // 10 rows from y=20 to y=425 (dy = 45)
        let markup = '';

        // Subtle oriental plum blossom watermark branches (in corners matching reference image)
        markup += `
        <g class="board-watermark" pointer-events="none">
            <!-- Top-Left Blossom Silhouette -->
            <path d="M-6 -6 Q35 20 65 75 Q82 105 70 145 M30 18 Q55 12 78 26 M50 48 Q85 56 102 78 M16 42 Q8 68 20 95" stroke="#5a2c0c" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.18"/>
            <circle cx="65" cy="75" r="4.2" fill="#6a3512" opacity="0.2"/>
            <circle cx="78" cy="26" r="3.8" fill="#6a3512" opacity="0.18"/>
            <circle cx="102" cy="78" r="4.6" fill="#6a3512" opacity="0.22"/>
            <circle cx="20" cy="95" r="3.2" fill="#6a3512" opacity="0.18"/>
            <circle cx="40" cy="32" r="2.8" fill="#6a3512" opacity="0.16"/>

            <!-- Bottom-Right Blossom Silhouette -->
            <path d="M406 456 Q365 430 335 375 Q318 345 330 305 M370 432 Q345 438 322 424 M350 402 Q315 394 298 372 M384 408 Q392 382 380 355" stroke="#5a2c0c" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.18"/>
            <circle cx="335" cy="375" r="4.2" fill="#6a3512" opacity="0.2"/>
            <circle cx="322" cy="424" r="3.8" fill="#6a3512" opacity="0.18"/>
            <circle cx="298" cy="372" r="4.6" fill="#6a3512" opacity="0.22"/>
            <circle cx="380" cy="355" r="3.2" fill="#6a3512" opacity="0.18"/>
            <circle cx="360" cy="418" r="2.8" fill="#6a3512" opacity="0.16"/>
        </g>`;

        // Border rectangle
        markup += `<rect x="16" y="16" width="368" height="413" fill="none" class="border-line"/>`;
        markup += `<rect x="20" y="20" width="360" height="405" fill="none" class="grid-line" stroke-width="2"/>`;

        // Horizontal lines
        for (let r = 0; r < 10; r++) {
            const y = 20 + r * 45;
            markup += `<line x1="20" y1="${y}" x2="380" y2="${y}" class="grid-line"/>`;
        }

        // Vertical lines (split at river between r=4 and r=5)
        for (let c = 0; c < 9; c++) {
            const x = 20 + c * 45;
            if (c === 0 || c === 8) {
                // Outer edges run continuously
                markup += `<line x1="${x}" y1="20" x2="${x}" y2="425" class="grid-line"/>`;
            } else {
                // Top half (black camp)
                markup += `<line x1="${x}" y1="20" x2="${x}" y2="200" class="grid-line"/>`;
                // Bottom half (red camp)
                markup += `<line x1="${x}" y1="245" x2="${x}" y2="425" class="grid-line"/>`;
            }
        }

        // Palaces (diagonal cross lines)
        // Black Palace: (3,0) to (5,2)
        markup += `<line x1="${20 + 3*45}" y1="20" x2="${20 + 5*45}" y2="${20 + 2*45}" class="grid-line"/>`;
        markup += `<line x1="${20 + 5*45}" y1="20" x2="${20 + 3*45}" y2="${20 + 2*45}" class="grid-line"/>`;

        // Red Palace: (3,7) to (5,9)
        markup += `<line x1="${20 + 3*45}" y1="${20 + 7*45}" x2="${20 + 5*45}" y2="${20 + 9*45}" class="grid-line"/>`;
        markup += `<line x1="${20 + 5*45}" y1="${20 + 7*45}" x2="${20 + 3*45}" y2="${20 + 9*45}" class="grid-line"/>`;

        // River text: 楚 河 (left) / 漢 界 (right) centered in the river
        markup += `<text x="110" y="222.5" dominant-baseline="central" text-anchor="middle" class="river-text">楚 河</text>`;
        markup += `<text x="290" y="222.5" dominant-baseline="central" text-anchor="middle" class="river-text">漢 界</text>`;

        // Position crosshairs (Corners around cannons and soldiers)
        const starPositions = [
            // Cannons
            [2, 1], [2, 7], [7, 1], [7, 7],
            // Soldiers
            [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
            [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]
        ];

        for (const [r, c] of starPositions) {
            markup += this.createCornerMarks(20 + c * 45, 20 + r * 45, c === 0, c === 8);
        }

        // Board Index Numbers (Top: 1-9 for Black files; Bottom: 9-1 for Red files)
        // Printed cleanly right above / below each grid line intersection matching reference image
        markup += `<g class="board-index-group" pointer-events="none">`;
        for (let c = 0; c < 9; c++) {
            const x = 20 + c * 45;
            // Top numbers (1..9 above row 0)
            markup += `<text x="${x}" y="-11" dominant-baseline="central" text-anchor="middle" class="board-index-num">${c + 1}</text>`;
            // Bottom numbers (9..1 below row 9)
            markup += `<text x="${x}" y="461" dominant-baseline="central" text-anchor="middle" class="board-index-num">${9 - c}</text>`;
        }
        markup += `</g>`;

        svg.innerHTML = markup;
    }

    createCornerMarks(cx, cy, isLeftEdge = false, isRightEdge = false) {
        const d = 4;
        const len = 7;
        let s = '';

        // Top-left
        if (!isLeftEdge) {
            s += `<path d="M${cx - d - len} ${cy - d} L${cx - d} ${cy - d} L${cx - d} ${cy - d - len}" class="star-mark"/>`;
            // Bottom-left
            s += `<path d="M${cx - d - len} ${cy + d} L${cx - d} ${cy + d} L${cx - d} ${cy + d + len}" class="star-mark"/>`;
        }

        // Top-right
        if (!isRightEdge) {
            s += `<path d="M${cx + d + len} ${cy - d} L${cx + d} ${cy - d} L${cx + d} ${cy - d - len}" class="star-mark"/>`;
            // Bottom-right
            s += `<path d="M${cx + d + len} ${cy + d} L${cx + d} ${cy + d} L${cx + d} ${cy + d + len}" class="star-mark"/>`;
        }

        return s;
    }

    setupEventListeners() {
        // New Game Button
        document.getElementById('btnNewGame').addEventListener('click', () => this.resetGame());
        document.getElementById('modalBtnRestart').addEventListener('click', () => {
            this.modal.classList.remove('open');
            this.resetGame();
        });
        
        const modalBtnReplay = document.getElementById('modalBtnReplay');
        if (modalBtnReplay) {
            modalBtnReplay.addEventListener('click', () => {
                this.modal.classList.remove('open');
                this.handleUndo();
            });
        }

        // Undo Button
        document.getElementById('btnUndo').addEventListener('click', () => this.handleUndo());

        // Sound Toggle
        const soundToggle = document.getElementById('soundToggle');
        if (soundToggle) {
            soundToggle.addEventListener('change', (e) => {
                soundFx.enabled = e.target.checked;
            });
        }

        // Theme Selector
        const themeSelect = document.getElementById('themeSelect');
        if (themeSelect) {
            themeSelect.value = document.documentElement.getAttribute('data-theme') || 'sandalwood';
            themeSelect.addEventListener('change', (e) => {
                document.documentElement.setAttribute('data-theme', e.target.value);
            });
        }

        // Time Control Selector
        const timerSelect = document.getElementById('timerSelect');
        if (timerSelect) {
            timerSelect.addEventListener('change', (e) => {
                this.timeMode = e.target.value;
                this.resetClocks();
            });
        }

        // Fullscreen Toggle Button & Handlers
        const btnFullscreen = document.getElementById('btnFullscreen');
        if (btnFullscreen) {
            btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
        }
        document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
        document.addEventListener('webkitfullscreenchange', () => this.onFullscreenChange());

        // Flip Board Perspective Button
        const btnFlip = document.getElementById('btnFlipBoard');
        if (btnFlip) {
            btnFlip.addEventListener('click', () => this.toggleFlip());
        }

        // Empty board click to deselect
        if (this.boardOuter) {
            this.boardOuter.addEventListener('click', (e) => {
                if (this.selectedSquare && !e.target.closest('.piece-wrap, .marker-wrap')) {
                    this.selectedSquare = null;
                    this.legalMovesForSelected = [];
                    this.render();
                }
            });
        }
    }

    setFlipped(flipped) {
        this.isFlipped = !!flipped;
        if (this.boardOuter) {
            this.boardOuter.classList.toggle('flipped', this.isFlipped);
        }
        if (window.fx3dEngine && typeof window.fx3dEngine.setFlipped === 'function') {
            window.fx3dEngine.setFlipped(this.isFlipped);
        }
        const btnFlip = document.getElementById('btnFlipBoard');
        if (btnFlip) {
            btnFlip.classList.toggle('active', this.isFlipped);
        }
    }

    toggleFlip() {
        this.setFlipped(!this.isFlipped);
    }

    toggleFullscreen() {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            const el = document.documentElement;
            if (el.requestFullscreen) {
                el.requestFullscreen().catch(err => console.warn('Fullscreen request failed:', err));
            } else if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(err => console.warn('Exit fullscreen failed:', err));
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    }

    onFullscreenChange() {
        const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
        document.body.classList.toggle('fullscreen-mode', isFs);
        const btn = document.getElementById('btnFullscreen');
        if (btn) {
            btn.innerHTML = isFs ? '<span>🗗</span> Exit' : '<span>⛶</span> Fullscreen';
            btn.title = isFs ? 'Exit Fullscreen' : 'Toggle Fullscreen';
        }
    }

    resetForRematch(board = null, turn = RED) {
        // A fresh board is a fresh game for the effects manager too: wipe any
        // lingering checkmate-finale overlays (palace cracks, banner, ...) so
        // a rematch never starts with the previous game's destruction visible.
        if (window.effectsManager && typeof window.effectsManager.notifyNewGame === 'function') {
            try { window.effectsManager.notifyNewGame(); } catch (err) {}
        }
        // 1. Kill any active GSAP tweens on board, pieces and overlays
        if (typeof gsap !== 'undefined') {
            gsap.killTweensOf('#boardOuter');
            gsap.killTweensOf('.piece-wrap');
            gsap.killTweensOf('.cinematic-vignette');
            gsap.killTweensOf('.check-vignette');
        }

        // 2. Clear all dark filters, freeze-frames, dims, and shakes
        if (this.boardOuter) {
            this.boardOuter.style.filter = '';
            this.boardOuter.classList.remove(
                'board-dimmed', 'freeze-frame', 'camera-zoom-palace', 
                'palace-in-check', 'board-shake', 'board-shake-mega', 'checked'
            );
            // Remove any dynamic checkmate text/flash elements
            const dynamicEls = this.boardOuter.querySelectorAll('.impact-flash, .falling-crown, .checkmate-calligraphy-text, .soldier-powerup-banner, [style*="z-index: 1000"]');
            dynamicEls.forEach(el => el.remove());
        }

        // 3. Deactivate all vignette overlays completely
        document.querySelectorAll('.cinematic-vignette, .check-vignette').forEach(el => {
            el.classList.remove('active');
            el.style.opacity = '';
        });

        // 4. Hide banners and modals
        if (this.checkBanner) this.checkBanner.classList.remove('show');
        const stamp = document.getElementById('checkmateStamp');
        if (stamp) stamp.classList.remove('show');
        if (this.modal) this.modal.classList.remove('open');
        const gameOverModal = document.getElementById('gameOverModal');
        if (gameOverModal) gameOverModal.classList.remove('open');

        // 5. Clear 3D/2D VFX engines
        if (window.fx3dEngine) window.fx3dEngine.clearThreats();
        if (window.vfxEngine && window.vfxEngine.fx2d) window.vfxEngine.fx2d.clear();

        // 6. Reset interactive states so board is IMMEDIATELY responsive
        this.isAnimating = false;
        this.selectedSquare = null;
        this.legalMovesForSelected = [];
        this.pendingMoveQueue = [];

        // 7. Reset game state safely
        if (!this.game) {
            this.game = new (window.XiangqiGame || XiangqiGame)();
        }
        if (board && Array.isArray(board) && board.length === 10) {
            this.game.board = board.map(row => [...row]);
        } else if (typeof this.game.createInitialBoard === 'function') {
            this.game.board = this.game.createInitialBoard();
        } else if (typeof this.game.getInitialBoard === 'function') {
            this.game.board = this.game.getInitialBoard();
        } else {
            this.game.board = (new (window.XiangqiGame || XiangqiGame)()).board;
        }
        this.game.turn = turn || RED;
        this.game.gameOver = false;
        this.game.winner = null;
        this.game.winReason = null;
        this.game.lastMove = null;
        this.game.history = [];
        this.game.captured = { red: [], black: [] };

        this.render();
    }

    resetGame() {
        // Phase 2: reset the announcer's per-game capture history (guarded).
        if (window.effectsManager && typeof window.effectsManager.notifyNewGame === 'function') {
            try { window.effectsManager.notifyNewGame(); } catch (err) {}
        }
        this.resetForRematch();
        this.resetClocks();
    }

    startClock() {
        clearInterval(this.timerInterval);
        if (this.timeMode !== 'unlimited' && !this.game.gameOver) {
            this.timerInterval = setInterval(() => this.tickClock(), 1000);
        }
    }

    stopClock() {
        clearInterval(this.timerInterval);
    }

    resetClocks() {
        clearInterval(this.timerInterval);
        const modeSeconds = {
            'unlimited': 0,
            '3min': 180,
            '5min': 300,
            '10min': 600
        };
        const s = modeSeconds[this.timeMode] || 0;
        this.clocks.red = s;
        this.clocks.black = s;
        this.updateClockDisplays();

        if (this.timeMode !== 'unlimited') {
            this.startClock();
        }
    }

    tickClock() {
        if (this.game.gameOver || this.timeMode === 'unlimited') return;
        const currentTurn = this.game.turn;
        if (this.clocks[currentTurn] > 0) {
            this.clocks[currentTurn]--;
            this.updateClockDisplays();
            if (this.clocks[currentTurn] === 0 && !this.multiplayerMode) {
                // Time Out loss (local single player; in multiplayer mode, the server authoritatively handles timeout)
                this.game.gameOver = true;
                this.game.winner = currentTurn === RED ? BLACK : RED;
                this.game.winReason = 'timeout';
                soundFx.playVictory();
                this.showGameOverModal();
            }
        }
    }

    updateClockDisplays() {
        const formatTime = (secs) => {
            if (this.timeMode === 'unlimited') return '∞';
            const m = Math.floor(secs / 60).toString().padStart(2, '0');
            const s = (secs % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        };
        this.clockRed.textContent = formatTime(this.clocks.red);
        this.clockBlack.textContent = formatTime(this.clocks.black);
    }

    render() {
        if (!this.game) {
            this.game = new (window.XiangqiGame || XiangqiGame)();
        }
        if (!this.game.board || !Array.isArray(this.game.board) || this.game.board.length !== 10) {
            this.game.board = typeof this.game.createInitialBoard === 'function'
                ? this.game.createInitialBoard()
                : (new (window.XiangqiGame || XiangqiGame)()).board;
        }

        this.boardLayer.innerHTML = '';

        // 1. Render Last Move Highlights for BOTH sides (Red & Black persist simultaneously)
        const lastMoves = this.getLastMovesBySide();
        const latestSide = (this.game.lastMove && this.game.lastMove.piece) ? this.game.getPieceColor(this.game.lastMove.piece) : null;

        // Render the previous side's move first, then the latest side on top
        const sidesToRender = latestSide === 'red' ? ['black', 'red'] : ['red', 'black'];
        for (const s of sidesToRender) {
            const m = lastMoves[s];
            if (m && m.from && m.to) {
                const isCurrent = s === latestSide;
                this.renderLastMoveDot(m.from, false, s, isCurrent);
                this.renderLastMoveDot(m.to, true, s, isCurrent);
            }
        }

        // 2. Render Pieces
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const piece = this.game.board[r][c];
                if (piece) {
                    this.renderPiece(r, c, piece);
                }
            }
        }

        // 3. Render Move Hints
        if (this.selectedSquare) {
            for (const move of this.legalMovesForSelected) {
                this.renderMoveMarker(move);
            }
        }

        // 4. Update HUD Player Cards
        const isRedTurn = this.game.turn === RED;
        this.cardRed.classList.toggle('active', isRedTurn && !this.game.gameOver);
        this.cardBlack.classList.toggle('active', !isRedTurn && !this.game.gameOver);

        // Update Multiplayer Turn Banner
        const bannerEl = document.getElementById('mpTurnBanner');
        const badgeEl = document.getElementById('mpTurnBadge');
        const detailsEl = document.getElementById('mpTurnDetails');
        if (bannerEl && badgeEl && detailsEl) {
            if (this.multiplayerMode) {
                bannerEl.style.display = 'flex';
                const mySide = this.playerSide; // 'red' | 'black' | 'spectator'
                const isMyTurn = mySide === this.game.turn;
                const turnNameZh = this.game.turn === RED ? 'Red (帥)' : 'Black (將)';
                const mySideZh = mySide === 'red' ? 'RED (帥)' : mySide === 'black' ? 'BLACK (將)' : 'Spectator';

                if (this.game.gameOver) {
                    bannerEl.className = 'mp-turn-banner opponent-turn';
                    badgeEl.className = 'mp-turn-badge badge-opponent-turn';
                    badgeEl.textContent = '🏁 Game Over';
                    detailsEl.textContent = this.game.winner ? `${this.game.winner === 'red' ? 'Red' : 'Black'} Won!` : 'Draw!';
                } else if (mySide === 'spectator') {
                    bannerEl.className = 'mp-turn-banner opponent-turn';
                    badgeEl.className = 'mp-turn-badge badge-opponent-turn';
                    badgeEl.textContent = '👀 Spectating';
                    detailsEl.textContent = `${turnNameZh}'s Turn`;
                } else if (isMyTurn) {
                    bannerEl.className = 'mp-turn-banner my-turn';
                    badgeEl.className = 'mp-turn-badge badge-my-turn';
                    badgeEl.textContent = '⚔️ YOUR TURN';
                    detailsEl.textContent = `You are ${mySideZh} · Click your piece to move`;
                } else {
                    bannerEl.className = 'mp-turn-banner opponent-turn';
                    badgeEl.className = 'mp-turn-badge badge-opponent-turn';
                    badgeEl.textContent = '⏳ Opponent Turn';
                    detailsEl.textContent = `You are ${mySideZh} · Waiting for ${turnNameZh}...`;
                }
            } else {
                bannerEl.style.display = 'none';
            }
        }

        // 5. Update Captured Trays
        this.renderCapturedTrays();

        // 6. Update Move History
        this.renderMoveHistory();

        // 7. Check state (animated in executeMove)
        const inCheck = this.game.isCheck(this.game.turn);
        const checkVignette = document.getElementById('checkVignette');
        if (inCheck && !this.game.gameOver) {
            if (checkVignette) checkVignette.classList.add('active');
            this.boardOuter.classList.add('palace-in-check');
        } else {
            this.checkBanner.classList.remove('show');
            if (checkVignette) checkVignette.classList.remove('active');
            this.boardOuter.classList.remove('palace-in-check');
        }
    }

    renderPiece(r, c, piece) {
        const wrap = document.createElement('div');
        const pieceColor = this.game.getPieceColor(piece);
        wrap.className = 'piece-wrap';
        wrap.dataset.row = r;
        wrap.dataset.col = c;
        wrap.dataset.color = pieceColor;
        wrap.style.left = `${5 + c * 11.25}%`;
        wrap.style.top = `${4.444 + r * 10}%`;

        // Check if selected with side-specific aura
        if (this.selectedSquare && this.selectedSquare.r === r && this.selectedSquare.c === c) {
            wrap.classList.add('selected');
            wrap.classList.add(`selected-${pieceColor}`);
        }

        // Check if king in check
        const isKing = piece.toUpperCase() === 'K';
        if (isKing && pieceColor === this.game.turn && this.game.isCheck(this.game.turn)) {
            wrap.classList.add('king-in-check');
        }

        wrap.innerHTML = (window.PieceRenderer || PieceRenderer).getSVG(piece, this.pieceStyle);

        wrap.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleSquareClick(r, c);
        });

        this.boardLayer.appendChild(wrap);
    }

    renderMoveMarker(move) {
        const wrap = document.createElement('div');
        const activeSide = this.game.turn; // 'red' or 'black'
        wrap.className = `marker-wrap marker-${activeSide}`;
        wrap.style.left = `${5 + move.to.c * 11.25}%`;
        wrap.style.top = `${4.444 + move.to.r * 10}%`;

        if (move.captured) {
            wrap.innerHTML = `<div class="capture-ring ring-${activeSide}"></div>`;
        } else {
            wrap.innerHTML = `<div class="move-dot dot-${activeSide}"></div>`;
        }

        wrap.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.multiplayerMode && this.onMultiplayerMoveIntent) {
                this.onMultiplayerMoveIntent(move);
                this.selectedSquare = null;
                this.legalMovesForSelected = [];
                this.updateSelectionAndMarkers();
                return;
            }
            this.executeMove(move);
        });

        this.boardLayer.appendChild(wrap);
    }

    updateSelectionAndMarkers() {
        // Fast-path: Update selection & hints in O(1) without destroying the board DOM
        this.boardLayer.querySelectorAll('.marker-wrap').forEach(m => m.remove());

        this.boardLayer.querySelectorAll('.piece-wrap').forEach(el => {
            const r = parseInt(el.dataset.row, 10);
            const c = parseInt(el.dataset.col, 10);
            if (this.selectedSquare && this.selectedSquare.r === r && this.selectedSquare.c === c) {
                const color = el.dataset.color || (this.game.board[r] && this.game.getPieceColor(this.game.board[r][c]));
                el.classList.add('selected', `selected-${color}`);
            } else {
                el.classList.remove('selected', 'selected-red', 'selected-black');
            }
        });

        if (this.selectedSquare && this.legalMovesForSelected) {
            for (const move of this.legalMovesForSelected) {
                this.renderMoveMarker(move);
            }
        }
    }

    renderLastMoveDot(pos, isDestination = false, side = 'red', isCurrent = true) {
        const marker = document.createElement('div');
        marker.className = `last-move-marker ${isDestination ? 'is-dest' : 'is-from'} side-${side} ${isCurrent ? 'is-current' : 'is-previous'}`;
        marker.style.left = `${5 + pos.c * 11.25}%`;
        marker.style.top = `${4.444 + pos.r * 10}%`;
        marker.innerHTML = `<div class="last-move-dot ${isDestination ? 'dest-dot' : 'from-dot'} dot-${side}"></div>`;
        this.boardLayer.appendChild(marker);
    }

    getLastMovesBySide() {
        const res = { red: null, black: null };
        if (this.game.lastMove && this.game.lastMove.piece) {
            const side = this.game.getPieceColor(this.game.lastMove.piece);
            res[side] = this.game.lastMove;
        }
        if (this.game.history && this.game.history.length > 0) {
            for (let i = this.game.history.length - 1; i >= 0; i--) {
                const h = this.game.history[i];
                const m = h.move;
                if (m && m.piece) {
                    const s = this.game.getPieceColor(m.piece);
                    if (!res[s]) {
                        res[s] = m;
                    }
                }
                if (res.red && res.black) break;
            }
        }
        return res;
    }

    renderCapturedTrays() {
        // Graveyard fade-in (Phase 2): game.captured lists are append-only in
        // rules.js (push on capture; reset on new game; undo restores a shorter
        // snapshot). Any index at/above the previously rendered count is a
        // newly captured piece and gets the `captured-entering` class (300ms
        // fade+rise keyframes in style.css; disabled under
        // prefers-reduced-motion). A shorter list (new game / undo) animates
        // nothing.
        const renderTray = (trayEl, capturedList, countKey) => {
            const prevCount = this[countKey] || 0;
            const newStart = capturedList.length > prevCount ? prevCount : capturedList.length;
            trayEl.innerHTML = capturedList
                .map((p, i) => `<div class="captured-mini${i >= newStart ? ' captured-entering' : ''}">${(window.PieceRenderer || PieceRenderer).getSVG(p, this.pieceStyle)}</div>`)
                .join('');
            this[countKey] = capturedList.length;
        };
        renderTray(this.trayRed, this.game.captured.red, '_trayRedCount');
        renderTray(this.trayBlack, this.game.captured.black, '_trayBlackCount');
    }

    renderMoveHistory() {
        if (!this.historyList) return;
        const rows = [];
        const hist = this.game.history;

        for (let i = 0; i < hist.length; i += 2) {
            const stepNum = Math.floor(i / 2) + 1;
            const redMove = hist[i] ? hist[i].notationEn : '';
            const blackMove = hist[i + 1] ? hist[i + 1].notationEn : '—';
            rows.push(`
                <div class="history-row">
                    <span class="step-no">${stepNum}.</span>
                    <span class="red-move">${redMove}</span>
                    <span class="black-move">${blackMove}</span>
                </div>
            `);
        }
        this.historyList.innerHTML = rows.join('');
        this.historyList.scrollTop = this.historyList.scrollHeight;
    }

    handleSquareClick(r, c) {
        if (this.game.gameOver || this.isAnimating) return;

        const piece = this.game.board[r][c];
        const pieceColor = this.game.getPieceColor(piece);

        // In multiplayer: if clicking own piece when it's NOT your turn, provide helpful feedback
        if (piece && this.multiplayerMode && this.playerSide && this.playerSide !== 'spectator') {
            if (this.game.turn !== this.playerSide && pieceColor === this.playerSide) {
                const opponentName = this.playerSide === 'red' ? 'Black (將)' : 'Red (帥)';
                const banner = document.getElementById('mpTurnBanner');
                if (banner) {
                    banner.classList.add('banner-pulse');
                    setTimeout(() => banner.classList.remove('banner-pulse'), 400);
                }
                if (window.multiplayer && typeof window.multiplayer.showToast === 'function') {
                    window.multiplayer.showToast(`It is ${opponentName}'s turn. Please wait...`, 'info', 1200);
                }
                return;
            }
        }

        // 1. If clicking own piece, select it with lift animation and audio
        if (piece && pieceColor === this.game.turn) {
            // In multiplayer: only allow selecting pieces of your assigned side
            if (this.multiplayerMode && this.playerSide && (pieceColor !== this.playerSide || this.playerSide === 'spectator')) {
                return;
            }
            if (window.fx3dEngine) window.fx3dEngine.clearThreats();
            soundFx.playSelect();
            this.selectedSquare = { r, c };
            this.legalMovesForSelected = this.game.getLegalMovesForPiece(r, c);
            this.updateSelectionAndMarkers();
            return;
        }

        // 2. If a piece is already selected, check if this click is a legal move
        if (this.selectedSquare) {
            const matchedMove = this.legalMovesForSelected.find(m => m.to.r === r && m.to.c === c);
            if (matchedMove) {
                if (this.multiplayerMode && this.onMultiplayerMoveIntent) {
                    this.onMultiplayerMoveIntent(matchedMove);
                    this.selectedSquare = null;
                    this.legalMovesForSelected = [];
                    this.updateSelectionAndMarkers();
                    return;
                }
                this.executeMove(matchedMove);
                return;
            }
        }

        // 3. Otherwise deselect
        if (this.selectedSquare) {
            soundFx.playSelect();
        }
        this.selectedSquare = null;
        this.legalMovesForSelected = [];
        this.updateSelectionAndMarkers();
    }

    executeMove(move) {
        if (this.isAnimating) {
            this.pendingMoveQueue = this.pendingMoveQueue || [];
            this.pendingMoveQueue.push(move);
            return;
        }
        if (window.GameBus) window.GameBus.emit('move', { move: move });
        if (window.fx3dEngine) window.fx3dEngine.clearThreats();
        if (window.vfxEngine && window.vfxEngine.fx2d) window.vfxEngine.fx2d.clear();
        this.isAnimating = true;

        // 1. Clear hints immediately
        const markers = this.boardLayer.querySelectorAll('.marker-wrap');
        markers.forEach(m => m.remove());

        // 2. Find moving piece element
        const movingPieceEl = this.boardLayer.querySelector(`.piece-wrap[data-row="${move.from.r}"][data-col="${move.from.c}"]`);
        if (movingPieceEl) {
            movingPieceEl.classList.remove('selected', 'selected-red', 'selected-black');
            const moverColor = this.game.getPieceColor(move.piece);
            movingPieceEl.classList.add(`moving-${moverColor}`);
        }

        // Check if this is the final checkmate move (fast-path from server or conditional check)
        let isFinalMove = !!move.isCheckmate;
        if (!isFinalMove && !this.multiplayerMode && this.game.isCheck && this.game.isCheck(this.game.turn)) {
            try {
                const cloneGame = new (window.XiangqiGame || XiangqiGame)();
                cloneGame.board = this.game.board.map(r => [...r]);
                cloneGame.turn = this.game.turn;
                const res = cloneGame.makeMove(move);
                if (res && res.gameOver && cloneGame.winReason === 'checkmate') {
                    isFinalMove = true;
                }
            } catch(e) {}
        }

        if (isFinalMove && movingPieceEl) {
            movingPieceEl.style.transitionDuration = '1.5s';
        }

        // 3. Find enemy piece element if taking out
        const targetPieceEl = move.captured
            ? this.boardLayer.querySelector(`.piece-wrap[data-row="${move.to.r}"][data-col="${move.to.c}"]`)
            : null;

        // Helper to commit the move to logical game state
        const commitMove = () => {
            try {
                const isSoldier = move.piece.toUpperCase() === 'P';
                const isRed = move.piece === 'P';
                const crossedRiver = isSoldier && (isRed ? (move.from.r > 4 && move.to.r <= 4) : (move.from.r <= 4 && move.to.r > 4));

                let res = this.game.makeMove(move);
                if (!res && this.multiplayerMode) {
                    // Fallback sync for server-authoritative move
                    this.game.board[move.to.r][move.to.c] = move.piece;
                    this.game.board[move.from.r][move.from.c] = null;
                    this.game.lastMove = { from: move.from, to: move.to, piece: move.piece, captured: move.captured };
                    this.game.turn = this.game.turn === RED ? BLACK : RED;
                }

                this.selectedSquare = null;
                this.legalMovesForSelected = [];
                this.isAnimating = false;
                this.render();

                if (this.pendingMoveQueue && this.pendingMoveQueue.length > 0) {
                    const nextMove = this.pendingMoveQueue.shift();
                    setTimeout(() => this.executeMove(nextMove), 40);
                }

                if (crossedRiver && (!res || !res.gameOver)) {
                    if (window.GameBus) window.GameBus.emit('soldierCrossRiver', { to: move.to, move: move });
                    this.triggerSoldierRiverCross(move.to, isRed ? 'red' : 'black');
                }

                const isGameOver = (res && res.gameOver) || this.game.gameOver;
                if (isGameOver) {
                    // Phase 4: bus-route-first. The effects manager owns the
                    // checkmate finale (including the flying-general mate, whose
                    // winReason is 'general_captured'); the legacy direct calls
                    // are the fallback when the bus/manager is absent.
                    const mateReason = this.game.winReason;
                    const isMate = (mateReason === 'checkmate' || mateReason === 'general_captured');
                    if (isMate && window.GameBus && window.effectsManager) {
                        window.GameBus.emit('checkmate', this._buildCheckmateEvent(move, mateReason));
                    } else if (mateReason === 'checkmate') {
                        this.playCheckmateClimaxSequence(move);
                    } else {
                        soundFx.playVictory();
                        setTimeout(() => this.showGameOverModal(), 600);
                    }
                } else {
                    const inCheck = this.game.isCheck(this.game.turn);
                    if (inCheck) {
                        // Phase 3: bus-route-first. The effects manager owns the
                        // check banner + cinematic sequence; the legacy direct
                        // calls are the fallback when the bus/manager is absent.
                        if (window.GameBus && window.effectsManager) {
                            const sideInCheck = this.game.turn; // post-commit: side now to move
                            const kingPos = this.game.findKing(this.game.board, sideInCheck);
                            const checkers = (typeof this.game.getCheckingPieces === 'function')
                                ? (this.game.getCheckingPieces(sideInCheck) || [])
                                : [];
                            // Prefer the server-supplied checking piece (multiplayer),
                            // else the moved piece when it is a direct checker,
                            // else the first checker in the list.
                            let checkingPos = move.to;
                            let checkingPieceType = (move.piece || '').toUpperCase();
                            const hint = move.checkingPiece;
                            if (typeof hint === 'string' && hint) {
                                checkingPieceType = hint.toUpperCase();
                            } else if (hint && typeof hint === 'object') {
                                if (hint.piece) checkingPieceType = String(hint.piece).toUpperCase();
                                if (typeof hint.r === 'number' && typeof hint.c === 'number') {
                                    checkingPos = { r: hint.r, c: hint.c };
                                }
                            } else if (checkers.length > 0) {
                                const direct = checkers.find(c => c.r === move.to.r && c.c === move.to.c);
                                const chosen = direct || checkers[0];
                                checkingPos = { r: chosen.r, c: chosen.c };
                                checkingPieceType = String(chosen.piece || '').toUpperCase() || checkingPieceType;
                            }
                            // A general giving check is the flying-general rule.
                            const pieceKey = (checkingPieceType === 'K') ? 'flyingGeneral' : checkingPieceType;
                            window.GameBus.emit('check', {
                                move: move,
                                pieceKey: pieceKey,
                                checkingPieces: checkers.map(c => ({
                                    r: c.r, c: c.c,
                                    piece: String(c.piece || '').toUpperCase()
                                })),
                                checkingPos: checkingPos,
                                generalCell: kingPos ? { r: kingPos.r, c: kingPos.c } : null,
                                from: move.from,
                                to: move.to,
                                side: sideInCheck
                            });
                        } else {
                            this.playCheckAttackSequence(move);
                        }
                    }
                }
            } catch (err) {
                console.error('Error committing move:', err);
                this.isAnimating = false;
                this.render();
                if (this.pendingMoveQueue && this.pendingMoveQueue.length > 0) {
                    const nextMove = this.pendingMoveQueue.shift();
                    setTimeout(() => this.executeMove(nextMove), 40);
                }
            }
        };

        // Helper to glide attacker into target square and commit
        const glideAttackerAndCommit = (delayBeforeSlide = 35) => {
            setTimeout(() => {
                if (movingPieceEl) {
                    movingPieceEl.classList.remove('piece-charging');
                    movingPieceEl.classList.add('piece-moving');
                    movingPieceEl.style.left = `${5 + move.to.c * 11.25}%`;
                    movingPieceEl.style.top = `${4.444 + move.to.r * 10}%`;
                }
                setTimeout(() => {
                    commitMove();
                }, isFinalMove ? 700 : 250);
            }, delayBeforeSlide);
        };

        if (targetPieceEl) {
            // === TACTICAL COMBAT KILL SEQUENCE ===
            // Attacker stays at move.from and charges
            if (movingPieceEl) movingPieceEl.classList.add('piece-charging');

            const attacker = move.piece.toUpperCase();

            if (window.GameBus && window.effectsManager) {
                // Phase 1: route captures through the effects event bus.
                window.GameBus.emit('capture', { attacker: attacker, victim: move.captured || null, side: this.game.turn, from: move.from, to: move.to, targetEl: targetPieceEl, movingPieceEl: movingPieceEl, commit: commitMove });
            } else if (window.aaaEngine) {
                // Legacy direct path (no event bus / no effects manager).
                // Delegate ALL captures to the AAA Engine!
                if (movingPieceEl) movingPieceEl.classList.remove('piece-charging');
                if (targetPieceEl) targetPieceEl.classList.remove('piece-shaking');
                window.aaaEngine.playCapture(attacker, move.from, move.to, targetPieceEl, movingPieceEl, () => {
                    commitMove();
                });
            } else {
                soundFx.playCapture();
                targetPieceEl.classList.add('piece-captured');
                glideAttackerAndCommit(35);
            }
        } else {
            // === PEACEFUL MOVE (Non-Capture) ===
            soundFx.playMove();
            if (movingPieceEl) {
                movingPieceEl.classList.add('piece-moving');
                movingPieceEl.style.left = `${5 + move.to.c * 11.25}%`;
                movingPieceEl.style.top = `${4.444 + move.to.r * 10}%`;
            }
            setTimeout(() => {
                commitMove();
            }, isFinalMove ? 700 : 250);
        }
    }

    /**
     * Phase 4: build the enriched GameBus 'checkmate' payload.
     * Event-data only — no game-logic change.
     *
     * Shape: { move, pieceKey, winningPiece, losingGeneralCell, winnerSide, reason }
     *  - winningPiece: a server-supplied move.gameOver.winningPiece wins when the
     *    move carries one, else the mating move.piece.
     *  - pieceKey: uppercase config key (C/R/H/E/A/P/K). A general mating via
     *    the along-file flying-general capture routes BOTH pieceKey and
     *    winningPiece as 'flyingGeneral' (mirrors the Phase-3 _onCapture
     *    duel detection in effects-bridge.js; attacker K + victim K + same file).
     *  - losingGeneralCell: the doomed general's {r,c} (null when the general
     *    was captured off the board, i.e. the flying-general mate).
     *  - winnerSide: this.game.winner ('red' | 'black').
     *  - reason: the win reason ('checkmate' | 'general_captured').
     * Post-commit this.game.turn is the side to move, i.e. the losing side.
     */
    _buildCheckmateEvent(move, reason) {
        let winningPiece = (move && move.gameOver && move.gameOver.winningPiece) || (move && move.piece);
        let pieceKey = String(winningPiece || '').toUpperCase();
        const victim = (move && move.captured != null) ? String(move.captured).toUpperCase() : '';
        if (pieceKey === 'K' && victim === 'K' &&
            move && move.from && move.to &&
            typeof move.from.c === 'number' && typeof move.to.c === 'number' &&
            move.from.c === move.to.c) {
            pieceKey = 'flyingGeneral';
            winningPiece = 'flyingGeneral';
        }
        const loserSide = this.game.turn;
        const losingGeneralCell = (typeof this.game.findKing === 'function')
            ? (this.game.findKing(this.game.board, loserSide) || null)
            : null;
        return {
            move: move,
            pieceKey: pieceKey,
            winningPiece: winningPiece,
            losingGeneralCell: losingGeneralCell,
            winnerSide: this.game.winner,
            reason: reason
        };
    }

    /**
     * Grand Epic General Threat Standoff Climax (End Game Checkmate ONLY)
     * In accordance with Xiangqi lore and rules, the General is NEVER killed or destroyed!
     * The doomed General is trapped in the Palace under lethal threat (surrender aura),
     * while the winning piece enters a high-tension 3D Threat Standoff position:
     * - Cannon: 3D Bronze Cannon swivels, loads glowing shell, aims laser lock-on
     * - Chariot: 3D Golden Blade drawn at the throat with energy hum
     * - Horse: Celestial Warhorse towering over the Palace entrance with crackling hooves
     * - Soldier: Point-blank spear leveled directly at the General's heart
     * Followed by the Imperial Checkmate Seal: 「將軍 · 絕殺！ 降者免死」 with temple bronze gong.
     */
    playCheckmateClimaxSequence(move) {
        const attackerPiece = move.piece.toUpperCase();
        const attackerSquare = move.to;
        const enemyKingPos = this.game.findKing(this.game.board, this.game.turn);

        const attackerEl = this.boardLayer.querySelector(`.piece-wrap[data-row="${attackerSquare.r}"][data-col="${attackerSquare.c}"]`);
        const kingEl = enemyKingPos
            ? this.boardLayer.querySelector(`.piece-wrap[data-row="${enemyKingPos.r}"][data-col="${enemyKingPos.c}"]`)
            : null;

        if (window.aaaEngine) {
            // Strip animations to prevent CSS locking
            if (attackerEl) { attackerEl.classList.remove('selected'); attackerEl.style.transition = 'none'; attackerEl.style.animation = 'none'; }
            if (kingEl) { kingEl.style.transition = 'none'; kingEl.style.animation = 'none'; }
            
            window.aaaEngine.playCheckmate(kingEl, () => {
                this.showGameOverModal();
            });
            return;
        }

        // 1. Activate cinematic spotlight vignette focusing on the palace duel
        const vignette = document.getElementById('cinematicVignette');
        if (vignette) vignette.classList.add('active');

        // 2. 3D perspective camera zoom into the palace
        this.boardOuter.classList.add('camera-zoom-palace');

        // 3. Doomed General is trapped in Palace with surrender/cornered aura (ALIVE & intact)
        if (kingEl) {
            kingEl.classList.add('king-surrender-aura');
            kingEl.classList.add('doomed-general');
            
            // falling crown
            const crown = document.createElement('div');
            crown.className = 'falling-crown';
            crown.textContent = '👑';
            kingEl.appendChild(crown);
            
            // palace crumbles
            const crumble = document.createElement('div');
            crumble.className = 'palace-crumble';
            crumble.style.left = kingEl.style.left;
            crumble.style.top = kingEl.style.top;
            this.boardLayer.appendChild(crumble);
        }

        if (attackerEl) attackerEl.classList.add('killer-piece');
        this.boardOuter.classList.add('board-dimmed');
        this.boardOuter.classList.add('freeze-frame');

        // impact flash
        const flash = document.createElement('div');
        flash.className = 'impact-flash fire';
        this.boardOuter.appendChild(flash);
        setTimeout(() => { if (flash.parentNode) flash.remove(); }, 1000);

        // Callback when the lethal threat standoff peaks
        const onThreatStandoff = () => {
            if (kingEl) {
                kingEl.classList.remove('king-surrender-aura');
                kingEl.classList.add('king-submissive');
            }

            // High-tension standoff drone
            if (window.soundFx) soundFx.playStandoffTension();

            // Victory golden celebration embers
            if (window.fxEngine) {
                window.fxEngine.triggerVictoryEmberRain(3600);
            }

            // Confetti
            for(let i=0; i<30; i++) {
                const conf = document.createElement('div');
                conf.className = 'confetti';
                conf.style.left = Math.random() * 100 + 'vw';
                conf.style.background = ['#facc15', '#ef4444', '#3b82f6', '#22c55e'][Math.floor(Math.random()*4)];
                conf.style.animationDuration = (2 + Math.random() * 2) + 's';
                document.body.appendChild(conf);
                setTimeout(() => { if(conf.parentNode) conf.remove(); }, 5000);
            }

            // Lanterns
            for(let i=0; i<6; i++) {
                const lan = document.createElement('div');
                lan.className = 'lantern';
                lan.textContent = '🏮';
                lan.style.fontSize = '40px';
                lan.style.background = 'transparent';
                lan.style.boxShadow = 'none';
                lan.style.left = (10 + i*15) + 'vw';
                lan.style.animationDuration = (4 + Math.random() * 2) + 's';
                document.body.appendChild(lan);
                setTimeout(() => { if(lan.parentNode) lan.remove(); }, 7000);
            }

            // Slam down the Grand Imperial Checkmate Stamp (Spared General / Standoff Grace)
            setTimeout(() => {
                const stamp = document.getElementById('checkmateStamp');
                const stampDescZh = document.getElementById('stampDescZh');
                const stampSubZh = document.getElementById('stampSubZh');
                const isRed = this.game.winner === RED;
                if (stamp && stampDescZh && stampSubZh) {
                    stampDescZh.textContent = '將軍 · 絕殺！';
                    stampSubZh.textContent = isRed ? '赤旗奏凱 · 降者免死 · 棋局終' : '玄甲凱旋 · 降者免死 · 棋局終';
                    stamp.classList.add('show');
                }
                if (window.soundFx) soundFx.playCheckmateClimax(); // Deep bronze gong
            }, 600);

            // Show Game Over modal after the cinematic climax completes
            setTimeout(() => {
                if (vignette) vignette.classList.remove('active');
                this.boardOuter.classList.remove('camera-zoom-palace');
                this.boardOuter.classList.remove('board-dimmed');
                this.boardOuter.classList.remove('freeze-frame');
                if (window.fx3dEngine) window.fx3dEngine.clearThreats();
                this.showGameOverModal();
            }, 3400);
        };

        // 4. Checkmating piece executes its 3D Threatening Sequence
        if (attackerPiece === 'C' && enemyKingPos) {
            // Cannon Threat: Mechanical breech lock, 3D Cannon aims, loads bullet, laser sight
            if (attackerEl) attackerEl.classList.add('threat-cannon-aim');
            if (window.soundFx) soundFx.playMechanicalLock();

            if (window.fx3dEngine) {
                window.fx3dEngine.playCannonThreat(attackerSquare, enemyKingPos);
            }

            setTimeout(() => {
                if (window.soundFx) soundFx.playSizzlingFuse();
            }, 500);

            setTimeout(onThreatStandoff, 1600);
        } else if (attackerPiece === 'R' && enemyKingPos) {
            // Chariot Threat: Unsheathing golden blade at the throat, lethal energy hum
            if (attackerEl) attackerEl.classList.add('threat-chariot-blade');
            if (window.soundFx) soundFx.playBladeUnsheathe();

            if (window.fx3dEngine) {
                window.fx3dEngine.playChariotThreat(attackerSquare, enemyKingPos);
            }

            setTimeout(() => {
                if (window.soundFx) soundFx.playEnergyHum();
            }, 450);

            setTimeout(onThreatStandoff, 1400);
        } else if (attackerPiece === 'H' && enemyKingPos) {
            // Horse Threat: Celestial warhorse rears up, crackling electric hooves
            if (attackerEl) attackerEl.classList.add('threat-horse-rear');
            if (window.soundFx) soundFx.playHorseRear();

            if (window.fx3dEngine) {
                window.fx3dEngine.playHorseThreat(attackerSquare, enemyKingPos);
            }

            setTimeout(() => {
                if (window.soundFx) soundFx.playLightningCrack();
            }, 400);

            setTimeout(onThreatStandoff, 1400);
        } else if (attackerPiece === 'E' && enemyKingPos) {
            // Elephant Threat: Shakes the Palace gates with deep tremor
            if (window.soundFx) soundFx.playElephantTremor();
            if (window.fxEngine) {
                window.fxEngine.fireElephantFissure(attackerSquare, enemyKingPos, false);
            }
            setTimeout(onThreatStandoff, 1200);
        } else if (attackerPiece === 'P' && enemyKingPos) {
            // Soldier Threat: Point-blank spear leveled at the General's heart
            if (attackerEl) attackerEl.classList.add('threat-soldier-spear');
            if (window.soundFx) soundFx.playSpearLevel();

            if (window.fx3dEngine) {
                window.fx3dEngine.playSoldierThreat(attackerSquare, enemyKingPos);
            }

            setTimeout(onThreatStandoff, 1100);
        } else {
            setTimeout(onThreatStandoff, 800);
        }
    }

    playCheckAttackSequence(move) {
        const enemyKingPos = this.game.findKing(this.game.board, this.game.turn);
        if (!enemyKingPos) return;

        // Find checking piece (the moved piece or discovered attacker)
        let checkingPos = move.to;
        let checkingPieceType = move.piece.toUpperCase();

        const checkers = this.game.getCheckingPieces ? this.game.getCheckingPieces(this.game.turn) : [];
        if (checkers.length > 0) {
            const direct = checkers.find(c => c.r === move.to.r && c.c === move.to.c);
            if (direct) {
                checkingPos = { r: direct.r, c: direct.c };
                checkingPieceType = direct.piece.toUpperCase();
            } else {
                checkingPos = { r: checkers[0].r, c: checkers[0].c };
                checkingPieceType = checkers[0].piece.toUpperCase();
            }
        }

        const attackerEl = this.boardLayer.querySelector(`.piece-wrap[data-row="${checkingPos.r}"][data-col="${checkingPos.c}"]`);
        const kingEl = this.boardLayer.querySelector(`.piece-wrap[data-row="${enemyKingPos.r}"][data-col="${enemyKingPos.c}"]`);

        // King enters alarm/danger state (pulsing red aura, alive and able to run/block)
        if (kingEl) {
            kingEl.classList.add('king-in-check');
        }

        // Show the Imperial 「將軍!」 seal
        this.triggerCheckBanner(checkingPieceType);

        // Sleek Non-intrusive 2D Standoff Laser Sightline (No crude 3D geometric meshes!)
        if (window.vfxEngine && window.vfxEngine.playCheckThreat) {
            window.vfxEngine.playCheckThreat(checkingPos, enemyKingPos, checkingPieceType);
        }

        // Tactical threat visual aura on checking piece
        if (checkingPieceType === 'C') {
            if (attackerEl) {
                attackerEl.classList.add('threat-cannon-aim');
                setTimeout(() => attackerEl.classList.remove('threat-cannon-aim'), 1800);
            }
        } else if (checkingPieceType === 'R') {
            if (attackerEl) {
                attackerEl.classList.add('threat-chariot-blade');
                setTimeout(() => attackerEl.classList.remove('threat-chariot-blade'), 1600);
            }
        } else if (checkingPieceType === 'H') {
            if (attackerEl) {
                attackerEl.classList.add('threat-horse-rear');
                setTimeout(() => attackerEl.classList.remove('threat-horse-rear'), 1600);
            }
        } else if (checkingPieceType === 'P') {
            if (attackerEl) {
                attackerEl.classList.add('threat-soldier-spear');
                setTimeout(() => attackerEl.classList.remove('threat-soldier-spear'), 1600);
            }
        }
    }

    triggerCheckBanner(checkingPieceType = 'G') {
        if (!this.checkBanner) return;
        this.checkBanner.classList.remove('show');
        void this.checkBanner.offsetWidth; // Force CSS reflow to re-trigger animation
        this.checkBanner.classList.add('show');

        // Red vignette alarm on board (instant GPU-accelerated)
        if (this.boardOuter) {
            this.boardOuter.classList.add('check-alarm-vignette');
            setTimeout(() => {
                if (this.boardOuter) this.boardOuter.classList.remove('check-alarm-vignette');
            }, 820);
        }

        // 2D imperial shockwave & radiant golden/carmine sparks (fast & lightweight)
        if (window.vfxEngine && window.vfxEngine.fx2d && window.vfxEngine.fx2d.playCheckBannerVFX) {
            window.vfxEngine.fx2d.playCheckBannerVFX();
        }

        // Play epic sound layered with piece check sound
        if (window.soundFx && window.soundFx.playCheck) {
            window.soundFx.playCheck(checkingPieceType);
        }

        setTimeout(() => {
            if (this.checkBanner) this.checkBanner.classList.remove('show');
        }, 820);
    }

    triggerSoldierRiverCross(pos = { r: 4, c: 4 }, side = 'red') {
        if (!this.boardLayer) return;
        const splash = document.createElement('div');
        splash.className = `soldier-powerup-splash splash-${side}`;
        splash.style.left = `${5 + pos.c * 11.25}%`;
        splash.style.top = `${4.444 + pos.r * 10}%`;
        this.boardLayer.appendChild(splash);

        const banner = document.createElement('div');
        banner.className = `soldier-powerup-banner banner-${side}`;
        banner.textContent = '过河';
        banner.style.left = `${5 + pos.c * 11.25}%`;
        banner.style.top = `${4.444 + pos.r * 10}%`;
        this.boardLayer.appendChild(banner);

        setTimeout(() => {
            if (splash.parentNode) splash.remove();
            if (banner.parentNode) banner.remove();
        }, 1600);
    }

    playCannonAttack(from, to, isMega = false, onImpact) {
        if (window.fxEngine) {
            soundFx.playCannonCharging();
            window.fxEngine.fireArtilleryCannon(from, to, isMega, () => {
                soundFx.playCannonBlast();
                if (onImpact) onImpact();
            });
        } else if (onImpact) {
            onImpact();
        }
    }

    playChariotAttack(from, to, isMega = false, onImpact) {
        soundFx.playSwordSlash();
        if (window.fxEngine) {
            window.fxEngine.fireChariotSlash(from, to, isMega, () => {
                if (onImpact) onImpact();
            });
        } else if (onImpact) {
            onImpact();
        }
    }

    playHorseAttack(from, to, isMega = false, onImpact) {
        soundFx.playHorseGallop();
        if (window.fxEngine) {
            window.fxEngine.fireHorseStomp(from, to, isMega, () => {
                if (onImpact) onImpact();
            });
        } else if (onImpact) {
            onImpact();
        }
    }

    playElephantAttack(from, to, isMega = false, onImpact) {
        soundFx.playElephantTremor();
        if (window.fxEngine) {
            window.fxEngine.fireElephantFissure(from, to, isMega, () => {
                if (onImpact) onImpact();
            });
        } else if (onImpact) {
            onImpact();
        }
    }

    playAdvisorAttack(from, to, onImpact) {
        soundFx.playSwordSlash();
        if (window.fxEngine) {
            window.fxEngine.fireAdvisorSlash(from, to, () => {
                if (onImpact) onImpact();
            });
        } else if (onImpact) {
            onImpact();
        }
    }

    playSoldierAttack(from, to, onImpact) {
        soundFx.playSpearThrust();
        if (window.fxEngine) {
            window.fxEngine.fireSoldierThrust(from, to, () => {
                if (onImpact) onImpact();
            });
        } else if (onImpact) {
            onImpact();
        }
    }

    handleUndo() {
        if (this.game.history.length === 0 || this.isAnimating) return;
        if (window.fx3dEngine) window.fx3dEngine.clearThreats();
        this.game.undo();
        this.selectedSquare = null;
        this.legalMovesForSelected = [];
        this.render();
    }

    showGameOverModal() {
        const title = document.getElementById('modalTitle');
        const desc = document.getElementById('modalDesc');

        const isRed = this.game.winner === RED;
        const winnerZh = isRed ? '紅方大捷' : '黑方大捷';
        const winnerEn = isRed ? 'Red Player' : 'Black Player';
        let reasonZh = '';

        if (this.game.winReason === 'checkmate') {
            reasonZh = '絕殺無解！一子定乾坤，全軍大捷！';
        } else if (this.game.winReason === 'stalemate') {
            reasonZh = '困斃！敵方無子可走，依例判負！';
        } else if (this.game.winReason === 'timeout') {
            reasonZh = '超時！用時耗盡，判定負局！';
        }

        title.innerHTML = `<span style="display:block; font-size: 2.2rem; color: #fef08a; font-family: 'Kaiti SC', 'STKaiti', 'KaiTi', 'PingFang SC', serif; letter-spacing: 0.12em;">${winnerZh}</span>`;
        desc.innerHTML = `<span style="display:block; font-size: 1.15rem; color: #f1f5f9; font-family: 'Kaiti SC', 'STKaiti', 'KaiTi', 'PingFang SC', serif; line-height: 1.6;">${reasonZh}</span>`;
        this.modal.classList.add('open');
    }
}

window.XiangqiApp = XiangqiApp;
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    window.app = new XiangqiApp();
} else {
    window.addEventListener('DOMContentLoaded', () => {
        window.app = new XiangqiApp();
    });
}
