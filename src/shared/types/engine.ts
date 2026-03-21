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
  | 'zwischenzug';

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
