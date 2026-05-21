import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { base44 } from '@/api/base44Client';
import type {
  SeoRunRecord,
  SeoRunStatus,
  SeoTask,
  SeoTaskStatus,
  SeoRanking,
} from '@shared/types/seo';

interface Base44Entity<T> {
  list: () => Promise<T[]>;
  update: (id: string, data: Partial<T>) => Promise<T>;
  create: (data: Partial<T>) => Promise<T>;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const RUN_STATUS_STYLES: Record<SeoRunStatus, { label: string; cls: string }> = {
  running:   { label: 'Agent running…',    cls: 'bg-chess-inaccuracy/15 text-chess-inaccuracy border-chess-inaccuracy/30' },
  completed: { label: 'Awaiting approval', cls: 'bg-chess-accent/15 text-chess-accent border-chess-accent/30' },
  failed:    { label: 'Agent failed',      cls: 'bg-chess-blunder/15 text-chess-blunder border-chess-blunder/30' },
  approved:  { label: 'Approved',          cls: 'bg-chess-best/15 text-chess-best border-chess-best/30' },
  executing: { label: 'Claude Code running…', cls: 'bg-chess-inaccuracy/15 text-chess-inaccuracy border-chess-inaccuracy/30' },
  done:      { label: 'Done',              cls: 'bg-chess-excellent/15 text-chess-excellent border-chess-excellent/30' },
  partial:   { label: 'Partial',           cls: 'bg-chess-mistake/15 text-chess-mistake border-chess-mistake/30' },
};

const TASK_STATUS_STYLES: Record<SeoTaskStatus, { label: string; cls: string }> = {
  pending:     { label: 'Pending',     cls: 'bg-chess-surface/80 text-chess-text-tertiary border-chess-border/40' },
  approved:    { label: 'Approved',    cls: 'bg-chess-accent/15 text-chess-accent border-chess-accent/30' },
  in_progress: { label: 'In progress', cls: 'bg-chess-inaccuracy/15 text-chess-inaccuracy border-chess-inaccuracy/30' },
  done:        { label: 'Done',        cls: 'bg-chess-excellent/15 text-chess-excellent border-chess-excellent/30' },
  failed:      { label: 'Failed',      cls: 'bg-chess-blunder/15 text-chess-blunder border-chess-blunder/30' },
  skipped:     { label: 'Skipped',     cls: 'bg-chess-surface/80 text-chess-text-tertiary border-chess-border/40' },
};

function Badge({ children, cls }: { children: React.ReactNode; cls: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${cls}`}>
      {children}
    </span>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-chess-surface rounded-xl p-4 border border-chess-border/40 mb-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-extrabold text-chess-text uppercase tracking-wider">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function RankingDelta({ position, prev }: { position: number | null; prev?: number | null }) {
  if (position == null) return <span className="text-chess-text-tertiary">—</span>;
  if (prev == null) return <span className="text-chess-text-tertiary">new</span>;
  const delta = prev - position;
  if (delta === 0) return <span className="text-chess-text-tertiary">·</span>;
  if (delta > 0) return <span className="text-chess-best font-bold">+{delta}</span>;
  return <span className="text-chess-blunder font-bold">{delta}</span>;
}

function TaskRow({
  task,
  onUpdate,
}: {
  task: SeoTask;
  onUpdate: (next: SeoTask) => void;
}) {
  const sty = TASK_STATUS_STYLES[task.status];
  return (
    <div className="border border-chess-border/30 rounded-lg p-3 mb-2 bg-chess-surface/40">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge cls={sty.cls}>{sty.label}</Badge>
            <span className="text-[11px] font-bold text-chess-text-tertiary">{task.priority}</span>
            <span className="text-sm font-bold text-chess-text">{task.title}</span>
          </div>
          <p className="text-[13px] text-chess-text-secondary whitespace-pre-wrap">{task.description}</p>
          {task.filesTouched && task.filesTouched.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {task.filesTouched.map(f => (
                <code key={f} className="text-[11px] bg-chess-bg/60 px-1.5 py-0.5 rounded text-chess-text-tertiary">{f}</code>
              ))}
            </div>
          )}
          {task.prUrl && (
            <a href={task.prUrl} target="_blank" rel="noreferrer" className="text-[12px] text-chess-accent hover:underline mt-2 inline-block">
              View PR →
            </a>
          )}
          {task.errorMessage && (
            <div className="mt-2 text-[12px] text-chess-blunder bg-chess-blunder/10 rounded px-2 py-1">
              {task.errorMessage}
            </div>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {task.status === 'pending' && (
            <button
              onClick={() => onUpdate({ ...task, status: 'skipped' })}
              className="text-[11px] px-2 py-1 rounded-md text-chess-text-tertiary hover:bg-chess-surface/80"
              title="Skip this task"
            >
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SeoAdmin() {
  const { isAdmin, userEmail } = useAuth();
  const [runs, setRuns] = useState<SeoRunRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRawId, setShowRawId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const entity = useMemo(() => {
    const entities = base44.entities as unknown as Record<string, Base44Entity<SeoRunRecord> | undefined>;
    return entities.SeoRun;
  }, []);

  const refetch = async () => {
    if (!entity) {
      setError('SeoRun entity not deployed yet. Run `npx base44 schema deploy` to push it.');
      return;
    }
    try {
      const list = await entity.list();
      list.sort((a, b) => (b.runDate || '').localeCompare(a.runDate || ''));
      setRuns(list);
    } catch (err) {
      setError(`Failed to load runs: ${(err as Error).message}`);
    }
  };

  useEffect(() => {
    if (isAdmin !== true) return;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const latest = runs?.[0] ?? null;
  const isLatestToday = latest?.runDate === todayIso();
  const past = useMemo(() => (runs ?? []).slice(1), [runs]);

  const onApprove = async (run: SeoRunRecord) => {
    if (!entity || !run.id) return;
    setBusy(run.id);
    try {
      await entity.update(run.id, {
        status: 'approved',
        approvedAt: Date.now(),
        approvedBy: userEmail ?? 'unknown',
      });
      await refetch();
    } catch (err) {
      setError(`Approve failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onTaskUpdate = async (run: SeoRunRecord, next: SeoTask) => {
    if (!entity || !run.id) return;
    setBusy(run.id + ':' + next.id);
    try {
      const updated = (run.tasks ?? []).map(t => (t.id === next.id ? next : t));
      await entity.update(run.id, { tasks: updated });
      await refetch();
    } catch (err) {
      setError(`Task update failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (isAdmin === null) {
    return <div className="p-8 text-center text-chess-text-tertiary">Loading…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold mb-2">Access Denied</h2>
        <p className="text-chess-text-tertiary">This page is restricted to administrators.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto pb-20 px-1">
      <header className="flex flex-wrap items-baseline gap-3 mb-4">
        <h1 className="text-2xl font-extrabold text-chess-text">SEO Agent</h1>
        <span className="text-[12px] text-chess-text-tertiary">
          {runs ? `${runs.length} run${runs.length === 1 ? '' : 's'}` : 'Loading…'}
        </span>
        <button
          onClick={() => void refetch()}
          className="ms-auto text-[12px] px-3 py-1.5 rounded-md border border-chess-border/40 text-chess-text-tertiary hover:text-chess-text hover:bg-chess-surface/80"
        >
          Refresh
        </button>
      </header>

      {error && (
        <div className="bg-chess-blunder/15 border border-chess-blunder/30 rounded-lg p-3 mb-4 text-sm text-chess-blunder">
          {error}
        </div>
      )}

      {runs && runs.length === 0 && (
        <div className="bg-chess-surface rounded-xl border border-chess-border/40 p-6 text-center">
          <h2 className="text-lg font-bold mb-2">No runs yet</h2>
          <p className="text-[13px] text-chess-text-tertiary max-w-md mx-auto">
            Once the daily Claude Code Routine fires, runs will appear here.
            Each morning you'll see the agent's output and a single "Approve Claude Code" button.
          </p>
          <p className="text-[12px] text-chess-text-tertiary mt-3">
            Setup status: routine pending. See <code className="bg-chess-bg/60 px-1.5 rounded">docs/seo-agent.md</code>.
          </p>
        </div>
      )}

      {latest && (
        <>
          <div className="bg-chess-surface rounded-xl border border-chess-border/40 p-4 mb-4">
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <Badge cls={RUN_STATUS_STYLES[latest.status]?.cls ?? ''}>
                {RUN_STATUS_STYLES[latest.status]?.label ?? latest.status}
              </Badge>
              <span className="text-[12px] font-bold text-chess-text">
                {latest.runDate} {isLatestToday && <span className="text-chess-accent ms-1">(today)</span>}
              </span>
              {latest.tokensUsed != null && (
                <span className="text-[11px] text-chess-text-tertiary">
                  {(latest.tokensUsed / 1000).toFixed(1)}k tokens
                  {latest.costUsd != null && ` · $${latest.costUsd.toFixed(3)}`}
                </span>
              )}
              {latest.agentSessionId && (
                <a
                  href={`https://console.anthropic.com/sessions/${latest.agentSessionId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-chess-accent hover:underline ms-auto"
                >
                  View session →
                </a>
              )}
            </div>

            {latest.status === 'completed' && (
              <button
                onClick={() => void onApprove(latest)}
                disabled={busy === latest.id}
                className="w-full bg-chess-accent text-white font-bold py-3 rounded-lg hover:bg-chess-accent/90 disabled:opacity-50 transition-colors"
              >
                {busy === latest.id ? 'Approving…' : 'Approve Claude Code →'}
              </button>
            )}

            {latest.status === 'approved' && (
              <div className="text-[12px] text-chess-text-tertiary">
                Approved by {latest.approvedBy} at {fmtTime(latest.approvedAt)}.
                Claude Code workflow should pick this up shortly.
                {latest.workflowRunUrl && (
                  <a href={latest.workflowRunUrl} target="_blank" rel="noreferrer" className="text-chess-accent hover:underline ms-2">
                    View workflow run →
                  </a>
                )}
              </div>
            )}

            {latest.status === 'executing' && latest.workflowRunUrl && (
              <a href={latest.workflowRunUrl} target="_blank" rel="noreferrer" className="text-[12px] text-chess-accent hover:underline">
                Watch Claude Code work →
              </a>
            )}

            {latest.errorMessage && (
              <div className="text-[12px] text-chess-blunder bg-chess-blunder/10 rounded px-2 py-1 mt-2">
                {latest.errorMessage}
              </div>
            )}
          </div>

          {latest.summary && (
            <Card title="Summary">
              <p className="text-[13px] text-chess-text-secondary whitespace-pre-wrap">{latest.summary}</p>
            </Card>
          )}

          {latest.rankings && latest.rankings.length > 0 && (
            <Card title="Rankings observed today">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-chess-text-tertiary border-b border-chess-border/30">
                      <th className="text-left py-2 pe-3 font-bold">Keyword</th>
                      <th className="text-left py-2 pe-3 font-bold">Engine</th>
                      <th className="text-right py-2 pe-3 font-bold">Position</th>
                      <th className="text-right py-2 pe-3 font-bold">Δ</th>
                      <th className="text-left py-2 font-bold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.rankings.map((r: SeoRanking, i: number) => (
                      <tr key={i} className="border-b border-chess-border/20 last:border-0">
                        <td className="py-2 pe-3 font-bold text-chess-text">{r.keyword}</td>
                        <td className="py-2 pe-3 text-chess-text-tertiary">{r.engine}</td>
                        <td className="py-2 pe-3 text-right tabular-nums">{r.position ?? '—'}</td>
                        <td className="py-2 pe-3 text-right tabular-nums">
                          <RankingDelta position={r.position} prev={r.prevPosition} />
                        </td>
                        <td className="py-2 text-[12px] text-chess-text-tertiary">{r.notes ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {latest.tasks && latest.tasks.length > 0 && (
            <Card
              title={`Tasks (${latest.tasks.length})`}
              action={
                <span className="text-[11px] text-chess-text-tertiary">
                  {latest.tasks.filter(t => t.status === 'done').length} done ·{' '}
                  {latest.tasks.filter(t => t.status === 'in_progress').length} running ·{' '}
                  {latest.tasks.filter(t => t.status === 'pending').length} pending
                </span>
              }
            >
              {latest.tasks.map(task => (
                <TaskRow key={task.id} task={task} onUpdate={(next) => void onTaskUpdate(latest, next)} />
              ))}
            </Card>
          )}

          {latest.rawOutput && (
            <Card
              title="Raw agent output"
              action={
                <button
                  onClick={() => setShowRawId(showRawId === latest.id ? null : latest.id ?? null)}
                  className="text-[11px] text-chess-text-tertiary hover:text-chess-text"
                >
                  {showRawId === latest.id ? 'Hide' : 'Show'}
                </button>
              }
            >
              {showRawId === latest.id && (
                <pre className="text-[12px] text-chess-text-secondary whitespace-pre-wrap bg-chess-bg/40 rounded p-3 max-h-96 overflow-auto">
                  {latest.rawOutput}
                </pre>
              )}
            </Card>
          )}
        </>
      )}

      {past.length > 0 && (
        <Card title={`Past runs (${past.length})`}>
          <div className="divide-y divide-chess-border/20">
            {past.map(r => (
              <div key={r.id} className="py-2 flex items-center gap-3 flex-wrap">
                <Badge cls={RUN_STATUS_STYLES[r.status]?.cls ?? ''}>
                  {RUN_STATUS_STYLES[r.status]?.label ?? r.status}
                </Badge>
                <span className="text-[12px] font-bold text-chess-text">{r.runDate}</span>
                <span className="text-[11px] text-chess-text-tertiary">
                  {(r.tasks ?? []).filter(t => t.status === 'done').length} / {(r.tasks ?? []).length} tasks shipped
                </span>
                {r.completedAt && (
                  <span className="text-[11px] text-chess-text-tertiary">finished {fmtTime(r.completedAt)}</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
