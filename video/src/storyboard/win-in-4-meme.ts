import type { Storyboard } from "./types";

// Meme-reel format: top title bar, bottom caption bar, persistent square
// memes, AK-47 overlays on every move.
//
// Sequence: the LÉGAL TRAP — 7-move opening trap that ends in smothered mate.
// White sacrifices the queen on move 5 (Nxe5!) and mates with Nd5# two moves
// later. Black's own queen and bishop seal the king in for the smother.
//   1. e4 e5
//   2. Nf3 d6           (Philidor Defense)
//   3. Bc4 Bg4          (Black pins the f3 knight)
//   4. Nc3 g6?          (Black's losing move — should be Nf6 or h6)
//   5. Nxe5!!           (queen-sac trap activated)
//   5...Bxd1?           (Black greedily takes the queen)
//   6. Bxf7+ Ke7
//   7. Nd5#             (smothered mate)

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const SEQUENCE_MOVES = [
  "e4", "e5",
  "Nf3", "d6",
  "Bc4", "Bg4",
  "Nc3", "g6",
  "Nxe5",         // index 8 — the queen-sac brilliancy
  "Bxd1",
  "Bxf7+", "Ke7",
  "Nd5#",         // index 12 — smothered mate
];

export const WIN_IN_4_MEME_STORYBOARD: Storyboard = {
  title: "WIN IN 7 MOVES (Légal Trap)",
  shots: [
    {
      type: "moveSequence",
      startFen: STARTING_FEN,
      moves: SEQUENCE_MOVES,
      brilliantMoveIndex: 8, // 5.Nxe5 — the queen sacrifice
      theme: "classicGreen",
      startMoveNumber: 1,
      showGuns: true,
      topBarText: "WIN IN 7 MOVES !",
      bottomBarText: "The Légal Trap — Queen Sacrifice 😈",
      squareMemes: [
        // Ogre faces on white's pawn rank (skip e2 — that pawn moves first)
        { square: "a2", kind: "ogre", scale: 0.95 },
        { square: "b2", kind: "ogre", scale: 0.95 },
        { square: "c2", kind: "ogre", scale: 0.95 },
        { square: "d2", kind: "ogre", scale: 0.95 },
        { square: "f2", kind: "ogre", scale: 0.95 },
        { square: "g2", kind: "ogre", scale: 0.95 },
        { square: "h2", kind: "ogre", scale: 0.95 },
        // Skull on f8 — Black's king bishop that ironically seals the king in
        { square: "f8", kind: "skull", scale: 0.85, replacePiece: true },
      ],
      durationSec: 17.4,
    },
  ],
};
