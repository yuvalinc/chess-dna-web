import type { TacticalMotif, PositionEval } from './engine';

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export type MoveQuality =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'
  | 'forced';

export interface MoveAnalysis {
  moveNumber: number;
  halfMoveIndex: number;
  color: 'white' | 'black';
  moveSan: string;
  moveUci: string;
  fenBefore: string;
  fenAfter: string;
  evalBefore: PositionEval;
  evalAfter: PositionEval;
  cpLoss: number;
  /** Expected points lost (0.0 = perfect, 1.0 = worst) — chess.com-style win chance delta */
  winChanceLoss: number;
  quality: MoveQuality;
  phase: GamePhase;
  bestMoveSan: string;
  bestMoveUci: string;
  pvSan: string[];
  tacticalMotifs: TacticalMotif[];
  isCapture: boolean;
  isCheck: boolean;
  isCastling: boolean;
  /** True if this was a piece sacrifice (material loss but engine-approved) */
  isSacrifice: boolean;
  /** Number of legal moves in the position (1 = forced) */
  legalMoveCount: number;
  /** Seconds spent on this move (parsed from PGN clock comments) */
  timeSpent: number | null;
  /** Seconds remaining on clock after this move */
  clockRemaining: number | null;
}

export interface GameAnalysis {
  gameId: string;
  moves: MoveAnalysis[];
  summary: GameSummary;
  analyzedAt: number;
  engineDepth: number;
  engineVersion: string;
}

export interface GameSummary {
  playerColor: 'white' | 'black';
  totalMoves: number;
  accuracy: number;
  acpl: number;
  brilliantMoves: number;
  greatMoves: number;
  bestMoves: number;
  excellentMoves: number;
  goodMoves: number;
  bookMoves: number;
  forcedMoves: number;
  inaccuracies: number;
  mistakes: number;
  misses: number;
  blunders: number;
  phaseAccuracy: {
    opening: number;
    middlegame: number;
    endgame: number;
  };
  biggestMistake: {
    moveNumber: number;
    cpLoss: number;
    moveSan: string;
    bestMoveSan: string;
  } | null;
}
