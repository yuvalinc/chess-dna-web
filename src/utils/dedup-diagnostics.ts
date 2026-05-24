/**
 * Dedup diagnostics — tiny ring buffer of dedup events kept in localStorage so
 * we can inspect what happened on a phone WebView (no DevTools console there).
 *
 * The chess.com sync runs `entities.Game.filter({ gameId })` on each candidate
 * and only creates a new record when the filter returns empty. If that filter
 * is silently failing (legacy records missing the `gameId` field, schema drop,
 * regex no longer matching the URL, etc.), every launch re-imports everything.
 * These events let us see, after the fact, exactly which path each candidate
 * took.
 */

const KEY = 'chess-dna-dedup-log';
const MAX_EVENTS = 200;

export type DedupOutcome =
  | 'created' // filter empty → new record created
  | 'existed' // filter found existing record → skipped
  | 'batch-dupe' // already created in this same import run
  | 'filter-error' // filter() threw; we skipped to avoid double-creating
  | 'create-error' // create() threw
  | 'parse-failed' // PGN parse returned null
  | 'no-pgn' // game had no PGN attached
  | 'no-auth' // attempted create with no token; refused
  | 'anonymous-rolled-back'; // create succeeded but server stamped as anonymous; we deleted it

export interface DedupEvent {
  ts: number;
  source: 'chess.com' | 'lichess';
  username: string;
  gameId: string;
  url?: string;
  outcome: DedupOutcome;
  /** filter() result count when outcome=created or existed */
  existingCount?: number;
  /** message when outcome is an error */
  error?: string;
}

interface DedupRunSummary {
  ts: number;
  source: 'chess.com' | 'lichess';
  username: string;
  candidates: number;
  created: number;
  existed: number;
  errors: number;
  durationMs: number;
}

const RUNS_KEY = 'chess-dna-dedup-runs';
const MAX_RUNS = 30;

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, items: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* quota or disabled — drop silently */
  }
}

export function recordDedupEvent(event: Omit<DedupEvent, 'ts'>): void {
  const items = read<DedupEvent>(KEY);
  items.push({ ts: Date.now(), ...event });
  if (items.length > MAX_EVENTS) items.splice(0, items.length - MAX_EVENTS);
  write(KEY, items);
}

export function recordDedupRun(run: Omit<DedupRunSummary, 'ts'>): void {
  const runs = read<DedupRunSummary>(RUNS_KEY);
  runs.push({ ts: Date.now(), ...run });
  if (runs.length > MAX_RUNS) runs.splice(0, runs.length - MAX_RUNS);
  write(RUNS_KEY, runs);
}

export function getDedupEvents(): DedupEvent[] {
  return read<DedupEvent>(KEY);
}

export function getDedupRuns(): DedupRunSummary[] {
  return read<DedupRunSummary>(RUNS_KEY);
}

export function clearDedupLog(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(RUNS_KEY);
  } catch {
    /* ignore */
  }
}
