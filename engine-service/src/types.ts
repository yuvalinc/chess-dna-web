/**
 * Types mirroring src/shared/types/analysis.ts and src/shared/types/engine.ts
 * in the main app.
 *
 * TODO(phase-1.5): factor into a shared package (npm workspace) to eliminate
 * the duplication. For now: keep these in sync manually.
 */

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

export type TacticalMotif =
  | 'fork'
  | 'pin'
  | 'skewer'
  | 'discovered_attack'
  | 'back_rank'
  | 'hanging_piece'
  | 'trapped_piece'
  | 'overloaded_piece'
  | 'deflection'
  | 'removal_of_guard'
  | 'pawn_promotion_threat'
  | 'zwischenzug'
  | 'promotion'
  | 'under_promotion'
  | 'en_passant'
  | 'castling_move'
  | 'mate_in_1'
  | 'mate_in_2'
  | 'mate_in_3'
  | 'mate_in_4'
  | 'mate_in_5'
  | 'back_rank_mate'
  | 'smothered_mate'
  | 'mate_threat'
  | 'exposed_king'
  | 'double_check';

export interface PositionEval {
  depth: number;
  scoreType: 'cp' | 'mate';
  score: number;
  bestMove: string;
  bestMoveSan: string;
  pv: string[];
  nodes: number;
  nps: number;
  wdl?: [number, number, number];
}

export interface UciInfoLine {
  depth: number;
  seldepth: number;
  multipv: number;
  score: { type: 'cp' | 'mate'; value: number };
  nodes: number;
  nps: number;
  hashfull: number;
  time: number;
  pv: string[];
  wdl?: [number, number, number];
}

export interface UciBestMove {
  bestMove: string;
  ponder?: string;
}

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
  isSacrifice: boolean;
  legalMoveCount: number;
  timeSpent: number | null;
  clockRemaining: number | null;
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

export interface GameAnalysis {
  gameId: string;
  moves: MoveAnalysis[];
  summary: GameSummary;
  analyzedAt: number;
  engineDepth: number;
  engineVersion: string;
}
