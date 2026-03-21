export interface PlayerInfo {
  username: string;
  rating: number;
  color: 'white' | 'black';
  result: GameResult;
}

export type GameResult = 'win' | 'loss' | 'draw';

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';

export interface GameRecord {
  id: string;
  url: string;
  pgn: string;
  player: PlayerInfo;
  opponent: PlayerInfo;
  timeClass: TimeClass;
  timeControl: string;
  opening: {
    eco: string;
    name: string;
  };
  totalMoves: number;
  playedAt: number;
  analyzedAt: number | null;
  analysisStatus: 'pending' | 'analyzing' | 'complete' | 'error';
}
