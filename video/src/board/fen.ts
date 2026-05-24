export type Square =
  | "a1" | "b1" | "c1" | "d1" | "e1" | "f1" | "g1" | "h1"
  | "a2" | "b2" | "c2" | "d2" | "e2" | "f2" | "g2" | "h2"
  | "a3" | "b3" | "c3" | "d3" | "e3" | "f3" | "g3" | "h3"
  | "a4" | "b4" | "c4" | "d4" | "e4" | "f4" | "g4" | "h4"
  | "a5" | "b5" | "c5" | "d5" | "e5" | "f5" | "g5" | "h5"
  | "a6" | "b6" | "c6" | "d6" | "e6" | "f6" | "g6" | "h6"
  | "a7" | "b7" | "c7" | "d7" | "e7" | "f7" | "g7" | "h7"
  | "a8" | "b8" | "c8" | "d8" | "e8" | "f8" | "g8" | "h8";

export type PieceCode =
  | "wP" | "wN" | "wB" | "wR" | "wQ" | "wK"
  | "bP" | "bN" | "bB" | "bR" | "bQ" | "bK";

const FEN_TO_CODE: Record<string, PieceCode> = {
  P: "wP", N: "wN", B: "wB", R: "wR", Q: "wQ", K: "wK",
  p: "bP", n: "bN", b: "bB", r: "bR", q: "bQ", k: "bK",
};

export type BoardMap = Partial<Record<Square, PieceCode>>;

export function parseFen(fen: string): BoardMap {
  const placement = fen.split(" ")[0];
  const ranks = placement.split("/");
  const board: BoardMap = {};
  for (let r = 0; r < 8; r++) {
    const rank = 8 - r;
    let file = 0;
    for (const ch of ranks[r]) {
      if (/[1-8]/.test(ch)) {
        file += Number(ch);
      } else {
        const code = FEN_TO_CODE[ch];
        if (code) {
          const sq = (String.fromCharCode(97 + file) + rank) as Square;
          board[sq] = code;
        }
        file += 1;
      }
    }
  }
  return board;
}

export function squareToXY(square: Square, sizePx: number): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const cell = sizePx / 8;
  return { x: file * cell, y: (8 - rank) * cell };
}

export function isLightSquare(square: Square): boolean {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return (file + rank) % 2 === 1;
}

export function findKingSquare(fen: string, color: "w" | "b"): Square | null {
  const board = parseFen(fen);
  const target: PieceCode = color === "w" ? "wK" : "bK";
  for (const [sq, code] of Object.entries(board)) {
    if (code === target) return sq as Square;
  }
  return null;
}
