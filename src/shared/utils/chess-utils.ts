import { Chess } from 'chess.js';
import type { GameRecord, TimeClass, PlayerInfo } from '@shared/types/game';
import { CHESS_COM_GAME_URL_REGEX, LICHESS_GAME_URL_REGEX } from '@shared/constants';

/**
 * Parse a PGN string into a GameRecord (without analysis).
 */
export function parsePgnToGameRecord(
  pgn: string,
  url: string,
  playerUsername: string,
): GameRecord | null {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);

    const headers = chess.header();
    const chessComMatch = url.match(CHESS_COM_GAME_URL_REGEX);
    const lichessMatch = url.match(LICHESS_GAME_URL_REGEX);
    const gameId = chessComMatch?.[1] ?? lichessMatch?.[1] ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const whiteUsername = headers.White ?? 'Unknown';
    const blackUsername = headers.Black ?? 'Unknown';
    const isPlayerWhite = whiteUsername.toLowerCase() === playerUsername.toLowerCase();

    const result = headers.Result ?? '*';
    const playerResult = getPlayerResult(result, isPlayerWhite);
    const opponentResult = getPlayerResult(result, !isPlayerWhite);

    const player: PlayerInfo = {
      username: isPlayerWhite ? whiteUsername : blackUsername,
      rating: parseRating(isPlayerWhite ? headers.WhiteElo : headers.BlackElo),
      color: isPlayerWhite ? 'white' : 'black',
      result: playerResult,
    };

    const opponent: PlayerInfo = {
      username: isPlayerWhite ? blackUsername : whiteUsername,
      rating: parseRating(isPlayerWhite ? headers.BlackElo : headers.WhiteElo),
      color: isPlayerWhite ? 'black' : 'white',
      result: opponentResult,
    };

    const timeControl = headers.TimeControl ?? '';
    const timeClass = classifyTimeControl(timeControl, headers.Event ?? '');

    return {
      id: gameId,
      url,
      pgn,
      player,
      opponent,
      timeClass,
      timeControl,
      opening: {
        eco: headers.ECO ?? '',
        name: headers.Opening ?? '',
      },
      totalMoves: chess.history().length,
      playedAt: parseDate(headers.Date ?? undefined, headers.UTCDate ?? undefined, headers.UTCTime ?? headers.EndTime ?? undefined),
      analyzedAt: null,
      analysisStatus: 'pending',
    };
  } catch (e) {
    console.error('[Chess Tutor] Failed to parse PGN:', e);
    return null;
  }
}

function getPlayerResult(
  result: string,
  isWhite: boolean,
): 'win' | 'loss' | 'draw' {
  if (result === '1/2-1/2') return 'draw';
  if (result === '1-0') return isWhite ? 'win' : 'loss';
  if (result === '0-1') return isWhite ? 'loss' : 'win';
  return 'draw';
}

function parseRating(elo: string | undefined | null): number {
  if (!elo) return 0;
  const n = parseInt(elo, 10);
  return isNaN(n) ? 0 : n;
}

function classifyTimeControl(timeControl: string, event: string): TimeClass {
  const eventLower = event.toLowerCase();
  if (eventLower.includes('daily') || eventLower.includes('correspondence')) return 'daily';
  if (eventLower.includes('bullet')) return 'bullet';
  if (eventLower.includes('blitz')) return 'blitz';
  if (eventLower.includes('rapid')) return 'rapid';

  // Parse time control string (e.g., "600", "180+2", "300+0")
  const parts = timeControl.split('+');
  const baseTime = parseInt(parts[0], 10);
  const increment = parts[1] ? parseInt(parts[1], 10) : 0;

  if (isNaN(baseTime)) return 'rapid';

  // Total estimated time = base + 40 * increment
  const estimatedTime = baseTime + 40 * increment;

  if (estimatedTime < 180) return 'bullet';
  if (estimatedTime < 600) return 'blitz';
  // ≤ 1800s (30 min) is rapid. The previous `< 1800` boundary misclassified
  // 30-minute games (TimeControl="1800", increment=0) as "daily" — chess.com
  // and Lichess both call those rapid. Bug surfaced by Dvir (2026-05-13):
  // 24 of his games were stamped "daily" so his rapid filter showed his
  // last game as May 8 even though he'd been playing 30-min rapid daily.
  if (estimatedTime <= 1800) return 'rapid';
  return 'daily';
}

function parseDate(
  date?: string,
  utcDate?: string,
  utcTime?: string,
): number {
  // Try UTC date/time first
  if (utcDate && utcTime) {
    const d = new Date(`${utcDate.replace(/\./g, '-')}T${utcTime}Z`);
    if (!isNaN(d.getTime())) return d.getTime();
  }

  // Try Date + EndTime/UTCTime combo (chess.com PGN download format: "7:10:35 GMT+0000")
  if (date && utcTime) {
    const dateStr = date.replace(/\./g, '-');
    // Strip "GMT+0000" suffix, keep just the time
    const timePart = utcTime.replace(/\s*GMT[+-]\d+/, '').trim();
    // Pad hour if needed (7:10:35 → 07:10:35)
    const paddedTime = timePart.replace(/^(\d):/, '0$1:');
    const d = new Date(`${dateStr}T${paddedTime}Z`);
    if (!isNaN(d.getTime())) return d.getTime();
  }

  if (utcDate) {
    const d = new Date(utcDate.replace(/\./g, '-'));
    if (!isNaN(d.getTime())) return d.getTime();
  }

  if (date) {
    const d = new Date(date.replace(/\./g, '-'));
    if (!isNaN(d.getTime())) return d.getTime();
  }

  return Date.now();
}

export type TerminationReason =
  | 'checkmate'
  | 'stalemate'
  | 'time'
  | 'resignation'
  | 'agreement'
  | 'repetition'
  | 'insufficient'
  | '50-move'
  | 'abandoned'
  | 'rules';

/**
 * Extract the short termination reason from a PGN string.
 * Returns a normalized token or null when the reason cannot be determined.
 * Cheap string/regex parse — safe to call on every render.
 */
export function getTerminationReason(pgn: string): TerminationReason | null {
  if (!pgn) return null;

  const termMatch = pgn.match(/\[Termination\s+"([^"]*)"\]/i);
  const term = termMatch?.[1]?.toLowerCase() ?? '';
  if (term) {
    // Chess.com strings are verbose ("X won by checkmate", "Game drawn by agreement", ...).
    // Lichess uses "Normal" / "Time forfeit" / "Abandoned" / "Rules infraction".
    if (term.includes('checkmate')) return 'checkmate';
    if (term.includes('stalemate')) return 'stalemate';
    if (term.includes('time')) return 'time';
    if (term.includes('resign')) return 'resignation';
    if (term.includes('agreement')) return 'agreement';
    if (term.includes('repetition')) return 'repetition';
    if (term.includes('insufficient')) return 'insufficient';
    if (term.includes('50') || term.includes('fifty')) return '50-move';
    if (term.includes('abandon')) return 'abandoned';
    if (term.includes('rules')) return 'rules';
    // "Normal" or anything unknown falls through to inference.
  }

  // Move body sits after the header block (separated by a blank line).
  const blankIdx = pgn.indexOf('\n\n');
  const moveBody = blankIdx >= 0 ? pgn.slice(blankIdx) : pgn;
  // Drop {...} and ;... comments so a stray '#' inside one can't fool us.
  const movesOnly = moveBody.replace(/\{[^}]*\}/g, '').replace(/;[^\n]*/g, '');
  if (movesOnly.includes('#')) return 'checkmate';

  const resultMatch = pgn.match(/\[Result\s+"([^"]*)"\]/);
  const result = resultMatch?.[1] ?? '*';
  // Decisive game without a '#' suffix — overwhelmingly a resignation on both platforms.
  if (result === '1-0' || result === '0-1') return 'resignation';

  return null;
}

/**
 * Split a multi-game PGN string into individual PGN strings.
 * Multi-game PGN files separate games with blank lines before the next [Event header.
 */
export function splitMultiGamePgn(pgnText: string): string[] {
  const trimmed = pgnText.trim();
  if (!trimmed) return [];
  // If the PGN contains [Event headers, split on them
  if (trimmed.includes('[Event ')) {
    const games = trimmed.split(/\n\n(?=\[Event )/);
    return games.map(g => g.trim()).filter(g => g.length > 0);
  }
  // Single game without [Event header — treat the whole text as one game
  // as long as it has some PGN-like content (move numbers or headers)
  if (/\[\w+\s+"/.test(trimmed) || /1\.\s*\w/.test(trimmed)) {
    return [trimmed];
  }
  return [];
}

/**
 * Convert a UCI move string to SAN notation.
 * Returns the original UCI string if conversion fails.
 */
export function uciToSan(fen: string, uci: string): string {
  if (!uci) return '';
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    const move = chess.move({ from, to, promotion });
    return move?.san ?? uci;
  } catch {
    return uci;
  }
}

/**
 * Convert a SAN move to UCI notation.
 * Returns null if the move is invalid for the given position.
 */
export function sanToUci(fen: string, san: string): string | null {
  if (!san) return null;
  try {
    const chess = new Chess(fen);
    const move = chess.move(san);
    if (!move) return null;
    return `${move.from}${move.to}${move.promotion ?? ''}`;
  } catch {
    return null;
  }
}

/**
 * Apply a UCI move to a FEN and return the resulting FEN.
 * Returns null if the move is invalid or illegal.
 */
export function applyMoveToFen(fen: string, uciMove: string): string | null {
  if (!uciMove) return null;
  try {
    const chess = new Chess(fen);
    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    const promotion = uciMove.length > 4 ? uciMove[4] : undefined;
    const move = chess.move({ from, to, promotion });
    if (!move) return null;
    return chess.fen();
  } catch {
    return null;
  }
}

/**
 * Get all FEN positions from a PGN, including the starting position.
 */
export function getFenSequence(pgn: string): string[] {
  const chess = new Chess();
  chess.loadPgn(pgn);

  const moves = chess.history({ verbose: true });
  const fens: string[] = [];

  // Reset and replay to get FEN at each position
  chess.reset();
  fens.push(chess.fen());

  for (const move of moves) {
    chess.move(move.san);
    fens.push(chess.fen());
  }

  return fens;
}
