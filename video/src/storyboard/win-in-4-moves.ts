import type { Storyboard } from "./types";

// "WIN IN 4 MOVES!" tutorial reel — the classic Scholar's Mate.
// 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#
// Duplicates the style of the reference "Win IN 4 MOVES" reel: punchy title,
// rapid 4-move animation, dramatic checkmate finish with the loser's king
// tipping over.

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const PRE_MATE_FEN = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
const FINAL_FEN = "r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4";

// 7 plies: 1.e4 1...e5 2.Qh5 2...Nc6 3.Bc4 3...Nf6?? 4.Qxf7#
const SEQUENCE_MOVES = ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"];

// Total: 1.4 + 2.4 + 7.4 + 2.0 + 2.4 + 1.8 = 17.4s, matches the audio bed
export const WIN_IN_4_MOVES_STORYBOARD: Storyboard = {
  title: "WIN IN 4 MOVES",
  shots: [
    {
      type: "hook",
      fen: PRE_MATE_FEN,
      highlightSquare: "f7",
      sticker: "??",
      stickerKind: "blunder",
      theme: "pinkBerry",
      durationSec: 1.4,
    },
    {
      type: "title",
      text: "WIN IN 4 MOVES",
      subtitle: "♚  THE SCHOLAR'S MATE  ♚",
      fen: STARTING_FEN,
      theme: "monoSlate",
      durationSec: 2.4,
    },
    {
      type: "moveSequence",
      startFen: STARTING_FEN,
      moves: SEQUENCE_MOVES,
      brilliantMoveIndex: 6, // 4.Qxf7# — the mating move
      caption: "WATCH THE QUEEN",
      theme: "classicGreen",
      startMoveNumber: 1,
      durationSec: 7.4,
    },
    {
      type: "spotlight",
      fen: FINAL_FEN,
      square: "f7",
      glowColor: "#fbbf24",
      caption: "QXF7 — CHECKMATE",
      theme: "monoSlate",
      electric: true,
      zoomScale: 1.8,
      layingPiece: "e8",
      layingPieceColor: "#dc2626",
      durationSec: 2.0,
    },
    {
      type: "punchline",
      fen: FINAL_FEN,
      zoomSquares: ["c4", "f8"],
      sticker: "!!",
      stickerKind: "brilliant",
      stickerSquare: "f7",
      theme: "classicGreen",
      layingPiece: "e8",
      layingPieceColor: "#dc2626",
      durationSec: 2.4,
    },
    {
      type: "outro",
      iconUrl: "brand/chess-dna-icon.png",
      brandName: "Chess DNA",
      cta: "follow for more",
      creditName: "Reegan Palmer",
      creditPrefix: "made by",
      creditPhotoUrl: "photos/reegan.jpg",
      durationSec: 1.8,
    },
  ],
};
