import type { Storyboard } from "./types";

// Praggnanandhaa vs. Sindarov — GCT Super Chess Classic Romania 2026, Round 2.
// Sindarov (W) 0–1 Praggnanandhaa.
// https://lichess.org/broadcast/gct-super-chess-classic-romania-2026/round-2
//
// The verified story (from chess.com, ChessBase India, Tmv reports):
//   • Sindarov was on a 53-game unbeaten classical streak since the
//     September 2025 Grand Swiss loss to Cheparinov. He swept the World Cup
//     2025, Tata Steel 2026, and the Candidates 2026 — three full 14-game
//     events without a single loss — to become the new World Championship
//     challenger.
//   • Sindarov had beaten Pragg TWICE en route to winning the Candidates a
//     month earlier — Pragg got his revenge here with the black pieces.
//   • Sindarov played 15.Nh4!? (a near-novelty in this Italian line Pragg had
//     studied three years prior) and went for a queenside-castled attack.
//   • On move 22 he sacrificed a knight: 22.Nxh6+ gxh6 23.Bxg6 fxg6 — the
//     trap that didn't work. Pragg defended, kept the extra piece, and
//     Sindarov resigned after move 42.
//
// We animate the knight sacrifice — verifiable, visually dramatic, and the
// actual decisive moment of the attacking plan. The streak counter is the
// centerpiece (the story is the scoreboard, not the tactics).

const SAC_START_FEN = "r3r1k1/ppp2pp1/3p2bp/2qn1N2/6P1/5P2/PPBQ4/1K4RR w - - 0 22";
const POST_SAC_FEN = "r3r1k1/ppp5/3p2pp/2qn4/6P1/5P2/PP1Q4/1K4RR w - - 0 24";
const FINAL_FEN = "3kr3/2p2q2/pr1p4/Qp1n4/6P1/3R1P2/PP6/K1R5 w - - 6 43";

// 22.Nxh6+ 22...gxh6 23.Bxg6 23...fxg6 — sacrifice + bishop follow-up, both refused
const SEQUENCE_MOVES = ["Nxh6+", "gxh6", "Bxg6", "fxg6"];

// Total: 1.02 + 2.58 + 5.34 + 2.64 + 2.20 + 2.06 + 1.56 = 17.40s.
// Durations snapped to detected beats in the Hukum track (audio starts at
// source-second 16.7 — gives a 0.3s lead-in and lines the Streak crash
// impact at video-time ~8.06 onto a beat). Beat positions discovered via
// scripts/detect-beats.py on a low-pass-filtered WAV starting at source-16.7.
// Bridges the 19-move gap between the knight-sac and resignation with the
// SpongeBob "Few Moments Later" interlude so the punchline doesn't feel like
// a hard cut to an unrelated position.
export const PRAGG_SINDAROV_STORYBOARD: Storyboard = {
  title: "PRAGG ENDS THE STREAK",
  shots: [
    {
      type: "hook",
      fen: SAC_START_FEN,
      highlightSquare: "h6",
      sticker: "!?",
      stickerKind: "interesting",
      theme: "pinkBerry",
      durationSec: 1.02,
    },
    {
      type: "vsTitle",
      eventName: "ROMANIA 2026",
      subtitle: "♛ ROUND 2 · THE REVENGE ♛",
      fen: SAC_START_FEN,
      whitePlayer: {
        name: "SINDAROV",
        rating: 2776,
        title: "GM",
        photoUrl: "photos/sindarov.jpg",
        color: "white",
      },
      blackPlayer: {
        name: "PRAGG",
        rating: 2733,
        title: "GM",
        photoUrl: "photos/pragg.jpg",
        color: "black",
      },
      theme: "monoSlate",
      durationSec: 2.58,
    },
    {
      type: "streak",
      from: 0,
      to: 53,
      crashTo: 0,
      topLabel: "SINDAROV",
      counterLabel: "GAMES UNBEATEN",
      dateRange: "SEP 2025  →  MAY 2026",
      milestone: "3 × 14-GAME\nTOURNAMENTS\nSWEPT",
      crashText: "STREAK BROKEN",
      crashSubText: "BY PRAGG",
      crashPhotoUrl: "photos/pragg.jpg",
      durationSec: 5.34,
    },
    {
      type: "moveSequence",
      startFen: SAC_START_FEN,
      moves: SEQUENCE_MOVES,
      brilliantMoveIndex: 0, // 22.Nxh6+ — Sindarov's knight sacrifice
      caption: "THE TRAP THAT DIDN'T WORK",
      theme: "classicGreen",
      whitePlayer: { name: "SINDAROV", photoUrl: "photos/sindarov.jpg" },
      blackPlayer: { name: "PRAGG", photoUrl: "photos/pragg.jpg" },
      startMoveNumber: 22,
      durationSec: 2.64,
    },
    {
      type: "videoClip",
      src: "clips/few-moments-later.mp4",
      muted: true,
      fit: "contain", // clip is 1280×720 — letterbox so full "A FEW MOMENTS LATER" text shows
      background: "#0a0a0a",
      durationSec: 2.20,
    },
    {
      type: "punchline",
      fen: FINAL_FEN,
      zoomSquares: ["a1", "f7"],
      sticker: "RESIGNS",
      stickerKind: "resign",
      stickerSquare: "a1",
      theme: "classicGreen",
      layingPiece: "a1", // verified via chess.js — Sindarov walked c1→b1→a1
      layingPieceColor: "#dc2626",
      resignedPlayer: { name: "Sindarov", photoUrl: "photos/sindarov.jpg" },
      durationSec: 2.06,
    },
    {
      type: "outro",
      iconUrl: "brand/chess-dna-icon.png",
      brandName: "Chess DNA",
      cta: "follow for more",
      creditName: "Reegan Palmer",
      creditPrefix: "made by",
      creditPhotoUrl: "photos/reegan.jpg",
      durationSec: 1.56,
    },
  ],
};
