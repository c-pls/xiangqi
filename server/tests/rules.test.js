const test = require('node:test');
const assert = require('node:assert');
const { XiangqiGame, RED, BLACK } = require('../src/rules/xiangqi-rules.js');

test('Xiangqi Rules Engine', async (t) => {

    await t.test('1. Initial board setup and move counts', () => {
        const game = new XiangqiGame();
        assert.strictEqual(game.turn, RED);
        assert.strictEqual(game.gameOver, false);
        assert.strictEqual(game.winner, null);

        // In standard initial Xiangqi position, Red has 44 legal moves
        const legalMoves = game.getAllLegalMoves(RED);
        assert.strictEqual(legalMoves.length, 44);

        // FEN verification
        const fen = game.toFen();
        assert.strictEqual(fen, 'rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR w');
    });

    await t.test('2. Flying General (飞将) rule', () => {
        const game = new XiangqiGame();
        // Setup: Kings facing each other on column 4 with only one piece between them
        const emptyBoard = Array.from({ length: 10 }, () => Array(9).fill(null));
        emptyBoard[0][4] = 'k'; // Black King at (0,4)
        emptyBoard[4][4] = 'R'; // Red Chariot at (4,4) blocking
        emptyBoard[9][4] = 'K'; // Red King at (9,4)

        game.loadBoard(emptyBoard, RED);
        assert.strictEqual(game.areKingsFacing(game.board), false);

        // Moving the chariot away horizontally exposes Red King to Black King -> Flying general violation!
        const illegalMove = { from: { r: 4, c: 4 }, to: { r: 4, c: 0 }, piece: 'R' };
        assert.strictEqual(game.isMoveLegal(illegalMove, RED), false);

        // Moving the chariot vertically along column 4 maintains blockage -> LEGAL!
        const legalMove = { from: { r: 4, c: 4 }, to: { r: 5, c: 4 }, piece: 'R' };
        assert.strictEqual(game.isMoveLegal(legalMove, RED), true);

        // King moving directly to face the enemy king is also illegal
        const game2 = new XiangqiGame();
        const b2 = Array.from({ length: 10 }, () => Array(9).fill(null));
        b2[0][3] = 'k'; // Black King at (0,3)
        b2[9][4] = 'K'; // Red King at (9,4)
        game2.loadBoard(b2, RED);

        // Moving Red King to (9,3) would face Black King directly without any pieces in col 3 -> ILLEGAL
        const kingStep = { from: { r: 9, c: 4 }, to: { r: 9, c: 3 }, piece: 'K' };
        assert.strictEqual(game2.isMoveLegal(kingStep, RED), false);
    });

    await t.test('3. Pinned pieces (cannot move if it exposes King)', () => {
        const game = new XiangqiGame();
        const b = Array.from({ length: 10 }, () => Array(9).fill(null));
        b[0][4] = 'r'; // Black Chariot at (0,4)
        b[7][4] = 'H'; // Red Horse at (7,4) pinning
        b[9][4] = 'K'; // Red King at (9,4)
        game.loadBoard(b, RED);

        // Horse is pinned by chariot. Any horse leap exposes Red King to Chariot -> ILLEGAL
        const horseMoves = game.getLegalMovesForPiece(7, 4);
        assert.strictEqual(horseMoves.length, 0, 'Pinned horse must have 0 legal moves');
    });

    await t.test('4. Horse blocked leg (蹩马腿)', () => {
        const game = new XiangqiGame();
        const b = Array.from({ length: 10 }, () => Array(9).fill(null));
        b[9][4] = 'K'; // Red King at (9,4)
        b[0][3] = 'k'; // Black King at (0,3) (separate file)
        b[4][4] = 'H'; // Red Horse at (4,4)
        game.loadBoard(b, RED);

        // Unblocked horse in center has 8 pseudo-legal leaps
        let moves = game.getLegalMovesForPiece(4, 4);
        assert.strictEqual(moves.length, 8);

        // Block south leg at (5,4) with a soldier
        b[5][4] = 'P';
        game.loadBoard(b, RED);
        moves = game.getLegalMovesForPiece(4, 4);
        // Losing 2 jumps: (6,3) and (6,5) -> 6 left
        assert.strictEqual(moves.length, 6);
        assert.strictEqual(moves.some(m => m.to.r === 6 && m.to.c === 3), false);
        assert.strictEqual(moves.some(m => m.to.r === 6 && m.to.c === 5), false);

        // Block north leg at (3,4) as well
        b[3][4] = 'p';
        game.loadBoard(b, RED);
        moves = game.getLegalMovesForPiece(4, 4);
        // Losing 2 more jumps: (2,3) and (2,5) -> 4 left
        assert.strictEqual(moves.length, 4);
    });

    await t.test('5. Elephant blocked eye (塞象眼) and river limit', () => {
        const game = new XiangqiGame();
        const b = Array.from({ length: 10 }, () => Array(9).fill(null));
        b[9][4] = 'K';
        b[0][3] = 'k'; // Black King at (0,3) (separate file)
        b[9][2] = 'E'; // Red Elephant at (9,2)
        game.loadBoard(b, RED);

        // Red Elephant at (9,2) can normally move to (7,0) and (7,4)
        let moves = game.getLegalMovesForPiece(9, 2);
        assert.strictEqual(moves.length, 2);

        // Block eye at (8,1) towards (7,0)
        b[8][1] = 'P';
        game.loadBoard(b, RED);
        moves = game.getLegalMovesForPiece(9, 2);
        assert.strictEqual(moves.length, 1);
        assert.strictEqual(moves[0].to.r, 7);
        assert.strictEqual(moves[0].to.c, 4);

        // River boundary: Red elephant at (5,2) cannot cross to row 3 (across river)
        const b2 = Array.from({ length: 10 }, () => Array(9).fill(null));
        b2[9][4] = 'K';
        b2[0][3] = 'k';
        b2[5][2] = 'E'; // Red elephant on river bank
        game.loadBoard(b2, RED);
        const bankMoves = game.getLegalMovesForPiece(5, 2);
        assert.strictEqual(bankMoves.every(m => m.to.r >= 5), true, 'Elephant cannot cross river');
    });

    await t.test('6. Cannon mechanics (movement vs jumping capture with screen)', () => {
        const game = new XiangqiGame();
        const b = Array.from({ length: 10 }, () => Array(9).fill(null));
        b[9][4] = 'K';
        b[0][3] = 'k';
        b[2][1] = 'C'; // Red Cannon at (2,1)
        b[2][4] = 'p'; // Black pawn at (2,4) - screen
        b[2][7] = 'r'; // Black chariot at (2,7) - target behind screen
        game.loadBoard(b, RED);

        const moves = game.getLegalMovesForPiece(2, 1);
        // Moves to (2,2), (2,3) without capture
        assert.strictEqual(moves.some(m => m.to.r === 2 && m.to.c === 2 && m.captured === null), true);
        assert.strictEqual(moves.some(m => m.to.r === 2 && m.to.c === 3 && m.captured === null), true);
        // Cannot move to (2,4) without capturing screen
        assert.strictEqual(moves.some(m => m.to.r === 2 && m.to.c === 4), false);
        // CAN capture (2,7) over screen (2,4)!
        const captureTarget = moves.find(m => m.to.r === 2 && m.to.c === 7);
        assert.notStrictEqual(captureTarget, undefined);
        assert.strictEqual(captureTarget.captured, 'r');

        // Cannot move past target (2,7) or jump two screens
        assert.strictEqual(moves.some(m => m.to.r === 2 && m.to.c === 8), false);
    });

    await t.test('7. Soldier (兵/卒) river mechanics', () => {
        const game = new XiangqiGame();
        const b = Array.from({ length: 10 }, () => Array(9).fill(null));
        b[9][4] = 'K';
        b[0][3] = 'k'; // Black King at (0,3)
        b[6][4] = 'P'; // Red Soldier before river
        game.loadBoard(b, RED);

        // Before crossing river, can only step forward
        let moves = game.getLegalMovesForPiece(6, 4);
        assert.strictEqual(moves.length, 1);
        assert.strictEqual(moves[0].to.r, 5);
        assert.strictEqual(moves[0].to.c, 4);

        // After crossing river (row <= 4 for Red), can move forward, left, right
        b[4][4] = 'P';
        b[6][4] = null;
        game.loadBoard(b, RED);
        moves = game.getLegalMovesForPiece(4, 4);
        assert.strictEqual(moves.length, 3);
        const destinations = moves.map(m => `${m.to.r},${m.to.c}`).sort();
        assert.deepStrictEqual(destinations, ['3,4', '4,3', '4,5']);
    });

    await t.test('8. Checkmate detection', () => {
        const game = new XiangqiGame();
        // Setup:
        // Black King trapped at (0,4)
        // Red King at (9,4) controls file 4 (flying general)
        // Red Chariot at (0,1) delivers checkmate along row 0
        const b = Array.from({ length: 10 }, () => Array(9).fill(null));
        b[0][4] = 'k'; // Black King at (0,4)
        b[9][4] = 'K'; // Red King at (9,4)
        b[0][1] = 'R'; // Red Chariot delivering checkmate on row 0
        b[8][3] = 'A'; // Red Advisor defending (9,4) so the flying-general capture is illegal

        game.loadBoard(b, BLACK);
        assert.strictEqual(game.gameOver, true);
        assert.strictEqual(game.winner, RED);
        assert.strictEqual(game.winReason, 'checkmate');
    });

    await t.test('9. Stalemate is a LOSS in Xiangqi (困毙)', () => {
        const game = new XiangqiGame();
        const b = Array.from({ length: 10 }, () => Array(9).fill(null));
        b[0][3] = 'k'; // Black King
        b[9][5] = 'K'; // Red King
        b[2][4] = 'R'; // Covers col 4 (square 0,4)
        b[1][8] = 'R'; // Covers row 1 (square 1,3)

        game.loadBoard(b, BLACK);
        assert.strictEqual(game.isCheck(BLACK), false, 'Black is not in check');
        assert.strictEqual(game.getAllLegalMoves(BLACK).length, 0, 'Black has no legal moves');
        assert.strictEqual(game.gameOver, true, 'Game must be over');
        assert.strictEqual(game.winner, RED, 'In Xiangqi, stalemate is a LOSS for stalemated side');
        assert.strictEqual(game.winReason, 'stalemate');
    });

    await t.test('10. Threefold repetition draw', () => {
        const game = new XiangqiGame();
        // Two chariots making non-checking back-and-forth idle moves
        const b = Array.from({ length: 10 }, () => Array(9).fill(null));
        b[9][4] = 'K';
        b[0][3] = 'k'; // Separate file
        b[6][0] = 'R'; // Red Chariot at (6,0)
        b[3][8] = 'r'; // Black Chariot at (3,8)
        game.loadBoard(b, RED);

        // Cycle 1
        assert.strictEqual(game.makeMove({ from: { r: 6, c: 0 }, to: { r: 6, c: 1 } }).success, true);
        assert.strictEqual(game.makeMove({ from: { r: 3, c: 8 }, to: { r: 3, c: 7 } }).success, true);
        assert.strictEqual(game.makeMove({ from: { r: 6, c: 1 }, to: { r: 6, c: 0 } }).success, true);
        assert.strictEqual(game.makeMove({ from: { r: 3, c: 7 }, to: { r: 3, c: 8 } }).success, true);
        assert.strictEqual(game.gameOver, false);

        // Cycle 2
        assert.strictEqual(game.makeMove({ from: { r: 6, c: 0 }, to: { r: 6, c: 1 } }).success, true);
        assert.strictEqual(game.makeMove({ from: { r: 3, c: 8 }, to: { r: 3, c: 7 } }).success, true);
        assert.strictEqual(game.makeMove({ from: { r: 6, c: 1 }, to: { r: 6, c: 0 } }).success, true);
        const res = game.makeMove({ from: { r: 3, c: 7 }, to: { r: 3, c: 8 } });

        // Position reached 3 times with neither giving perpetual check -> Draw!
        assert.strictEqual(res.success, true);
        assert.strictEqual(game.gameOver, true);
        assert.strictEqual(game.winner, null, 'Draw on 3-fold repetition');
        assert.strictEqual(game.winReason, 'repetition_draw');
    });

    await t.test('11. Perpetual check (长将) forfeit', () => {
        const game = new XiangqiGame();
        // Setup where Red Chariot perpetually checks Black King
        // Black King shuttles between (0,4) and (0,5)
        // Red Chariot shuttles between (1,4) and (1,5) constantly delivering check
        const b = Array.from({ length: 10 }, () => Array(9).fill(null));
        b[0][4] = 'k'; // Black King at (0,4)
        b[9][0] = 'K'; // Red King at (9,0)
        b[1][4] = 'R'; // Red Chariot at (1,4) currently giving check!
        game.loadBoard(b, BLACK);

        // Cycle 1:
        // Black escapes check to (0,5)
        assert.strictEqual(game.makeMove({ from: { r: 0, c: 4 }, to: { r: 0, c: 5 } }).success, true);
        // Red chases and gives check at (1,5)
        const m1 = game.makeMove({ from: { r: 1, c: 4 }, to: { r: 1, c: 5 } });
        assert.strictEqual(m1.success, true);
        assert.strictEqual(m1.inCheck, true);

        // Black escapes back to (0,4)
        assert.strictEqual(game.makeMove({ from: { r: 0, c: 5 }, to: { r: 0, c: 4 } }).success, true);
        // Red chases back and gives check at (1,4)
        const m2 = game.makeMove({ from: { r: 1, c: 5 }, to: { r: 1, c: 4 } });
        assert.strictEqual(m2.success, true);
        assert.strictEqual(m2.inCheck, true);

        // Cycle 2:
        // Black escapes to (0,5)
        assert.strictEqual(game.makeMove({ from: { r: 0, c: 4 }, to: { r: 0, c: 5 } }).success, true);
        // Red chases and gives check at (1,5)
        const m3 = game.makeMove({ from: { r: 1, c: 4 }, to: { r: 1, c: 5 } });
        assert.strictEqual(m3.success, true);
        assert.strictEqual(m3.inCheck, true);

        // Black escapes back to (0,4)
        assert.strictEqual(game.makeMove({ from: { r: 0, c: 5 }, to: { r: 0, c: 4 } }).success, true);
        // Red chases back and gives check at (1,4) -> 3rd occurrence reached!
        const m4 = game.makeMove({ from: { r: 1, c: 5 }, to: { r: 1, c: 4 } });
        assert.strictEqual(m4.success, true);

        // Red is delivering perpetual check! Red forfeits, Black wins!
        assert.strictEqual(game.gameOver, true);
        assert.strictEqual(game.winner, BLACK, 'Perpetual checker (Red) forfeits');
        assert.strictEqual(game.winReason, 'perpetual_check');
    });

    await t.test('12. flying general capture is a legal king move', () => {
        const game = new XiangqiGame();
        // Generals facing each other on file 4 with a clear path: Red to move is in
        // "flying general" check and may capture the enemy general.
        const b = Array.from({ length: 10 }, () => Array(9).fill(null));
        b[0][4] = 'k'; // Black King at (0,4)
        b[9][4] = 'K'; // Red King at (9,4)
        game.loadBoard(b, RED);

        const moves = game.getLegalMovesForPiece(9, 4);
        const flyCapture = moves.find(m => m.to.r === 0 && m.to.c === 4);
        assert.notStrictEqual(flyCapture, undefined, 'Flying general capture must be a legal king move');
        assert.strictEqual(flyCapture.captured, 'k');

        // Stepping along the file without capturing is still illegal (kings would face)
        assert.strictEqual(moves.some(m => m.to.r === 8 && m.to.c === 4), false);

        const res = game.makeMove({ from: { r: 9, c: 4 }, to: { r: 0, c: 4 } });
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.captured, 'k');
        assert.strictEqual(game.gameOver, true);
        assert.strictEqual(game.winner, RED);
        assert.strictEqual(game.winReason, 'general_captured');
        assert.deepStrictEqual(game.captured.black, ['k']);
    });
});
