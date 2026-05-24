import type { Storyboard } from "./types";

// Caruana vs. Firouzja — Sinquefield Cup 2025, Round 3, 1-0.
// Both play in the upcoming GCT Superbet Romania 2026 (May 14–23).
//
// We animate only ACTUAL moves played: 38.d6 38...Rd8 39.d7 39...Kg8 40.Rxe5 40...Kf7
// — Caruana's d-pawn breakthrough. The game continued positionally until
// 46.Rd2 when Firouzja resigned (d-pawn was still on d7, never promoted).
// We jump from the breakthrough position to the final resignation position
// so viewers see what actually happened, not a fabricated mate line.

const PRE_BREAKTHROUGH_FEN = "5r1k/6p1/1p3r1p/p2Pp3/P1b4P/4R1P1/3R1PB1/6K1 w - - 0 38";
const AFTER_KF7_FEN = "3r4/3P1kp1/1p3r1p/p3R3/P1b4P/6P1/3R1PB1/6K1 w - - 1 41";
const RESIGNATION_FEN = "3r1k2/3P2p1/1p2r2p/pB6/P6P/4R1P1/b2R1P2/6K1 b - - 12 46";

// Actual game moves 38–40 (6 plies, the d-pawn breakthrough)
const SEQUENCE_MOVES = ["d6", "Rd8", "d7", "Kg8", "Rxe5", "Kf7"];

// Total: 1.4 + 3.0 + 6.0 + 1.8 + 2.2 + 2.6 + 2.6 = 19.6s
// (audio is 17.4s and ends naturally during the outro)
export const DEMO_STORYBOARD: Storyboard = {
  title: "CARUANA BREAKS FIROUZJA",
  shots: [
    {
      type: "hook",
      fen: PRE_BREAKTHROUGH_FEN,
      highlightSquare: "d5",
      sticker: "!?",
      stickerKind: "interesting",
      theme: "pinkBerry",
      durationSec: 1.4,
    },
    {
      type: "vsTitle",
      eventName: "ROMANIA 2026",
      subtitle: "♛ LAST TIME THEY MET... ♛",
      fen: PRE_BREAKTHROUGH_FEN,
      whitePlayer: {
        name: "CARUANA",
        rating: 2784,
        title: "GM",
        photoUrl: "photos/caruana.png",
        color: "white",
      },
      blackPlayer: {
        name: "FIROUZJA",
        rating: 2766,
        title: "GM",
        photoUrl: "photos/firouzja.jpg",
        color: "black",
      },
      theme: "monoSlate",
      durationSec: 3.0,
    },
    {
      type: "moveSequence",
      startFen: PRE_BREAKTHROUGH_FEN,
      moves: SEQUENCE_MOVES,
      brilliantMoveIndex: 0, // 38.d6!! is the breakthrough
      caption: "WATCH THE D-PAWN",
      theme: "classicGreen",
      whitePlayer: { name: "CARUANA", photoUrl: "photos/caruana.png" },
      blackPlayer: { name: "FIROUZJA", photoUrl: "photos/firouzja.jpg" },
      startMoveNumber: 38,
      durationSec: 6.0,
    },
    {
      type: "spotlight",
      fen: AFTER_KF7_FEN,
      square: "d7",
      glowColor: "#fbbf24",
      caption: "PAWN ON 7TH — UNSTOPPABLE",
      theme: "monoSlate",
      electric: true,
      zoomScale: 1.9,
      durationSec: 1.8,
    },
    {
      type: "videoClip",
      src: "clips/few-moments-later.mp4",
      muted: true, // music track stays in the foreground
      fit: "contain", // show full meme — landscape on portrait reel
      background: "#1a0606",
      durationSec: 2.2,
    },
    {
      type: "punchline",
      fen: RESIGNATION_FEN,
      zoomSquares: ["d8", "g7"],
      sticker: "RESIGNS",
      stickerKind: "resign",
      stickerSquare: "f8",
      theme: "classicGreen",
      layingPiece: "f8", // black king on f8 — tips over at resignation
      layingPieceColor: "#dc2626",
      resignedPlayer: { name: "Firouzja", photoUrl: "photos/firouzja.jpg" },
      durationSec: 2.6,
    },
    {
      type: "outro",
      iconUrl: "brand/chess-dna-icon.png",
      brandName: "Chess DNA",
      cta: "follow for more",
      creditName: "Reegan Palmer",
      creditPrefix: "made by",
      creditPhotoUrl: "photos/reegan.jpg",
      durationSec: 2.6,
    },
  ],
};
