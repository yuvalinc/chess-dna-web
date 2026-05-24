import { Chess } from 'chess.js';
import StockfishClient from './stockfish-client';

/**
 * Bot opponent for the GameDetail / TimeMachine play surfaces.
 *
 * Two modes:
 * - 'engine': Stockfish picks the best move at full strength.
 * - 'opponent': Replays the actual opponent's move from the original PGN if
 *   the user is still on the original game's script; falls back to Stockfish
 *   throttled to roughly the opponent's rating once the user deviates.
 */

export type BotMode = 'engine' | 'opponent';

export interface BotMoveResult {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
  /** Where the move came from. Used by the UI to label the move ("replayed" vs "engine"). */
  source: 'replay' | 'engine';
}

export interface GetBotReplyOptions {
  /** Current FEN to respond from. */
  fen: string;
  /** Mode of play. */
  mode: BotMode;
  /** SAN moves played in the current line so far. */
  playedSan: string[];
  /** SAN moves from the original game (used for 'opponent' replay). */
  originalSan: string[];
  /** Opponent's rating, used when Stockfish fills in for the off-script case. */
  opponentElo?: number;
  /** Stockfish analysis depth. Defaults to 14 — fast and plenty for blitz-style play. */
  depth?: number;
}

/** True when `playedSan` is a strict prefix of `originalSan`. */
function isOnScript(playedSan: string[], originalSan: string[]): boolean {
  if (playedSan.length >= originalSan.length) return false;
  for (let i = 0; i < playedSan.length; i++) {
    if (playedSan[i] !== originalSan[i]) return false;
  }
  return true;
}

/** Apply a SAN move on a fresh Chess instance and return the from/to/promotion. */
function sanToCoords(
  fen: string,
  san: string,
): { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' } | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move(san);
    if (!move) return null;
    return {
      from: move.from,
      to: move.to,
      promotion: (move.promotion as 'q' | 'r' | 'b' | 'n' | undefined) ?? undefined,
    };
  } catch {
    return null;
  }
}

/** Parse a UCI move string (e.g. "e2e4", "e7e8q") into coords. */
function uciToCoords(uci: string): { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' } | null {
  if (!uci || uci.length < 4) return null;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promo = uci.length > 4 ? (uci[4] as 'q' | 'r' | 'b' | 'n') : undefined;
  return { from, to, promotion: promo };
}

export async function getBotReply(opts: GetBotReplyOptions): Promise<BotMoveResult | null> {
  const { fen, mode, playedSan, originalSan, opponentElo, depth = 14 } = opts;

  // Opponent mode: replay the original move when the user is still on-script.
  if (mode === 'opponent' && isOnScript(playedSan, originalSan)) {
    const nextSan = originalSan[playedSan.length];
    if (nextSan) {
      const coords = sanToCoords(fen, nextSan);
      if (coords) return { ...coords, source: 'replay' };
      // If the SAN doesn't parse against the current FEN (rare — corrupt PGN
      // or notation mismatch), fall through to engine.
    }
  }

  const client = StockfishClient.getInstance();
  const elo = mode === 'opponent' ? opponentElo : undefined;
  const uci = await client.getBestMove(fen, { elo, depth });
  if (!uci) return null;
  const coords = uciToCoords(uci);
  if (!coords) return null;
  return { ...coords, source: 'engine' };
}
