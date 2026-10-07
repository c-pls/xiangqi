/**
 * Xiangqi (Chinese Chess) Rules Engine
 * Complete implementation: legal moves, checks, checkmate, stalemate, notation
 */

const RED = 'red';
const BLACK = 'black';

class XiangqiGame {
    constructor() {
        this.board = this.createInitialBoard();
        this.turn = RED; // Red moves first
        this.history = []; // Move record stack for undo and notation
        this.captured = { red: [], black: [] };
        this.gameOver = false;
        this.winner = null;
        this.winReason = null;
        this.lastMove = null;
        this.positionCounts = new Map();
        this.recordPosition();
    }

    createInitialBoard() {
        return [
            ['r', 'h', 'e', 'a', 'k', 'a', 'e', 'h', 'r'],
            [null, null, null, null, null, null, null, null, null],
            [null, 'c', null, null, null, null, null, 'c', null],
            ['p', null, 'p', null, 'p', null, 'p', null, 'p'],
            [null, null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null, null],
            ['P', null, 'P', null, 'P', null, 'P', null, 'P'],
            [null, 'C', null, null, null, null, null, 'C', null],
            [null, null, null, null, null, null, null, null, null],
            ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R']
        ];
    }

    getInitialBoard() {
        return this.createInitialBoard();
    }

    cloneBoard(b = this.board) {
        return b.map(row => [...row]);
    }

    getPieceColor(piece) {
        if (!piece) return null;
        return piece === piece.toUpperCase() ? RED : BLACK;
    }

    isInsideBoard(r, c) {
        return r >= 0 && r <= 9 && c >= 0 && c <= 8;
    }

    findKing(board, color) {
        const target = color === RED ? 'K' : 'k';
        const startR = color === RED ? 7 : 0;
        const endR = color === RED ? 9 : 2;
        for (let r = startR; r <= endR; r++) {
            for (let c = 3; c <= 5; c++) {
                if (board[r][c] === target) {
                    return { r, c };
                }
            }
        }
        // Fallback search across whole board in unusual custom setups
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                if (board[r][c] === target) return { r, c };
            }
        }
        return null;
    }

    // Flying General Rule: Kings cannot face each other directly in the same column without intervening pieces
    areKingsFacing(board) {
        const redKing = this.findKing(board, RED);
        const blackKing = this.findKing(board, BLACK);
        if (!redKing || !blackKing) return false;
        if (redKing.c !== blackKing.c) return false;

        const col = redKing.c;
        const minR = Math.min(redKing.r, blackKing.r);
        const maxR = Math.max(redKing.r, blackKing.r);

        for (let r = minR + 1; r < maxR; r++) {
            if (board[r][col] !== null) {
                return false; // There is a piece blocking
            }
        }
        return true; // Kings directly face each other!
    }

    getPseudoLegalMoves(board, r, c) {
        const piece = board[r][c];
        if (!piece) return [];
        const color = this.getPieceColor(piece);
        const type = piece.toUpperCase();
        const moves = [];

        const addMoveIfValid = (nr, nc) => {
            if (!this.isInsideBoard(nr, nc)) return;
            const destPiece = board[nr][nc];
            if (!destPiece || this.getPieceColor(destPiece) !== color) {
                moves.push({ from: { r, c }, to: { r: nr, c: nc }, piece, captured: destPiece });
            }
        };

        if (type === 'K') { // King (General)
            const minR = color === RED ? 7 : 0;
            const maxR = color === RED ? 9 : 2;
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dr, dc] of dirs) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr >= minR && nr <= maxR && nc >= 3 && nc <= 5) {
                    addMoveIfValid(nr, nc);
                }
            }
            // Flying General: the side to move may capture the enemy general when both
            // generals stand on the same file with every square between them empty
            const enemyColor = color === RED ? BLACK : RED;
            const enemyKing = this.findKing(board, enemyColor);
            if (enemyKing && enemyKing.c === c) {
                let pathClear = true;
                const lo = Math.min(r, enemyKing.r) + 1;
                const hi = Math.max(r, enemyKing.r);
                for (let pr = lo; pr < hi; pr++) {
                    if (board[pr][c] !== null) {
                        pathClear = false;
                        break;
                    }
                }
                if (pathClear) {
                    moves.push({
                        from: { r, c },
                        to: { r: enemyKing.r, c: enemyKing.c },
                        piece,
                        captured: board[enemyKing.r][enemyKing.c]
                    });
                }
            }
        } else if (type === 'A') { // Advisor
            const minR = color === RED ? 7 : 0;
            const maxR = color === RED ? 9 : 2;
            const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
            for (const [dr, dc] of dirs) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr >= minR && nr <= maxR && nc >= 3 && nc <= 5) {
                    addMoveIfValid(nr, nc);
                }
            }
        } else if (type === 'E') { // Elephant
            const dirs = [[-2, -2], [-2, 2], [2, -2], [2, 2]];
            for (const [dr, dc] of dirs) {
                const nr = r + dr;
                const nc = c + dc;
                // Cannot cross river
                if (color === RED && nr < 5) continue;
                if (color === BLACK && nr > 4) continue;
                if (!this.isInsideBoard(nr, nc)) continue;

                // Eye must not be blocked (塞象眼)
                const eyeR = r + dr / 2;
                const eyeC = c + dc / 2;
                if (board[eyeR][eyeC] === null) {
                    addMoveIfValid(nr, nc);
                }
            }
        } else if (type === 'H') { // Horse
            const hops = [
                { leg: [-1, 0], steps: [[-2, -1], [-2, 1]] }, // up
                { leg: [1, 0],  steps: [[2, -1], [2, 1]] },   // down
                { leg: [0, -1], steps: [[-1, -2], [1, -2]] }, // left
                { leg: [0, 1],  steps: [[-1, 2], [1, 2]] }    // right
            ];
            for (const hop of hops) {
                const legR = r + hop.leg[0];
                const legC = c + hop.leg[1];
                if (this.isInsideBoard(legR, legC) && board[legR][legC] === null) {
                    // Horse foot is free (不蹩马腿)
                    for (const [dr, dc] of hop.steps) {
                        addMoveIfValid(r + dr, c + dc);
                    }
                }
            }
        } else if (type === 'R') { // Chariot
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dr, dc] of dirs) {
                let nr = r + dr;
                let nc = c + dc;
                while (this.isInsideBoard(nr, nc)) {
                    const destPiece = board[nr][nc];
                    if (!destPiece) {
                        moves.push({ from: { r, c }, to: { r: nr, c: nc }, piece, captured: null });
                    } else {
                        if (this.getPieceColor(destPiece) !== color) {
                            moves.push({ from: { r, c }, to: { r: nr, c: nc }, piece, captured: destPiece });
                        }
                        break; // Stop at first obstacle
                    }
                    nr += dr;
                    nc += dc;
                }
            }
        } else if (type === 'C') { // Cannon
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dr, dc] of dirs) {
                let nr = r + dr;
                let nc = c + dc;
                let hopped = false;
                while (this.isInsideBoard(nr, nc)) {
                    const destPiece = board[nr][nc];
                    if (!hopped) {
                        if (!destPiece) {
                            moves.push({ from: { r, c }, to: { r: nr, c: nc }, piece, captured: null });
                        } else {
                            hopped = true; // Found screen (炮架)
                        }
                    } else {
                        // Looking for capture target after screen
                        if (destPiece) {
                            if (this.getPieceColor(destPiece) !== color) {
                                moves.push({ from: { r, c }, to: { r: nr, c: nc }, piece, captured: destPiece });
                            }
                            break; // Cannon can only jump one screen
                        }
                    }
                    nr += dr;
                    nc += dc;
                }
            }
        } else if (type === 'P') { // Soldier (Pawn)
            const forward = color === RED ? -1 : 1;
            const crossedRiver = color === RED ? r <= 4 : r >= 5;

            // Forward move
            addMoveIfValid(r + forward, c);

            // Sideways move once across river
            if (crossedRiver) {
                addMoveIfValid(r, c - 1);
                addMoveIfValid(r, c + 1);
            }
        }

        return moves;
    }

    isSquareAttackedBy(board, targetR, targetC, byColor) {
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const piece = board[r][c];
                if (piece && this.getPieceColor(piece) === byColor) {
                    const pseudo = this.getPseudoLegalMoves(board, r, c);
                    for (const m of pseudo) {
                        if (m.to.r === targetR && m.to.c === targetC) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    isCheck(color, board = this.board) {
        const kingPos = this.findKing(board, color);
        if (!kingPos) return false;
        const opponentColor = color === RED ? BLACK : RED;
        return this.isSquareAttackedBy(board, kingPos.r, kingPos.c, opponentColor);
    }

    getCheckingPieces(color, board = this.board) {
        const kingPos = this.findKing(board, color);
        if (!kingPos) return [];
        const opponentColor = color === RED ? BLACK : RED;
        const checkers = [];
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const piece = board[r][c];
                if (piece && this.getPieceColor(piece) === opponentColor) {
                    const pseudo = this.getPseudoLegalMoves(board, r, c);
                    for (const m of pseudo) {
                        if (m.to.r === kingPos.r && m.to.c === kingPos.c) {
                            checkers.push({ r, c, piece });
                            break;
                        }
                    }
                }
            }
        }
        return checkers;
    }

    isMoveLegal(move, color = this.turn) {
        const simBoard = this.cloneBoard(this.board);
        simBoard[move.to.r][move.to.c] = move.piece;
        simBoard[move.from.r][move.from.c] = null;

        // Cannot violate Flying General rule (a general capture ends the game, so facing is moot for it)
        const isGeneralCapture = move.piece && move.piece.toUpperCase() === 'K' &&
            move.captured && move.captured.toUpperCase() === 'K';
        if (!isGeneralCapture && this.areKingsFacing(simBoard)) {
            return false;
        }

        // Own King cannot be left in check
        if (this.isCheck(color, simBoard)) {
            return false;
        }

        return true;
    }

    getLegalMovesForPiece(r, c) {
        const piece = this.board[r][c];
        if (!piece || this.getPieceColor(piece) !== this.turn || this.gameOver) {
            return [];
        }
        const pseudo = this.getPseudoLegalMoves(this.board, r, c);
        return pseudo.filter(m => this.isMoveLegal(m, this.turn));
    }

    getAllLegalMoves(color = this.turn) {
        if (this.gameOver) return [];
        const moves = [];
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const piece = this.board[r][c];
                if (piece && this.getPieceColor(piece) === color) {
                    const pieceMoves = this.getPseudoLegalMoves(this.board, r, c)
                        .filter(m => this.isMoveLegal(m, color));
                    moves.push(...pieceMoves);
                }
            }
        }
        return moves;
    }

    makeMove(move) {
        if (this.gameOver) return false;
        const legalMoves = this.getLegalMovesForPiece(move.from.r, move.from.c);
        const isMatched = legalMoves.some(m => m.to.r === move.to.r && m.to.c === move.to.c);
        if (!isMatched) return false;

        const piece = this.board[move.from.r][move.from.c];
        const destPiece = this.board[move.to.r][move.to.c];
        const moveColor = this.turn;

        // Generate Notation before updating board
        const notationZh = this.generateNotationZh(move);
        const notationEn = this.generateNotationEn(move);

        // Record history snapshot for undo
        this.history.push({
            board: this.cloneBoard(this.board),
            turn: this.turn,
            lastMove: this.lastMove ? { ...this.lastMove } : null,
            captured: { red: [...this.captured.red], black: [...this.captured.black] },
            notationZh,
            notationEn,
            move: { ...move, piece, captured: destPiece }
        });

        // Perform move
        this.board[move.to.r][move.to.c] = piece;
        this.board[move.from.r][move.from.c] = null;
        this.lastMove = { from: { ...move.from }, to: { ...move.to }, piece, captured: destPiece };

        if (destPiece) {
            if (this.getPieceColor(destPiece) === RED) {
                this.captured.red.push(destPiece);
            } else {
                this.captured.black.push(destPiece);
            }
        }

        // Switch turn
        const nextColor = moveColor === RED ? BLACK : RED;
        this.turn = nextColor;

        // Check game end conditions
        const generalCaptured = destPiece && destPiece.toUpperCase() === 'K';
        const nextMoves = generalCaptured ? [] : this.getAllLegalMoves(nextColor);
        const nextInCheck = generalCaptured ? false : this.isCheck(nextColor);

        // Store whether this move caused check in history
        if (this.history.length > 0) {
            this.history[this.history.length - 1].inCheck = nextInCheck;
        }

        if (generalCaptured) {
            this.gameOver = true;
            this.winner = moveColor;
            this.winReason = 'general_captured';
        } else if (nextMoves.length === 0) {
            this.gameOver = true;
            this.winner = moveColor;
            this.winReason = nextInCheck ? 'checkmate' : 'stalemate'; // In Xiangqi, stalemate is a loss
        } else {
            // Check threefold repetition and perpetual check
            const posKey = this.recordPosition();
            const repCount = this.positionCounts.get(posKey) || 0;

            if (repCount >= 3) {
                const isPerpetual = this.checkPerpetualCheck(moveColor);
                if (isPerpetual) {
                    this.gameOver = true;
                    this.winner = nextColor; // Perpetual checker forfeits
                    this.winReason = 'perpetual_check';
                } else {
                    this.gameOver = true;
                    this.winner = null; // Draw
                    this.winReason = 'repetition_draw';
                }
            }
        }

        return {
            success: true,
            captured: destPiece,
            inCheck: nextInCheck,
            gameOver: this.gameOver,
            winner: this.winner,
            winReason: this.winReason,
            notationZh,
            notationEn
        };
    }

    undo() {
        if (this.history.length === 0) return null;
        const currentKey = this.getPositionKey();
        const currentCount = this.positionCounts.get(currentKey) || 0;
        if (currentCount > 1) {
            this.positionCounts.set(currentKey, currentCount - 1);
        } else {
            this.positionCounts.delete(currentKey);
        }
        const lastSnapshot = this.history.pop();
        this.board = lastSnapshot.board;
        this.turn = lastSnapshot.turn;
        this.lastMove = lastSnapshot.lastMove;
        this.captured = lastSnapshot.captured;
        this.gameOver = false;
        this.winner = null;
        this.winReason = null;
        return lastSnapshot;
    }

    getPositionKey(board = this.board, turn = this.turn) {
        let fen = '';
        for (let r = 0; r < 10; r++) {
            let empty = 0;
            for (let c = 0; c < 9; c++) {
                const p = board[r][c];
                if (!p) {
                    empty++;
                } else {
                    if (empty > 0) {
                        fen += empty;
                        empty = 0;
                    }
                    fen += p;
                }
            }
            if (empty > 0) fen += empty;
            if (r < 9) fen += '/';
        }
        return `${fen} ${turn === RED ? 'w' : 'b'}`;
    }

    toFen() {
        return this.getPositionKey();
    }

    recordPosition() {
        const key = this.getPositionKey();
        this.positionCounts.set(key, (this.positionCounts.get(key) || 0) + 1);
        return key;
    }

    checkPerpetualCheck(color) {
        if (this.history.length < 4) return false;
        const movesByColor = [];
        for (let i = this.history.length - 1; i >= 0 && movesByColor.length < 3; i--) {
            if (this.history[i].turn === color) {
                movesByColor.push(this.history[i]);
            }
        }
        if (movesByColor.length < 2) return false;
        return movesByColor.every(h => h.inCheck === true);
    }

    loadBoard(board, turn = RED) {
        this.board = this.cloneBoard(board);
        this.turn = turn;
        this.history = [];
        this.captured = { red: [], black: [] };
        this.gameOver = false;
        this.winner = null;
        this.winReason = null;
        this.lastMove = null;
        this.positionCounts = new Map();
        this.recordPosition();

        const legal = this.getAllLegalMoves(this.turn);
        const inCheck = this.isCheck(this.turn);
        if (legal.length === 0) {
            this.gameOver = true;
            this.winner = this.turn === RED ? BLACK : RED;
            this.winReason = inCheck ? 'checkmate' : 'stalemate';
        }
    }

    loadFen(fen) {
        const parts = fen.trim().split(' ');
        const rows = parts[0].split('/');
        if (rows.length !== 10) throw new Error('Invalid FEN rows');
        const board = [];
        for (let r = 0; r < 10; r++) {
            const row = [];
            const rowStr = rows[r];
            for (let i = 0; i < rowStr.length; i++) {
                const char = rowStr[i];
                if (/\d/.test(char)) {
                    const count = parseInt(char, 10);
                    for (let k = 0; k < count; k++) row.push(null);
                } else {
                    row.push(char);
                }
            }
            if (row.length !== 9) throw new Error(`Invalid FEN row length at row ${r}`);
            board.push(row);
        }
        const turn = (parts[1] === 'b' || parts[1] === 'black') ? BLACK : RED;
        this.loadBoard(board, turn);
    }

    // Chinese notation generator (e.g. 炮二平五, 马８进７)
    generateNotationZh(move) {
        const piece = this.board[move.from.r][move.from.c];
        const isRed = this.getPieceColor(piece) === RED;
        const zhNames = (typeof PIECE_NAMES_ZH !== 'undefined' ? PIECE_NAMES_ZH : (typeof window !== 'undefined' ? window.PIECE_NAMES_ZH : null)) || {
            'K': '帥', 'A': '仕', 'E': '相', 'H': '傌', 'R': '俥', 'C': '炮', 'P': '兵',
            'k': '將', 'a': '士', 'e': '象', 'h': '馬', 'r': '車', 'c': '砲', 'p': '卒'
        };
        const char = zhNames[piece] || piece;
        const digits = isRed ? ['九', '八', '七', '六', '五', '四', '三', '二', '一']
                             : ['１', '２', '３', '４', '５', '６', '７', '８', '９'];

        const fromColDigit = isRed ? digits[8 - move.from.c] : digits[move.from.c];
        const dr = move.to.r - move.from.r;
        const dc = move.to.c - move.from.c;
        const type = piece.toUpperCase();

        let action = '';
        let targetDigit = '';

        if (isRed) {
            if (dr < 0) action = '进';
            else if (dr > 0) action = '退';
            else action = '平';

            if (type === 'H' || type === 'E' || type === 'A') {
                targetDigit = digits[8 - move.to.c];
            } else {
                targetDigit = action === '平' ? digits[8 - move.to.c] : digits[Math.abs(dr) - 1];
            }
        } else {
            if (dr > 0) action = '进';
            else if (dr < 0) action = '退';
            else action = '平';

            if (type === 'H' || type === 'E' || type === 'A') {
                targetDigit = digits[move.to.c];
            } else {
                targetDigit = action === '平' ? digits[move.to.c] : digits[Math.abs(dr) - 1];
            }
        }

        return `${char}${fromColDigit}${action}${targetDigit}`;
    }

    // International notation generator (e.g. C2=5, H8+7)
    generateNotationEn(move) {
        const piece = this.board[move.from.r][move.from.c];
        const isRed = this.getPieceColor(piece) === RED;
        const type = piece.toUpperCase();
        const fromCol = isRed ? (9 - move.from.c) : (move.from.c + 1);
        const toCol = isRed ? (9 - move.to.c) : (move.to.c + 1);
        const dr = move.to.r - move.from.r;

        let sign = '=';
        let operand = toCol;

        if (isRed) {
            if (dr < 0) { sign = '+'; operand = (type === 'H' || type === 'E' || type === 'A') ? toCol : Math.abs(dr); }
            else if (dr > 0) { sign = '-'; operand = (type === 'H' || type === 'E' || type === 'A') ? toCol : Math.abs(dr); }
        } else {
            if (dr > 0) { sign = '+'; operand = (type === 'H' || type === 'E' || type === 'A') ? toCol : Math.abs(dr); }
            else if (dr < 0) { sign = '-'; operand = (type === 'H' || type === 'E' || type === 'A') ? toCol : Math.abs(dr); }
        }

        return `${type}${fromCol}${sign}${operand}`;
    }
}

if (typeof window !== 'undefined') {
    window.XiangqiGame = XiangqiGame;
    window.RED = RED;
    window.BLACK = BLACK;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { XiangqiGame, RED, BLACK };
}
