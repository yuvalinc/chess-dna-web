import { Chess } from 'chess.js';
import type { GameRecord } from '@shared/types/game';
import type {
  TrapDefinition,
  TrapStat,
  TrapStats,
  TrapOccurrence,
} from '@shared/types/patterns';
import { OPENING_TRAPS, OPENING_TRAPS_BY_ID } from '@shared/data/opening-traps';

/** Maximum plies we look at per game when matching trap signatures. */
const MAX_SIGNATURE_PLIES = 20;

/** Bucket thresholds for how often a trap appears across games. */
const FREQUENT_THRESHOLD = 5;
const OCCASIONAL_THRESHOLD = 2;

export interface DetectedTrap {
  trapId: string;
  trapName: string;
  /** True if the player set the trap; false if the opponent did. */
  playerWasSetter: boolean;
}

/**
 * Extract the first N SAN moves from a PGN.
 * Returns an empty array if the PGN can't be parsed.
 */
function getSanPrefix(pgn: string, plies: number): string[] {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history();
    return history.slice(0, plies);
  } catch {
    return [];
  }
}

/** True if `signature` is a prefix of `moves`. */
function matchesSignature(moves: string[], signature: string[]): boolean {
  if (signature.length > moves.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (moves[i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Detect which traps appear in a single game.
 * If multiple signatures match, the one with the LONGEST matched signature
 * wins (more specific). Avoids double-counting traps that share an opening
 * (e.g. Fried Liver and Knight Attack share the first 7 plies).
 */
export function detectTrapsInGame(
  game: Pick<GameRecord, 'pgn' | 'player'>,
): DetectedTrap[] {
  const moves = getSanPrefix(game.pgn, MAX_SIGNATURE_PLIES);
  if (moves.length === 0) return [];

  const playerColor = game.player.color;
  const matches: Array<{ trap: TrapDefinition; matchedLen: number }> = [];

  for (const trap of OPENING_TRAPS) {
    let bestMatch = 0;
    for (const sig of trap.signatures) {
      if (matchesSignature(moves, sig) && sig.length > bestMatch) {
        bestMatch = sig.length;
      }
    }
    if (bestMatch > 0) {
      matches.push({ trap, matchedLen: bestMatch });
    }
  }

  if (matches.length === 0) return [];

  // De-duplicate near-identical setups (Fried Liver vs. Italian Knight
  // Attack share a prefix). Keep the trap with the longest matched
  // signature for any given setter side.
  const bestBySetter = new Map<'white' | 'black', { trap: TrapDefinition; matchedLen: number }>();
  for (const m of matches) {
    const current = bestBySetter.get(m.trap.setterSide);
    if (!current || m.matchedLen > current.matchedLen) {
      bestBySetter.set(m.trap.setterSide, m);
    }
  }

  return Array.from(bestBySetter.values()).map(({ trap }) => ({
    trapId: trap.id,
    trapName: trap.name,
    playerWasSetter: trap.setterSide === playerColor,
  }));
}

function bucketFrequency(count: number): TrapStat['frequencyBucket'] {
  if (count >= FREQUENT_THRESHOLD) return 'frequent';
  if (count >= OCCASIONAL_THRESHOLD) return 'occasional';
  return 'rare';
}

/**
 * Aggregate trap detections across a player's games into Used vs FellInto
 * lists, sorted by occurrence count (descending).
 */
export function computeTrapStats(games: GameRecord[]): TrapStats {
  const usedAcc = new Map<string, TrapOccurrence[]>();
  const fellIntoAcc = new Map<string, TrapOccurrence[]>();

  for (const game of games) {
    const detections = detectTrapsInGame(game);
    if (detections.length === 0) continue;

    for (const det of detections) {
      const occ: TrapOccurrence = {
        gameId: game.id,
        playedAt: game.playedAt,
        result: game.player.result,
        playerWasSetter: det.playerWasSetter,
      };
      const bucket = det.playerWasSetter ? usedAcc : fellIntoAcc;
      const list = bucket.get(det.trapId) ?? [];
      list.push(occ);
      bucket.set(det.trapId, list);
    }
  }

  const toStat = (
    trapId: string,
    occurrences: TrapOccurrence[],
    side: 'used' | 'fellInto',
  ): TrapStat | null => {
    const trap = OPENING_TRAPS_BY_ID.get(trapId);
    if (!trap) return null;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let lastSeen = 0;
    for (const occ of occurrences) {
      if (occ.result === 'win') wins++;
      else if (occ.result === 'draw') draws++;
      else losses++;
      if (occ.playedAt > lastSeen) lastSeen = occ.playedAt;
    }
    return {
      trapId,
      trapName: trap.name,
      side,
      occurrences: occurrences.slice().sort((a, b) => b.playedAt - a.playedAt),
      count: occurrences.length,
      wins,
      draws,
      losses,
      lastSeen,
      frequencyBucket: bucketFrequency(occurrences.length),
    };
  };

  const used: TrapStat[] = [];
  for (const [trapId, occs] of usedAcc.entries()) {
    const stat = toStat(trapId, occs, 'used');
    if (stat) used.push(stat);
  }
  const fellInto: TrapStat[] = [];
  for (const [trapId, occs] of fellIntoAcc.entries()) {
    const stat = toStat(trapId, occs, 'fellInto');
    if (stat) fellInto.push(stat);
  }

  used.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
  fellInto.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);

  return {
    used,
    fellInto,
    gamesScanned: games.length,
  };
}
