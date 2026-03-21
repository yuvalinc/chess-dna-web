import type { UciInfoLine, UciBestMove } from '@shared/types/engine';

/**
 * Parse a UCI "info" line from Stockfish into a structured object.
 * Example: "info depth 20 seldepth 30 multipv 1 score cp 25 nodes 1234 nps 500000 time 100 pv e2e4 e7e5"
 */
export function parseInfoLine(line: string): UciInfoLine | null {
  if (!line.startsWith('info ')) return null;

  // Skip string and currinfo lines
  if (line.includes(' string ') || line.includes(' currmove ')) return null;

  const tokens = line.split(/\s+/);
  const result: Partial<UciInfoLine> = {
    multipv: 1,
    wdl: undefined,
  };

  let i = 1; // Skip "info"
  while (i < tokens.length) {
    switch (tokens[i]) {
      case 'depth':
        result.depth = parseInt(tokens[++i], 10);
        break;
      case 'seldepth':
        result.seldepth = parseInt(tokens[++i], 10);
        break;
      case 'multipv':
        result.multipv = parseInt(tokens[++i], 10);
        break;
      case 'score': {
        const scoreType = tokens[++i] as 'cp' | 'mate';
        const scoreValue = parseInt(tokens[++i], 10);
        result.score = { type: scoreType, value: scoreValue };
        break;
      }
      case 'nodes':
        result.nodes = parseInt(tokens[++i], 10);
        break;
      case 'nps':
        result.nps = parseInt(tokens[++i], 10);
        break;
      case 'hashfull':
        result.hashfull = parseInt(tokens[++i], 10);
        break;
      case 'time':
        result.time = parseInt(tokens[++i], 10);
        break;
      case 'pv': {
        // Everything after "pv" is the principal variation
        result.pv = tokens.slice(i + 1);
        i = tokens.length; // End parsing
        break;
      }
      case 'wdl': {
        const w = parseInt(tokens[++i], 10);
        const d = parseInt(tokens[++i], 10);
        const l = parseInt(tokens[++i], 10);
        result.wdl = [w, d, l];
        break;
      }
      default:
        break;
    }
    i++;
  }

  // Must have at least depth and score to be useful
  if (result.depth === undefined || result.score === undefined) return null;

  return {
    depth: result.depth,
    seldepth: result.seldepth ?? result.depth,
    multipv: result.multipv ?? 1,
    score: result.score,
    nodes: result.nodes ?? 0,
    nps: result.nps ?? 0,
    hashfull: result.hashfull ?? 0,
    time: result.time ?? 0,
    pv: result.pv ?? [],
    wdl: result.wdl,
  };
}

/**
 * Parse a UCI "bestmove" line.
 * Example: "bestmove e2e4 ponder e7e5"
 */
export function parseBestMove(line: string): UciBestMove | null {
  if (!line.startsWith('bestmove ')) return null;

  const tokens = line.split(/\s+/);
  const bestMove = tokens[1];
  if (!bestMove || bestMove === '(none)') return null;

  const ponder = tokens[2] === 'ponder' ? tokens[3] : undefined;

  return { bestMove, ponder };
}

/**
 * Convert a centipawn score to a win probability percentage.
 * Uses the Lichess formula: winRate = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 */
export function cpToWinPercent(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/**
 * Convert a centipawn score to an accuracy percentage (Lichess formula).
 * accuracy = 103.1668 * exp(-0.04354 * cpLoss) - 3.1669
 */
export function cpLossToAccuracy(cpLoss: number): number {
  const accuracy = 103.1668 * Math.exp(-0.04354 * Math.abs(cpLoss)) - 3.1669;
  return Math.max(0, Math.min(100, accuracy));
}
