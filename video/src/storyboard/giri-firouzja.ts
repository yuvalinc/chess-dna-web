import type { Storyboard } from "./types";

// Giri vs. Firouzja — GCT Super Chess Classic Romania 2026, Round 3, 1-0.
// https://lichess.org/broadcast/gct-super-chess-classic-romania-2026/round-3
//
// A King's Indian that turned into a brutal endgame. Around move 68 Firouzja
// was holding the draw with bishop + pawns vs rook + knight, but blundered with
// 68...Be1?? letting White's b-pawn race forward. The peak moment is moves 70–71:
// White ignores Black's pawn one square from queening and pushes 70.b5,
// then after 70...h1=Q+ (queen with check!) plays 71.Kxh1 — the king eats the
// freshly-promoted queen. Firouzja resigned 2 moves later.
//
// We animate moves 70–72 (the "queen for a king" sequence). The brilliant move
// is 71.Kxh1.

// Position right before 70.b5 (after 69...Ke3) — White to play.
const PRE_B5_FEN = "8/8/8/p7/PPR5/4k1p1/6Kp/4b3 w - - 3 70";
// Final captured position after Firouzja resigned (after 72...Kf4).
const FINAL_FEN = "8/8/8/pP6/P4k2/6p1/2R5/4b2K w - - 3 73";
// Position right after 71.Kxh1 — used in spotlight to show the king on h1.
const AFTER_KXH1_FEN = "8/8/8/pP6/P1R5/4k1p1/8/4b2K b - - 0 71";

// 70.b5 70...h1=Q+ 71.Kxh1 71...Kf3 72.Rc2 72...Kf4 (resigned)
const SEQUENCE_MOVES = ["b5", "h1=Q+", "Kxh1", "Kf3", "Rc2", "Kf4"];

// Total: 1.6 + 3.0 + 6.4 + 2.0 + 2.4 + 2.0 = 17.4s, matches ReelAudio-48696.mp3
export const GIRI_FIROUZJA_STORYBOARD: Storyboard = {
  title: "GIRI EATS THE QUEEN",
  shots: [
    {
      type: "hook",
      fen: PRE_B5_FEN,
      highlightSquare: "h2",
      sticker: "??",
      stickerKind: "blunder",
      theme: "pinkBerry",
      durationSec: 1.6,
    },
    {
      type: "vsTitle",
      eventName: "ROMANIA 2026",
      subtitle: "♛ ROUND 3 · KING TAKES QUEEN ♛",
      fen: PRE_B5_FEN,
      whitePlayer: {
        name: "GIRI",
        rating: 2767,
        title: "GM",
        photoUrl: "photos/giri.jpg",
        color: "white",
      },
      blackPlayer: {
        name: "FIROUZJA",
        rating: 2759,
        title: "GM",
        photoUrl: "photos/firouzja.jpg",
        color: "black",
      },
      theme: "monoSlate",
      durationSec: 3.0,
    },
    {
      type: "moveSequence",
      startFen: PRE_B5_FEN,
      moves: SEQUENCE_MOVES,
      brilliantMoveIndex: 2, // 71.Kxh1 — KING CAPTURES THE QUEEN
      caption: "KING EATS QUEEN",
      theme: "classicGreen",
      whitePlayer: { name: "GIRI", photoUrl: "photos/giri.jpg" },
      blackPlayer: { name: "FIROUZJA", photoUrl: "photos/firouzja.jpg" },
      startMoveNumber: 70,
      durationSec: 6.4,
    },
    {
      type: "spotlight",
      fen: AFTER_KXH1_FEN,
      square: "h1",
      glowColor: "#fbbf24",
      caption: "KXH1 — KING TAKES QUEEN",
      theme: "monoSlate",
      electric: true,
      zoomScale: 2.0,
      durationSec: 2.0,
    },
    {
      type: "punchline",
      fen: FINAL_FEN,
      zoomSquares: ["b5", "h1"],
      sticker: "RESIGNS",
      stickerKind: "resign",
      stickerSquare: "f4",
      theme: "classicGreen",
      layingPiece: "f4", // black king on f4 — tips over at resignation
      layingPieceColor: "#dc2626",
      resignedPlayer: { name: "Firouzja", photoUrl: "photos/firouzja.jpg" },
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
      durationSec: 2.0,
    },
  ],
};
