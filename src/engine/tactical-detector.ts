import { Chess, type Square, type PieceSymbol, type Color } from 'chess.js';
import type { TacticalMotif } from '@shared/types/engine';

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100,
};

/** Ray directions: [row delta, col delta] */
const DIAGONALS: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const STRAIGHT: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const ALL_RAYS: [number, number][] = [...DIAGONALS, ...STRAIGHT];

function squareToRowCol(sq: Square): [number, number] {
  return [8 - parseInt(sq[1]), sq.charCodeAt(0) - 97];
}

function rowColToSquare(row: number, col: number): Square | null {
  if (row < 0 || row > 7 || col < 0 || col > 7) return null;
  return `${'abcdefgh'[col]}${8 - row}` as Square;
}

/**
 * Detect tactical motifs in a position where the best move was missed.
 * Analyzes both the best move (what should have been played) and the
 * resulting position to identify patterns.
 */
export function detectTacticalMotifs(
  fen: string,
  bestMoveUci: string,
  playedMoveUci: string,
): TacticalMotif[] {
  const motifs: TacticalMotif[] = [];

  try {
    // Check what the best move achieves
    if (bestMoveUci) {
      const bestMotifs = analyzeMove(fen, bestMoveUci);
      motifs.push(...bestMotifs);
    }

    // Check what the played move creates (hanging pieces, etc.)
    if (playedMoveUci) {
      const playedMotifs = analyzeAfterMove(fen, playedMoveUci);
      motifs.push(...playedMotifs);
    }
  } catch {
    // Position analysis failed, return empty
  }

  // Deduplicate
  return [...new Set(motifs)];
}

/**
 * Analyze what a move achieves tactically.
 */
function analyzeMove(fen: string, moveUci: string): TacticalMotif[] {
  const motifs: TacticalMotif[] = [];
  const chess = new Chess(fen);

  const from = moveUci.slice(0, 2) as Square;
  const to = moveUci.slice(2, 4) as Square;
  const promotion = moveUci.length > 4 ? (moveUci[4] as PieceSymbol) : undefined;

  const movingPiece = chess.get(from);
  if (!movingPiece) return motifs;

  // Make the move
  try {
    chess.move({ from, to, promotion });
  } catch {
    return motifs;
  }

  const color = movingPiece.color;
  const opponentColor: Color = color === 'w' ? 'b' : 'w';

  // ── Fork detection ──
  const forkTargets = getAttackedPieces(chess, to, opponentColor);
  const valuableTargets = forkTargets.filter(
    (t) => PIECE_VALUES[t.piece] > PIECE_VALUES[movingPiece.type] || t.piece === 'k',
  );
  if (valuableTargets.length >= 2) {
    motifs.push('fork');
  }

  // ── Pin detection ──
  if (detectPins(chess, color).length > 0) {
    motifs.push('pin');
  }

  // ── Skewer detection ──
  if (detectSkewers(chess, color).length > 0) {
    motifs.push('skewer');
  }

  // ── Discovered attack detection ──
  if (detectDiscoveredAttack(fen, moveUci, movingPiece.color)) {
    motifs.push('discovered_attack');
  }

  // ── Back rank threats ──
  if (detectBackRankThreat(chess, opponentColor)) {
    motifs.push('back_rank');
  }

  // ── Pawn promotion threats ──
  if (movingPiece.type === 'p') {
    const rank = parseInt(to[1]);
    if ((color === 'w' && rank === 7) || (color === 'b' && rank === 2)) {
      motifs.push('pawn_promotion_threat');
    }
  }

  return motifs;
}

/**
 * Analyze the position after a move for defensive weaknesses.
 */
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

  // Check for hanging pieces after the move
  if (detectHangingPieces(chess, playerColor)) {
    motifs.push('hanging_piece');
  }

  return motifs;
}

/**
 * Detect pins created by the attacking color's sliding pieces.
 * A pin exists when a sliding piece (B/R/Q) has exactly one enemy piece
 * between itself and the enemy king (or queen).
 */
function detectPins(chess: Chess, attackingColor: Color): Array<{
  pinner: Square;
  pinnedPiece: Square;
  pinnedTo: Square;
}> {
  const pins: Array<{ pinner: Square; pinnedPiece: Square; pinnedTo: Square }> = [];
  const board = chess.board();
  const defendingColor: Color = attackingColor === 'w' ? 'b' : 'w';

  // Find all sliding pieces of the attacking color
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece || piece.color !== attackingColor) continue;

      // Determine which rays this piece can use
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
          const p = board[r][c];

          if (p) {
            if (!firstPiece) {
              // First piece on ray — could be the pinned piece
              if (p.color === defendingColor) {
                firstPiece = { square: sq, piece: p.type, color: p.color };
              } else {
                break; // Own piece blocks the ray
              }
            } else {
              // Second piece on ray — check if it's a high-value target
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

/**
 * Detect skewers created by the attacking color's sliding pieces.
 * A skewer is like a reverse pin: the high-value piece is in front
 * and a lower-value piece is behind it on the same ray.
 */
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
      const piece = board[row][col];
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
          const p = board[r][c];

          if (p) {
            if (!firstPiece) {
              // First piece: must be a high-value defending piece under attack
              if (p.color === defendingColor && (p.type === 'k' || p.type === 'q' || p.type === 'r')) {
                firstPiece = { square: sq, piece: p.type, color: p.color };
              } else {
                break;
              }
            } else {
              // Second piece: must be a same-color lower-value piece
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

/**
 * Detect discovered attacks: when a piece moves and reveals an attack
 * from a sliding piece behind it onto a high-value enemy piece.
 */
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

  // Find sliding pieces of movingColor that are on the same ray as 'from'
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = boardBefore[row][col];
      if (!piece || piece.color !== movingColor) continue;
      if (piece.type !== 'b' && piece.type !== 'r' && piece.type !== 'q') continue;

      // Check if 'from' square is on a ray from this piece
      const dr = Math.sign(fromRow - row);
      const dc = Math.sign(fromCol - col);

      // Must be on a valid ray for this piece type
      const isDiag = Math.abs(dr) === 1 && Math.abs(dc) === 1;
      const isStraight = (dr === 0) !== (dc === 0);

      if (piece.type === 'b' && !isDiag) continue;
      if (piece.type === 'r' && !isStraight) continue;
      if (!isDiag && !isStraight) continue;

      // Check that 'from' is on the ray between this piece and the first piece encountered
      let r = row + dr;
      let c = col + dc;
      let foundFrom = false;
      while (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
        if (r === fromRow && c === fromCol) {
          foundFrom = true;
          break;
        }
        const p = boardBefore[r][c];
        if (p) break; // Something else blocks
        r += dr;
        c += dc;
      }

      if (!foundFrom) continue;

      // Now check if after the move, this sliding piece attacks a high-value enemy piece
      r = fromRow + dr;
      c = fromCol + dc;
      while (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
        const p = boardAfter[r][c];
        if (p) {
          if (p.color === opponentColor && PIECE_VALUES[p.type] >= 5) {
            return true; // Discovered attack on rook, queen, or king
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

/**
 * Get pieces of a given color that are attacked by a piece on a square.
 */
function getAttackedPieces(
  chess: Chess,
  square: Square,
  targetColor: Color,
): Array<{ square: Square; piece: PieceSymbol }> {
  const attacked: Array<{ square: Square; piece: PieceSymbol }> = [];

  // Get all squares attacked by the piece on 'square'
  const moves = chess.moves({ square, verbose: true });

  for (const move of moves) {
    const targetPiece = chess.get(move.to as Square);
    if (targetPiece && targetPiece.color === targetColor) {
      attacked.push({ square: move.to as Square, piece: targetPiece.type });
    }
  }

  return attacked;
}

/**
 * Detect if any pieces of the given color are hanging (attacked but not adequately defended).
 */
function detectHangingPieces(chess: Chess, color: Color): boolean {
  const board = chess.board();
  const opponentColor: Color = color === 'w' ? 'b' : 'w';

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece || piece.color !== color || piece.type === 'k') continue;

      const square = `${'abcdefgh'[col]}${8 - row}` as Square;

      // Check if this piece is attacked by the opponent
      if (chess.isAttacked(square, opponentColor)) {
        // Check if piece is defended (attacked by its own side)
        const isDefended = chess.isAttacked(square, color);
        if (!isDefended && PIECE_VALUES[piece.type] >= 3) {
          return true; // Undefended piece worth ≥ 3 is hanging
        }
      }
    }
  }

  return false;
}

/**
 * Detect back rank weakness for the given color.
 */
function detectBackRankThreat(chess: Chess, targetColor: Color): boolean {
  const backRank = targetColor === 'w' ? '1' : '8';

  // Find the king
  const board = chess.board();
  let kingSquare: Square | null = null;

  for (let col = 0; col < 8; col++) {
    const row = targetColor === 'w' ? 7 : 0;
    const piece = board[row][col];
    if (piece?.type === 'k' && piece.color === targetColor) {
      kingSquare = `${'abcdefgh'[col]}${backRank}` as Square;
      break;
    }
  }

  if (!kingSquare) return false;

  // Check if king is on the back rank and boxed in by its own pawns
  const kingCol = kingSquare.charCodeAt(0) - 97;
  const pawnRow = targetColor === 'w' ? 6 : 1;

  let boxedIn = true;
  for (let dc = -1; dc <= 1; dc++) {
    const col = kingCol + dc;
    if (col < 0 || col > 7) continue;
    const pawn = board[pawnRow][col];
    if (!pawn || pawn.type !== 'p' || pawn.color !== targetColor) {
      boxedIn = false;
      break;
    }
  }

  return boxedIn;
}
