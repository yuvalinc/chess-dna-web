import { useState, useEffect, useCallback } from 'react';
import {
  getDedupEvents,
  getDedupRuns,
  clearDedupLog,
  type DedupEvent,
} from '@/utils/dedup-diagnostics';
import { cleanupDuplicates, nukeAnonymousOrphans } from '@/utils/db-cleanup';

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

function outcomeColor(outcome: DedupEvent['outcome']): string {
  switch (outcome) {
    case 'created': return 'text-chess-blunder';
    case 'existed': return 'text-chess-accent';
    case 'batch-dupe': return 'text-chess-text-secondary';
    case 'filter-error':
    case 'create-error':
    case 'parse-failed':
    case 'anonymous-rolled-back': return 'text-chess-mistake';
    case 'no-pgn':
    case 'no-auth': return 'text-chess-text-secondary';
  }
}

export default function DedupDiagnosticsPanel() {
  const [events, setEvents] = useState<DedupEvent[]>([]);
  const [runs, setRuns] = useState(getDedupRuns());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [cleanupState, setCleanupState] = useState<{
    running: boolean;
    log: string[];
    result: { gamesDeleted: number; analysesDeleted: number; passes: number; uniqueGames: number; stuckGames: number; errorSamples: string[] } | null;
    error: string | null;
  }>({ running: false, log: [], result: null, error: null });

  const [nukeState, setNukeState] = useState<{
    running: boolean;
    log: string[];
    result: { scanned: number; deleted: number; stuck: number; errorSamples: string[] } | null;
    error: string | null;
  }>({ running: false, log: [], result: null, error: null });

  const refresh = useCallback(() => {
    setEvents(getDedupEvents());
    setRuns(getDedupRuns());
  }, []);

  useEffect(() => {
    refresh();
    if (!autoRefresh) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  const handleClear = useCallback(() => {
    clearDedupLog();
    refresh();
  }, [refresh]);

  const handleCleanup = useCallback(async () => {
    setCleanupState({ running: true, log: ['Starting cleanup…'], result: null, error: null });
    try {
      const result = await cleanupDuplicates((msg) => {
        setCleanupState((prev) => ({ ...prev, log: [...prev.log, msg].slice(-50) }));
      });
      setCleanupState((prev) => ({ ...prev, running: false, result }));
    } catch (err) {
      setCleanupState((prev) => ({
        ...prev,
        running: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const handleNuke = useCallback(async () => {
    if (!confirm('Delete every Game record where created_by_id = "anonymous"? This is global across all users — proceed only as admin.')) {
      return;
    }
    setNukeState({ running: true, log: ['Starting anonymous-orphan nuke…'], result: null, error: null });
    try {
      const result = await nukeAnonymousOrphans((msg) => {
        setNukeState((prev) => ({ ...prev, log: [...prev.log, msg].slice(-50) }));
      });
      setNukeState((prev) => ({ ...prev, running: false, result }));
    } catch (err) {
      setNukeState((prev) => ({
        ...prev,
        running: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const handleCopy = useCallback(async () => {
    const payload = JSON.stringify({ runs, events }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // Fallback for WebView contexts where clipboard API is blocked
      const ta = document.createElement('textarea');
      ta.value = payload;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }, [events, runs]);

  // Aggregate counts across all runs to spot the pattern at a glance
  const totals = runs.reduce(
    (acc, r) => ({
      candidates: acc.candidates + r.candidates,
      created: acc.created + r.created,
      existed: acc.existed + r.existed,
      errors: acc.errors + r.errors,
    }),
    { candidates: 0, created: 0, existed: 0, errors: 0 },
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-chess-text mb-1">Dedup diagnostics</h3>
        <p className="text-xs text-chess-text-secondary leading-relaxed">
          Each chess.com / lichess import logs how the dedup decision went. If <b>created</b> is
          non-zero on every launch (without you actually playing new games), dedup is failing —
          likely legacy records missing the <code>gameId</code> field or a chess.com URL format
          the regex no longer matches.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <div className="bg-chess-surface border border-chess-border/30 rounded-lg p-3 text-center">
          <div className="text-xs text-chess-text-secondary uppercase tracking-wider">Runs</div>
          <div className="text-xl font-bold text-chess-text">{runs.length}</div>
        </div>
        <div className="bg-chess-surface border border-chess-border/30 rounded-lg p-3 text-center">
          <div className="text-xs text-chess-text-secondary uppercase tracking-wider">Created</div>
          <div className={`text-xl font-bold ${totals.created > 0 ? 'text-chess-blunder' : 'text-chess-text'}`}>
            {totals.created}
          </div>
        </div>
        <div className="bg-chess-surface border border-chess-border/30 rounded-lg p-3 text-center">
          <div className="text-xs text-chess-text-secondary uppercase tracking-wider">Existed</div>
          <div className="text-xl font-bold text-chess-accent">{totals.existed}</div>
        </div>
        <div className="bg-chess-surface border border-chess-border/30 rounded-lg p-3 text-center">
          <div className="text-xs text-chess-text-secondary uppercase tracking-wider">Errors</div>
          <div className={`text-xl font-bold ${totals.errors > 0 ? 'text-chess-mistake' : 'text-chess-text'}`}>
            {totals.errors}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={refresh}
          className="px-3 py-1.5 text-xs rounded-lg bg-chess-surface border border-chess-border/30 hover:border-chess-accent/30"
        >
          Refresh
        </button>
        <label className="flex items-center gap-1.5 text-xs text-chess-text-secondary">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto (2s)
        </label>
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 text-xs rounded-lg bg-chess-surface border border-chess-border/30 hover:border-chess-accent/30"
        >
          Copy JSON
        </button>
        <button
          onClick={handleClear}
          className="px-3 py-1.5 text-xs rounded-lg bg-chess-surface border border-chess-blunder/30 text-chess-blunder hover:border-chess-blunder/60"
        >
          Clear
        </button>
      </div>

      <div className="bg-chess-surface border border-chess-blunder/30 rounded-lg p-3 space-y-2">
        <div>
          <div className="text-xs font-semibold text-chess-blunder uppercase tracking-wider">
            Manual cleanup
          </div>
          <p className="text-[11px] text-chess-text-secondary mt-1 leading-relaxed">
            Scans up to 5,000 Game records, groups by chess.com gameId, keeps the copy
            with an Analysis attached, deletes the rest. Safe to run repeatedly.
          </p>
        </div>
        <button
          onClick={handleCleanup}
          disabled={cleanupState.running}
          className="px-3 py-1.5 text-xs rounded-lg bg-chess-blunder/10 border border-chess-blunder/30 text-chess-blunder hover:bg-chess-blunder/20 disabled:opacity-50"
        >
          {cleanupState.running ? 'Cleaning…' : 'Clean duplicates now'}
        </button>
        {cleanupState.log.length > 0 && (
          <div className="bg-chess-bg/50 rounded-md p-2 max-h-40 overflow-auto font-mono text-[10px] leading-tight space-y-0.5">
            {cleanupState.log.map((m, i) => (
              <div key={i} className="text-chess-text-secondary">{m}</div>
            ))}
          </div>
        )}
        {cleanupState.result && (
          <div className="space-y-1">
            <div className="text-xs text-chess-accent">
              ✓ Deleted {cleanupState.result.gamesDeleted} games + {cleanupState.result.analysesDeleted} analyses
              in {cleanupState.result.passes} pass{cleanupState.result.passes === 1 ? '' : 'es'}.
              {' '}{cleanupState.result.uniqueGames} unique games remain.
            </div>
            {cleanupState.result.stuckGames > 0 && (
              <div className="text-xs text-chess-mistake">
                ⚠ {cleanupState.result.stuckGames} duplicate{cleanupState.result.stuckGames === 1 ? '' : 's'} could not be deleted
                (likely RLS-locked legacy record{cleanupState.result.stuckGames === 1 ? '' : 's'} — created before user-scoped permissions).
              </div>
            )}
            {cleanupState.result.errorSamples.length > 0 && (
              <div className="text-[11px] text-chess-text-secondary font-mono">
                Sample errors: {cleanupState.result.errorSamples.join(' | ')}
              </div>
            )}
          </div>
        )}
        {cleanupState.error && (
          <div className="text-xs text-chess-mistake">Error: {cleanupState.error}</div>
        )}
      </div>

      <div className="bg-chess-surface border border-chess-mistake/40 rounded-lg p-3 space-y-2">
        <div>
          <div className="text-xs font-semibold text-chess-mistake uppercase tracking-wider">
            Nuke anonymous orphans
          </div>
          <p className="text-[11px] text-chess-text-secondary mt-1 leading-relaxed">
            Deletes every Game where <code>created_by_id = "anonymous"</code>. These rows
            were created during the cold-start auth race and have no real owner. Stops
            them from inflating future dedup counts. <b>Affects every user globally.</b>
          </p>
        </div>
        <button
          onClick={handleNuke}
          disabled={nukeState.running}
          className="px-3 py-1.5 text-xs rounded-lg bg-chess-mistake/10 border border-chess-mistake/40 text-chess-mistake hover:bg-chess-mistake/20 disabled:opacity-50"
        >
          {nukeState.running ? 'Nuking…' : 'Nuke anonymous now'}
        </button>
        {nukeState.log.length > 0 && (
          <div className="bg-chess-bg/50 rounded-md p-2 max-h-40 overflow-auto font-mono text-[10px] leading-tight space-y-0.5">
            {nukeState.log.map((m, i) => (
              <div key={i} className="text-chess-text-secondary">{m}</div>
            ))}
          </div>
        )}
        {nukeState.result && (
          <div className="space-y-1">
            <div className="text-xs text-chess-accent">
              ✓ Deleted {nukeState.result.deleted} anonymous rows
              ({nukeState.result.scanned} scanned, {nukeState.result.stuck} stuck).
            </div>
            {nukeState.result.errorSamples.length > 0 && (
              <div className="text-[11px] text-chess-text-secondary font-mono">
                Sample errors: {nukeState.result.errorSamples.join(' | ')}
              </div>
            )}
          </div>
        )}
        {nukeState.error && (
          <div className="text-xs text-chess-mistake">Error: {nukeState.error}</div>
        )}
      </div>

      <div>
        <div className="text-xs font-semibold text-chess-text-secondary uppercase tracking-wider mb-2">
          Run summary (newest first)
        </div>
        {runs.length === 0 ? (
          <div className="text-xs text-chess-text-secondary italic">No imports recorded yet.</div>
        ) : (
          <div className="space-y-1 max-h-64 overflow-auto">
            {[...runs].reverse().map((r, i) => (
              <div
                key={i}
                className="bg-chess-surface border border-chess-border/20 rounded-md px-3 py-2 text-xs flex flex-wrap gap-x-3 gap-y-0.5"
              >
                <span className="text-chess-text-secondary">{fmtTime(r.ts)}</span>
                <span className="text-chess-text">{r.source}/{r.username}</span>
                <span>candidates <b>{r.candidates}</b></span>
                <span className={r.created > 0 ? 'text-chess-blunder' : 'text-chess-text-secondary'}>
                  created <b>{r.created}</b>
                </span>
                <span className="text-chess-accent">existed <b>{r.existed}</b></span>
                {r.errors > 0 && <span className="text-chess-mistake">errors <b>{r.errors}</b></span>}
                <span className="text-chess-text-secondary">{r.durationMs}ms</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-semibold text-chess-text-secondary uppercase tracking-wider mb-2">
          Per-game events (newest first, last {events.length})
        </div>
        {events.length === 0 ? (
          <div className="text-xs text-chess-text-secondary italic">No events recorded yet.</div>
        ) : (
          <div className="space-y-0.5 max-h-96 overflow-auto font-mono">
            {[...events].reverse().map((e, i) => (
              <div key={i} className="text-[11px] flex flex-wrap gap-x-2 leading-tight">
                <span className="text-chess-text-secondary">{fmtTime(e.ts)}</span>
                <span className={`font-bold ${outcomeColor(e.outcome)}`}>{e.outcome}</span>
                <span className="text-chess-text">{e.gameId}</span>
                {e.existingCount !== undefined && (
                  <span className="text-chess-text-secondary">filter→{e.existingCount}</span>
                )}
                {e.error && <span className="text-chess-mistake">{e.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
