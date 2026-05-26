/**
 * Tactical motif detection.
 * Verbatim port of src/engine/tactical-detector.ts. Keep in sync.
 *
 * Pure chess.js-based analysis — no Stockfish dependency. Same input/output
 * contract as the browser version.
 */
import { Chess, type Square, type PieceSymbol, type Color } from 'chess.js';
import type { TacticalMotif, PositionEval } from '../types.js';

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100,
};

const DIAGONALS: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const STRAIGHT: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const ALL_RAYS: [number, number][] = [...DIAGONALS, ...STRAIGHT];

function squareToRowCol(sq: Square): [number, number] {
  return [8 - parseInt(sq[1]!), sq.charCodeAt(0) - 97];
}

function rowColToSquare(row: number, col: number): Square | null {
  if (row < 0 || row > 7 || col < 0 || col > 7) return null;
  return `${'abcdefgh'[col]}${8 - row}` as Square;
}

export function detectTacticalMotifs(
  fen: string,
  bestMoveUci: string,
  playedMoveUci: string,
): TacticalMotif[] {
  const motifs: TacticalMotif[] = [];

  try {
    if (bestMoveUci) {
      const bestMotifs = analyzeMove(fen, bestMoveUci);
      motifs.push(...bestMotifs);
    }

    if (playedMoveUci) {
      const playedMotifs = analyzeAfterMove(fen, playedMoveUci);
      motifs.push(...playedMotifs);
    }
  } catch {
    // ignore
  }

  return [...new Set(motifs)];
}

function analyzeMove(fen: string, moveUci: string): TacticalMotif[] {
  const motifs: TacticalMotif[] = [];
  const chess = new Chess(fen);

  const from = moveUci.slice(0, 2) as Square;
  const to = moveUci.slice(2, 4) as Square;
  const promotion = moveUci.length > 4 ? (moveUci[4] as PieceSymbol) : undefined;

  const movingPiece = chess.get(from);
  if (!movingPiece) return motifs;

  try {
    chess.move({ from, to, promotion });
  } catch {
    return motifs;
  }

  const color = movingPiece.color;
  const opponentColor: Color = color === 'w' ? 'b' : 'w';

  const forkTargets = getAttackedPieces(chess, to, opponentColor);
  const valuableTargets = forkTargets.filter(
    (t) => PIECE_VALUES[t.piece] > PIECE_VALUES[movingPiece.type] || t.piece === 'k',
  );
  if (valuableTargets.length >= 2) {
    motifs.push('fork');
  }

  if (detectPins(chess, color).length > 0) {
    motifs.push('pin');
  }

  if (detectSkewers(chess, color).length > 0) {
    motifs.push('skewer');
  }

  if (detectDiscoveredAttack(fen, moveUci, movingPiece.color)) {
    motifs.push('discovered_attack');
  }

  if (detectBackRankThreat(chess, opponentColor)) {
    motifs.push('back_rank');
  }

  if (movingPiece.type === 'p') {
    const rank = parseInt(to[1]!);
    if ((color === 'w' && rank === 7) || (color === 'b' && rank === 2)) {
      motifs.push('pawn_promotion_threat');
    }
  }

  return motifs;
}

function analyzeAfterMove(fen: string, moveUci: string): TacticalMotif[] {
  const motifs: TacticalMotif[] = [];
  const chess = new Chess(fen);

  const from = moveUci.slice(0, 2) as Square;
  const to = moveUci.slice(2, 4) as Square;
  const promotion = moveUci.length > 4 ? (moveUci[4] as PieceSymbol) : undefined;

  const movingPiece = chess.get(from);
  if (!movingPiece) return motifs;

  try {
    chess.move({ from, to, promotion });
  } catch {
    return motifs;
  }

  const playerColor = movingPiece.color;

  if (detectHangingPieces(chess, playerColor)) {
    motifs.push('hanging_piece');
  }

  return motifs;
}

function detectPins(chess: Chess, attackingColor: Color): Array<{
  pinner: Square;
  pinnedPiece: Square;
  pinnedTo: Square;
}> {
  const pins: Array<{ pinner: Square; pinnedPiece: Square; pinnedTo: Square }> = [];
  const board = chess.board();
  const defendingColor: Color = attackingColor === 'w' ? 'b' : 'w';

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row]![col];
      if (!piece || piece.color !== attackingColor) continue;

      let rays: [number, number][] = [];
      if (piece.type === 'b') rays = DIAGONALS;
      else if (piece.type === 'r') rays = STRAIGHT;
      else if (piece.type === 'q') rays = ALL_RAYS;
      else continue;

      const pinnerSquare = rowColToSquare(row, col)!;

      for (const [dr, dc] of rays) {
        let r = row + dr;
        let c = col + dc;
        let firstPiece: { square: Square; piece: PieceSymbol; color: Color } | null = null;

        while (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
          const sq = rowColToSquare(r, c)!;
          const p = board[r]![c];

          if (p) {
            if (!firstPiece) {
              if (p.color === defendingColor) {
                firstPiece = { square: sq, piece: p.type, color: p.color };
              } else {
                break;
              }
            } else {
              if (p.color === defendingColor && (p.type === 'k' || p.type === 'q')) {
                pins.push({
                  pinner: pinnerSquare,
                  pinnedPiece: firstPiece.square,
                  pinnedTo: sq,
                });
              }
              break;
            }
          }

          r += dr;
          c += dc;
        }
      }
    }
  }

  return pins;
}

function detectSkewers(chess: Chess, attackingColor: Color): Array<{
  attacker: Square;
  frontPiece: Square;
  backPiece: Square;
}> {
  const skewers: Array<{ attacker: Square; frontPiece: Square; backPiece: Square }> = [];
  const board = chess.board();
  const defendingColor: Color = attackingColor === 'w' ? 'b' : 'w';

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row]![col];
      if (!piece || piece.color !== attackingColor) continue;

      let rays: [number, number][] = [];
      if (piece.type === 'b') rays = DIAGONALS;
      else if (piece.type === 'r') rays = STRAIGHT;
      else if (piece.type === 'q') rays = ALL_RAYS;
      else continue;

      const attackerSquare = rowColToSquare(row, col)!;

      for (const [dr, dc] of rays) {
        let r = row + dr;
        let c = col + dc;
        let firstPiece: { square: Square; piece: PieceSymbol; color: Color } | null = null;

        while (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
          const sq = rowColToSquare(r, c)!;
          const p = board[r]![c];

          if (p) {
            if (!firstPiece) {
              if (p.color === defendingColor && (p.type === 'k' || p.type === 'q' || p.type === 'r')) {
                firstPiece = { square: sq, piece: p.type, color: p.color };
              } else {
                break;
              }
            } else {
              if (p.color === defendingColor && PIECE_VALUES[p.type] < PIECE_VALUES[firstPiece.piece]) {
                skewers.push({
                  attacker: attackerSquare,
                  frontPiece: firstPiece.square,
                  backPiece: sq,
                });
              }
              break;
            }
          }

          r += dr;
          c += dc;
        }
      }
    }
  }

  return skewers;
}

function detectDiscoveredAttack(
  fenBefore: string,
  moveUci: string,
  movingColor: Color,
): boolean {
  const chessBefore = new Chess(fenBefore);
  const chessAfter = new Chess(fenBefore);

  const from = moveUci.slice(0, 2) as Square;
  const to = moveUci.slice(2, 4) as Square;
  const promotion = moveUci.length > 4 ? (moveUci[4] as PieceSymbol) : undefined;

  try {
    chessAfter.move({ from, to, promotion });
  } catch {
    return false;
  }

  const opponentColor: Color = movingColor === 'w' ? 'b' : 'w';
  const boardBefore = chessBefore.board();
  const boardAfter = chessAfter.board();
  const [fromRow, fromCol] = squareToRowCol(from);

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = boardBefore[row]![col];
      if (!piece || piece.color !== movingColor) continue;
      if (piece.type !== 'b' && piece.type !== 'r' && piece.type !== 'q') continue;

      const dr = Math.sign(fromRow - row);
      const dc = Math.sign(fromCol - col);

      const isDiag = Math.abs(dr) === 1 && Math.abs(dc) === 1;
      const isStraight = (dr === 0) !== (dc === 0);

      if (piece.type === 'b' && !isDiag) continue;
      if (piece.type === 'r' && !isStraight) continue;
      if (!isDiag && !isStraight) continue;

      let r = row + dr;
      let c = col + dc;
      let foundFrom = false;
      while (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
        if (r === fromRow && c === fromCol) {
          foundFrom = true;
          break;
        }
        const p = boardBefore[r]![c];
        if (p) break;
        r += dr;
        c += dc;
      }

      if (!foundFrom) continue;

      r = fromRow + dr;
      c = fromCol + dc;
      while (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
        const p = boardAfter[r]![c];
        if (p) {
          if (p.color === opponentColor && PIECE_VALUES[p.type] >= 5) {
            return true;
          }
          break;
        }
        r += dr;
        c += dc;
      }
    }
  }

  return false;
}

function getAttackedPieces(
  chess: Chess,
  square: Square,
  targetColor: Color,
): Array<{ square: Square; piece: PieceSymbol }> {
  const attacked: Array<{ square: Square; piece: PieceSymbol }> = [];

  const moves = chess.moves({ square, verbose: true });

  for (const move of moves) {
    const targetPiece = chess.get(move.to as Square);
    if (targetPiece && targetPiece.color === targetColor) {
      attacked.push({ square: move.to as Square, piece: targetPiece.type });
    }
  }

  return attacked;
}

function detectHangingPieces(chess: Chess, color: Color): boolean {
  const board = chess.board();
  const opponentColor: Color = color === 'w' ? 'b' : 'w';

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row]![col];
      if (!piece || piece.color !== color || piece.type === 'k') continue;

      const square = `${'abcdefgh'[col]}${8 - row}` as Square;

      if (chess.isAttacked(square, opponentColor)) {
        const isDefended = chess.isAttacked(square, color);
        if (!isDefended && PIECE_VALUES[piece.type] >= 3) {
          return true;
        }
      }
    }
  }

  return false;
}

export function deriveAdditionalMotifs(args: {
  fenBefore: string;
  fenAfter: string;
  moveSan: string;
  moveUci: string;
  isCheck: boolean;
  isCastling: boolean;
  evalBefore: PositionEval;
  evalAfter: PositionEval;
}): TacticalMotif[] {
  const motifs: TacticalMotif[] = [];
  const { fenBefore, fenAfter, moveSan, moveUci, isCheck, isCastling, evalAfter } = args;

  if (isCastling) motifs.push('castling_move');

  if (moveUci.length === 5) {
    const promoPiece = moveUci[4]!.toLowerCase();
    if (promoPiece === 'q') {
      motifs.push('promotion');
    } else if (promoPiece === 'r' || promoPiece === 'b' || promoPiece === 'n') {
      motifs.push('under_promotion');
    }
  }

  try {
    if (moveSan.includes('x') && moveUci.length >= 4) {
      const chessBefore = new Chess(fenBefore);
      const from = moveUci.slice(0, 2) as Square;
      const to = moveUci.slice(2, 4) as Square;
      const movingPiece = chessBefore.get(from);
      const targetSquarePiece = chessBefore.get(to);
      if (movingPiece?.type === 'p' && !targetSquarePiece) {
        motifs.push('en_passant');
      }
    }
  } catch {
    // ignore
  }

  if (evalAfter.scoreType === 'mate') {
    const n = Math.abs(evalAfter.score);
    if (evalAfter.score < 0 && n >= 1 && n <= 5) {
      const tag = `mate_in_${n}` as TacticalMotif;
      motifs.push(tag);
    } else if (evalAfter.score > 0 && n <= 5) {
      motifs.push('mate_threat');
    }
  }

  try {
    const chessAfter = new Chess(fenAfter);
    if (chessAfter.isCheckmate()) {
      const mateKind = classifyMate(chessAfter);
      if (mateKind === 'back_rank') motifs.push('back_rank_mate');
      else if (mateKind === 'smothered') motifs.push('smothered_mate');
    }

    if (!chessAfter.isCheckmate()) {
      const sideToMove = chessAfter.turn();
      const moverColor: Color = sideToMove === 'w' ? 'b' : 'w';
      if (isKingExposed(chessAfter, sideToMove) && evalAfter.scoreType === 'cp' && evalAfter.score > 100) {
        motifs.push('exposed_king');
      }
      void moverColor;
    }

    if (isCheck && isDoubleCheck(fenBefore, moveUci)) {
      motifs.push('double_check');
    }
  } catch {
    // ignore
  }

  return [...new Set(motifs)];
}

function classifyMate(chessAfter: Chess): 'back_rank' | 'smothered' | 'other' {
  const board = chessAfter.board();
  const matedColor = chessAfter.turn();
  let kingSq: Square | null = null;
  let kingRow = -1;
  let kingCol = -1;
  for (let r = 0; r < 8 && !kingSq; r++) {
    for (let c = 0; c < 8 && !kingSq; c++) {
      const p = board[r]![c];
      if (p?.type === 'k' && p.color === matedColor) {
        kingSq = rowColToSquare(r, c);
        kingRow = r;
        kingCol = c;
      }
    }
  }
  if (!kingSq) return 'other';

  const backRankRow = matedColor === 'w' ? 7 : 0;

  if (kingRow === backRankRow) {
    const pawnShieldRow = matedColor === 'w' ? 6 : 1;
    let allPawnsInFront = true;
    for (let dc = -1; dc <= 1; dc++) {
      const c = kingCol + dc;
      if (c < 0 || c > 7) continue;
      const piece = board[pawnShieldRow]![c];
      if (!piece || piece.type !== 'p' || piece.color !== matedColor) {
        allPawnsInFront = false;
        break;
      }
    }
    if (allPawnsInFront) return 'back_rank';
  }

  let allBlockedByOwn = true;
  for (let dr = -1; dr <= 1 && allBlockedByOwn; dr++) {
    for (let dc = -1; dc <= 1 && allBlockedByOwn; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = kingRow + dr;
      const c = kingCol + dc;
      if (r < 0 || r > 7 || c < 0 || c > 7) continue;
      const piece = board[r]![c];
      if (!piece || piece.color !== matedColor) {
        allBlockedByOwn = false;
      }
    }
  }
  if (allBlockedByOwn) {
    const opponentColor: Color = matedColor === 'w' ? 'b' : 'w';
    const knightOffsets: [number, number][] = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
    ];
    for (const [dr, dc] of knightOffsets) {
      const r = kingRow + dr;
      const c = kingCol + dc;
      if (r < 0 || r > 7 || c < 0 || c > 7) continue;
      const p = board[r]![c];
      if (p?.type === 'n' && p.color === opponentColor) {
        return 'smothered';
      }
    }
  }

  return 'other';
}

function isKingExposed(chess: Chess, color: Color): boolean {
  const board = chess.board();
  let kingRow = -1;
  let kingCol = -1;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r]![c];
      if (p?.type === 'k' && p.color === color) {
        kingRow = r;
        kingCol = c;
        break;
      }
    }
  }
  if (kingRow < 0) return false;

  const expectedBackRank = color === 'w' ? 7 : 0;
  if (Math.abs(kingRow - expectedBackRank) > 1) return false;

  const dr = color === 'w' ? -1 : 1;

  let missingShield = 0;
  for (let dc = -1; dc <= 1; dc++) {
    const c = kingCol + dc;
    if (c < 0 || c > 7) continue;
    const r = kingRow + dr;
    if (r < 0 || r > 7) continue;
    const piece = board[r]![c];
    if (!piece || piece.type !== 'p' || piece.color !== color) {
      missingShield += 1;
    }
  }
  return missingShield >= 2;
}

function isDoubleCheck(fenBefore: string, moveUci: string): boolean {
  try {
    const chess = new Chess(fenBefore);
    const from = moveUci.slice(0, 2) as Square;
    const to = moveUci.slice(2, 4) as Square;
    const promotion = moveUci.length > 4 ? (moveUci[4] as PieceSymbol) : undefined;
    chess.move({ from, to, promotion });

    if (!chess.inCheck()) return false;
    const defenderColor: Color = chess.turn();
    const attackerColor: Color = defenderColor === 'w' ? 'b' : 'w';

    const board = chess.board();
    let kingSq: Square | null = null;
    for (let r = 0; r < 8 && !kingSq; r++) {
      for (let c = 0; c < 8 && !kingSq; c++) {
        const p = board[r]![c];
        if (p?.type === 'k' && p.color === defenderColor) {
          kingSq = rowColToSquare(r, c);
        }
      }
    }
    if (!kingSq) return false;

    let attackerCount = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r]![c];
        if (!p || p.color !== attackerColor) continue;
        const sq = rowColToSquare(r, c)!;
        const moves = chess.moves({ square: sq, verbose: true });
        for (const m of moves) {
          if (m.to === kingSq) {
            attackerCount += 1;
            break;
          }
        }
        if (attackerCount >= 2) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function detectBackRankThreat(chess: Chess, targetColor: Color): boolean {
  const backRank = targetColor === 'w' ? '1' : '8';

  const board = chess.board();
  let kingSquare: Square | null = null;

  for (let col = 0; col < 8; col++) {
    const row = targetColor === 'w' ? 7 : 0;
    const piece = board[row]![col];
    if (piece?.type === 'k' && piece.color === targetColor) {
      kingSquare = `${'abcdefgh'[col]}${backRank}` as Square;
      break;
    }
  }

  if (!kingSquare) return false;

  const kingCol = kingSquare.charCodeAt(0) - 97;
  const pawnRow = targetColor === 'w' ? 6 : 1;

  let boxedIn = true;
  for (let dc = -1; dc <= 1; dc++) {
    const col = kingCol + dc;
    if (col < 0 || col > 7) continue;
    const pawn = board[pawnRow]![col];
    if (!pawn || pawn.type !== 'p' || pawn.color !== targetColor) {
      boxedIn = false;
      break;
    }
  }

  return boxedIn;
}
