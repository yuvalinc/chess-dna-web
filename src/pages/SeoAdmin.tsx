import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const GH_REPO = 'yuvalinc/chess-dna-web';
const PAT_STORAGE_KEY = 'chess-dna:seo-gh-pat';

interface GhLabel {
  name: string;
}

interface GhIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  body: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  labels: GhLabel[];
}

interface ParsedTask {
  id: string;
  priority: 'P0' | 'P1' | 'P2';
  title: string;
  description: string;
  checked: boolean;
  filesTouched: string[];
  lineIndex: number;
}

type RunStatus =
  | 'pending'
  | 'approved'
  | 'executing'
  | 'done'
  | 'partial'
  | 'failed';

const STATUS_STYLES: Record<RunStatus, { label: string; cls: string }> = {
  pending:   { label: 'Awaiting approval',  cls: 'bg-chess-accent/15 text-chess-accent border-chess-accent/30' },
  approved:  { label: 'Approved · queued',  cls: 'bg-chess-best/15 text-chess-best border-chess-best/30' },
  executing: { label: 'Claude Code running', cls: 'bg-chess-inaccuracy/15 text-chess-inaccuracy border-chess-inaccuracy/30' },
  done:      { label: 'Done',               cls: 'bg-chess-excellent/15 text-chess-excellent border-chess-excellent/30' },
  partial:   { label: 'Partial',            cls: 'bg-chess-mistake/15 text-chess-mistake border-chess-mistake/30' },
  failed:    { label: 'Failed',             cls: 'bg-chess-blunder/15 text-chess-blunder border-chess-blunder/30' },
};

function statusFromIssue(issue: GhIssue): RunStatus {
  const labels = issue.labels.map(l => l.name);
  if (issue.state === 'closed' && labels.includes('seo-done')) return 'done';
  if (labels.includes('seo-partial')) return 'partial';
  if (labels.includes('seo-failed')) return 'failed';
  if (labels.includes('seo-approved')) return 'approved';
  return 'pending';
}

function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function parseTasks(body: string | null): ParsedTask[] {
  if (!body) return [];
  const lines = body.split('\n');
  const tasks: ParsedTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^- \[( |x|X)\] \*\*(P[012])\*\* — (.+?)(?:\s*<!-- (task-\d+) -->)?$/);
    if (!m) continue;
    const [, checked, priority, title, id] = m;
    const descLines: string[] = [];
    const fileLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && /^\s+/.test(lines[j])) {
      const trimmed = lines[j].trim();
      if (trimmed.startsWith('>')) descLines.push(trimmed.replace(/^>\s?/, ''));
      else if (trimmed.toLowerCase().startsWith('files:')) {
        const matches = [...trimmed.matchAll(/`([^`]+)`/g)];
        for (const fm of matches) fileLines.push(fm[1]);
      }
      j++;
    }
    tasks.push({
      id: id ?? `task-${tasks.length + 1}`,
      priority: priority as ParsedTask['priority'],
      title,
      checked: checked.toLowerCase() === 'x',
      description: descLines.join('\n'),
      filesTouched: fileLines,
      lineIndex: i,
    });
  }
  return tasks;
}

function extractSection(body: string | null, heading: string): string | null {
  if (!body) return null;
  const re = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|\\n---|$)`, 'i');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

function getPat(): string | null {
  try { return localStorage.getItem(PAT_STORAGE_KEY); } catch { return null; }
}

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

function PatSetup({ onSaved }: { onSaved: (pat: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="bg-chess-surface rounded-xl border border-chess-border/40 p-6 max-w-2xl">
      <h2 className="text-lg font-bold mb-2">Connect to GitHub</h2>
      <p className="text-[13px] text-chess-text-tertiary mb-4">
        Paste a GitHub PAT with <code className="bg-chess-bg/60 px-1.5 rounded">repo</code> scope (or fine-grained, Issues = read/write on <code className="bg-chess-bg/60 px-1.5 rounded">{GH_REPO}</code>). Stored in localStorage on this device only.
      </p>
      <input
        type="password"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="github_pat_…  or  ghp_…"
        className="w-full bg-chess-bg/60 border border-chess-border/40 rounded-md px-3 py-2 text-sm text-chess-text"
      />
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => { try { localStorage.setItem(PAT_STORAGE_KEY, value); onSaved(value); } catch {} }}
          disabled={!value.trim()}
          className="bg-chess-accent text-white font-bold px-4 py-2 rounded-md text-sm disabled:opacity-50"
        >
          Save & load issues
        </button>
        <a
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-chess-accent hover:underline self-center"
        >
          Create one →
        </a>
      </div>
    </div>
  );
}

export default function SeoAdmin() {
  const { isAdmin } = useAuth();
  const [pat, setPat] = useState<string | null>(getPat());
  const [issues, setIssues] = useState<GhIssue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showRawId, setShowRawId] = useState<number | null>(null);

  const ghFetch = async (path: string, init?: RequestInit) => {
    if (!pat) throw new Error('No GitHub PAT configured');
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  };

  const refetch = async () => {
    if (!pat) return;
    setError(null);
    try {
      const list = await ghFetch(`/repos/${GH_REPO}/issues?labels=seo-daily&state=all&per_page=50&sort=created&direction=desc`);
      setIssues(list);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (isAdmin !== true || !pat) return;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, pat]);

  const latest = issues?.[0] ?? null;
  const past = useMemo(() => (issues ?? []).slice(1), [issues]);

  const onApprove = async (issue: GhIssue) => {
    setBusy('approve');
    try {
      const labels = [...new Set([...issue.labels.map(l => l.name).filter(n => n !== 'seo-pending'), 'seo-approved'])];
      await ghFetch(`/repos/${GH_REPO}/issues/${issue.number}/labels`, {
        method: 'PUT',
        body: JSON.stringify({ labels }),
      });
      await refetch();
    } catch (e) {
      setError(`Approve failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onToggleTask = async (issue: GhIssue, task: ParsedTask) => {
    setBusy('task:' + task.id);
    try {
      const lines = (issue.body ?? '').split('\n');
      lines[task.lineIndex] = task.checked
        ? lines[task.lineIndex].replace(/^- \[(x|X)\]/, '- [ ]')
        : lines[task.lineIndex].replace(/^- \[ \]/, '- [x]');
      await ghFetch(`/repos/${GH_REPO}/issues/${issue.number}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: lines.join('\n') }),
      });
      await refetch();
    } catch (e) {
      setError(`Toggle failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (isAdmin === null) return <div className="p-8 text-center text-chess-text-tertiary">Loading…</div>;
  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold mb-2">Access Denied</h2>
        <p className="text-chess-text-tertiary">This page is restricted to administrators.</p>
      </div>
    );
  }

  if (!pat) {
    return (
      <div className="max-w-5xl mx-auto pb-20 px-1">
        <h1 className="text-2xl font-extrabold text-chess-text mb-4">SEO Agent</h1>
        <PatSetup onSaved={setPat} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto pb-20 px-1">
      <header className="flex flex-wrap items-baseline gap-3 mb-4">
        <h1 className="text-2xl font-extrabold text-chess-text">SEO Agent</h1>
        <span className="text-[12px] text-chess-text-tertiary">
          {issues ? `${issues.length} issue${issues.length === 1 ? '' : 's'}` : 'Loading…'}
        </span>
        <a
          href={`https://github.com/${GH_REPO}/issues?q=label%3Aseo-daily`}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-chess-accent hover:underline"
        >
          on github.com →
        </a>
        <button
          onClick={() => void refetch()}
          className="ms-auto text-[12px] px-3 py-1.5 rounded-md border border-chess-border/40 text-chess-text-tertiary hover:text-chess-text hover:bg-chess-surface/80"
        >
          Refresh
        </button>
        <button
          onClick={() => { localStorage.removeItem(PAT_STORAGE_KEY); setPat(null); }}
          className="text-[11px] text-chess-text-tertiary hover:text-chess-blunder"
          title="Forget the stored GitHub PAT"
        >
          Reset PAT
        </button>
      </header>

      {error && (
        <div className="bg-chess-blunder/15 border border-chess-blunder/30 rounded-lg p-3 mb-4 text-sm text-chess-blunder">
          {error}
        </div>
      )}

      {issues && issues.length === 0 && (
        <div className="bg-chess-surface rounded-xl border border-chess-border/40 p-6 text-center">
          <h2 className="text-lg font-bold mb-2">No issues yet</h2>
          <p className="text-[13px] text-chess-text-tertiary max-w-md mx-auto">
            Once the daily Claude Code Routine fires, issues with label{' '}
            <code className="bg-chess-bg/60 px-1.5 rounded">seo-daily</code> will appear here.
          </p>
        </div>
      )}

      {latest && <IssueCard
        issue={latest}
        isLatest
        onApprove={() => onApprove(latest)}
        onToggleTask={(t) => onToggleTask(latest, t)}
        showRaw={showRawId === latest.number}
        onToggleRaw={() => setShowRawId(showRawId === latest.number ? null : latest.number)}
        busy={busy}
      />}

      {past.length > 0 && (
        <Card title={`Past runs (${past.length})`}>
          <div className="divide-y divide-chess-border/20">
            {past.map(r => {
              const status = statusFromIssue(r);
              const sty = STATUS_STYLES[status];
              const tasks = parseTasks(r.body);
              const done = tasks.filter(t => t.checked).length;
              return (
                <a
                  key={r.number}
                  href={r.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="py-2 flex items-center gap-3 flex-wrap hover:bg-chess-bg/30 rounded px-1 -mx-1"
                >
                  <Badge cls={sty.cls}>{sty.label}</Badge>
                  <span className="text-[12px] font-bold text-chess-text">#{r.number} · {r.title}</span>
                  <span className="text-[11px] text-chess-text-tertiary">{done} / {tasks.length} tasks</span>
                  <span className="text-[11px] text-chess-text-tertiary ms-auto">{fmtTime(r.closed_at ?? r.created_at)}</span>
                </a>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

function IssueCard({
  issue, isLatest, onApprove, onToggleTask, showRaw, onToggleRaw, busy,
}: {
  issue: GhIssue;
  isLatest: boolean;
  onApprove: () => void;
  onToggleTask: (t: ParsedTask) => void;
  showRaw: boolean;
  onToggleRaw: () => void;
  busy: string | null;
}) {
  const status = statusFromIssue(issue);
  const sty = STATUS_STYLES[status];
  const tasks = parseTasks(issue.body);
  const summary = extractSection(issue.body, 'Summary');
  const rankings = extractSection(issue.body, 'Rankings');

  return (
    <>
      <div className="bg-chess-surface rounded-xl border border-chess-border/40 p-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <Badge cls={sty.cls}>{sty.label}</Badge>
          <a href={issue.html_url} target="_blank" rel="noreferrer" className="text-[13px] font-bold text-chess-text hover:underline">
            #{issue.number} · {issue.title}
          </a>
          {isLatest && <span className="text-chess-accent text-[11px] font-bold">latest</span>}
          <span className="text-[11px] text-chess-text-tertiary ms-auto">
            created {fmtTime(issue.created_at)}
          </span>
        </div>

        {status === 'pending' && tasks.length > 0 && (
          <button
            onClick={onApprove}
            disabled={busy === 'approve'}
            className="w-full bg-chess-accent text-white font-bold py-3 rounded-lg hover:bg-chess-accent/90 disabled:opacity-50 transition-colors"
          >
            {busy === 'approve' ? 'Approving…' : `Approve Claude Code → (${tasks.filter(t => !t.checked).length} task${tasks.filter(t => !t.checked).length === 1 ? '' : 's'})`}
          </button>
        )}

        {status === 'pending' && tasks.length === 0 && (
          <div className="text-[12px] text-chess-text-tertiary bg-chess-bg/40 rounded p-2">
            No tasks parsed from this issue — view the raw issue on github.com to see what the agent produced.
          </div>
        )}

        {status === 'approved' && (
          <div className="text-[12px] text-chess-text-tertiary bg-chess-bg/40 rounded p-3">
            Approved. Now run on your Mac to execute (code edits + Chrome MCP for browser tasks):
            <pre className="text-chess-text font-mono text-[12px] mt-2 bg-chess-bg/60 rounded p-2 select-all">npm run seo:execute</pre>
            <span className="text-[11px]">Or for one specific issue:{' '}
              <code className="bg-chess-bg/60 px-1 rounded select-all">FORCE_ISSUE={issue.number} npm run seo:execute</code>
            </span>
          </div>
        )}
      </div>

      {summary && (
        <Card title="Summary">
          <p className="text-[13px] text-chess-text-secondary whitespace-pre-wrap">{summary}</p>
        </Card>
      )}

      {rankings && (
        <Card title="Rankings">
          <pre className="text-[12px] text-chess-text-secondary whitespace-pre-wrap font-sans">{rankings}</pre>
        </Card>
      )}

      {tasks.length > 0 && (
        <Card
          title={`Tasks (${tasks.length})`}
          action={
            <span className="text-[11px] text-chess-text-tertiary">
              {tasks.filter(t => t.checked).length} checked · {tasks.filter(t => !t.checked).length} pending
            </span>
          }
        >
          {tasks.map(task => (
            <div key={task.id} className="border border-chess-border/30 rounded-lg p-3 mb-2 bg-chess-surface/40">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={task.checked}
                  onChange={() => onToggleTask(task)}
                  disabled={busy === 'task:' + task.id || status !== 'pending'}
                  className="mt-1 cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-bold text-chess-text-tertiary">{task.priority}</span>
                    <span className="text-sm font-bold text-chess-text">{task.title}</span>
                  </div>
                  {task.description && (
                    <p className="text-[13px] text-chess-text-secondary whitespace-pre-wrap">{task.description}</p>
                  )}
                  {task.filesTouched.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {task.filesTouched.map(f => (
                        <code key={f} className="text-[11px] bg-chess-bg/60 px-1.5 py-0.5 rounded text-chess-text-tertiary">{f}</code>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {issue.body && (
        <Card
          title="Raw issue body"
          action={
            <button onClick={onToggleRaw} className="text-[11px] text-chess-text-tertiary hover:text-chess-text">
              {showRaw ? 'Hide' : 'Show'}
            </button>
          }
        >
          {showRaw && (
            <pre className="text-[12px] text-chess-text-secondary whitespace-pre-wrap bg-chess-bg/40 rounded p-3 max-h-96 overflow-auto">
              {issue.body}
            </pre>
          )}
        </Card>
      )}
    </>
  );
}
