import type { Square } from "../board/fen";
import type { ThemeName } from "../board/themes";

export type HookShot = {
  type: "hook";
  fen: string;
  highlightSquare: Square;
  sticker?: string;
  stickerKind?: import("../board/Sticker").StickerKind;
  theme?: ThemeName;
  durationSec: number;
};

export type TitleShot = {
  type: "title";
  text: string;
  subtitle?: string;
  fen: string;
  playerPhotoUrl?: string;
  playerName?: string;
  playerHandle?: string;
  theme?: ThemeName;
  durationSec: number;
};

export type SpotlightShot = {
  type: "spotlight";
  fen: string;
  square: Square;
  glowColor?: string;
  caption?: string;
  theme?: ThemeName;
  layingPiece?: Square;
  layingPieceColor?: string;
  electric?: boolean;
  zoomScale?: number;
  durationSec: number;
};

export type KenBurnsShot = {
  type: "kenburns";
  fen: string;
  fromSquares?: [Square, Square];
  toSquares: [Square, Square];
  highlightFile?: string;
  caption?: string;
  theme?: ThemeName;
  durationSec: number;
};

export type PunchlineShot = {
  type: "punchline";
  fen: string;
  zoomSquares: [Square, Square];
  sticker: string;
  stickerKind?: import("../board/Sticker").StickerKind;
  stickerSquare: Square;
  theme?: ThemeName;
  layingPiece?: Square;
  layingPieceColor?: string;
  resignedPlayer?: { name: string; photoUrl?: string };
  durationSec: number;
};

export type SquareMemeSpec = {
  square: Square;
  kind?: import("../board/MemeIcon").MemeKind;
  emoji?: string;
  imageUrl?: string;
  scale?: number;
  rotate?: number;
  opacity?: number;
  replacePiece?: boolean;
};

export type MoveSequenceShot = {
  type: "moveSequence";
  startFen: string;
  moves: string[];
  brilliantMoveIndex?: number;
  caption?: string;
  theme?: ThemeName;
  flipped?: boolean;
  whitePlayer?: { name: string; photoUrl?: string };
  blackPlayer?: { name: string; photoUrl?: string };
  startMoveNumber?: number;
  // Meme mode — adds AK-47 overlays on each move and a persistent set of
  // square-based meme overlays (emoji or image). Matches the viral "WIN IN N
  // MOVES" reel format.
  showGuns?: boolean;
  squareMemes?: SquareMemeSpec[];
  topBarText?: string;
  bottomBarText?: string;
  durationSec: number;
};

export type PlayerCard = {
  name: string;
  rating?: number;
  title?: string;
  photoUrl?: string;
  color: "white" | "black";
};

export type VsTitleShot = {
  type: "vsTitle";
  eventName: string;
  subtitle?: string;
  fen: string;
  whitePlayer: PlayerCard;
  blackPlayer: PlayerCard;
  theme?: ThemeName;
  durationSec: number;
};

export type OutroShot = {
  type: "outro";
  iconUrl: string;
  brandName: string;
  cta?: string;
  creditName?: string;
  creditPhotoUrl?: string;
  creditPrefix?: string;
  transparent?: boolean;
  durationSec: number;
};

export type StreakShot = {
  type: "streak";
  // Counter ticks up from `from` (default 0) to `to`, then crashes to `crashTo` (default 0).
  from?: number;
  to: number;
  crashTo?: number;
  // Top line above the counter (e.g. "SINDAROV").
  topLabel: string;
  // Caption underneath the counter (e.g. "GAMES UNBEATEN").
  counterLabel: string;
  // Date-range subtext (e.g. "SEP 2025 → MAY 2026").
  dateRange?: string;
  // Optional milestone line that flashes in between the hold and the crash
  // (e.g. "3 × 14-GAME SWEEPS"). Builds magnitude before the slam.
  milestone?: string;
  // Crash overlay text (e.g. "STREAK BROKEN").
  crashText: string;
  // Sub-line under the crash (e.g. "BY PRAGGNANANDHAA").
  crashSubText?: string;
  // Optional photo to show next to the crash text (e.g. Pragg's avatar).
  crashPhotoUrl?: string;
  durationSec: number;
};

export type VideoClipShot = {
  type: "videoClip";
  src: string;
  muted?: boolean;
  fit?: "cover" | "contain";
  background?: string;
  durationSec: number;
};

export type Shot =
  | HookShot
  | TitleShot
  | SpotlightShot
  | KenBurnsShot
  | PunchlineShot
  | MoveSequenceShot
  | VsTitleShot
  | OutroShot
  | VideoClipShot
  | StreakShot;

export type Storyboard = {
  title: string;
  shots: Shot[];
};
