import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import ActivityCalendar from '@/components/ActivityCalendar';

// Reddit outreach dashboard — copy-paste workflow for AI-drafted comments.
// Mirrors /seo's architecture: GitHub issues as control plane, PAT in
// localStorage (with dev-only auto-load from gh CLI via vite.config), per-
// item state tracked via issue comments so it survives across devices.

const GH_REPO = 'yuvalinc/chess-dna-web';
const PAT_STORAGE_KEY = 'chess-dna:seo-gh-pat'; // share with /seo — same PAT

interface GhLabel { name: string }
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
interface GhComment {
  id: number;
  body: string | null;
  created_at: string;
}

type DraftType = 'warmup' | 'promotional' | 'brand_monitor';

interface ParsedDraft {
  id: string;
  subreddit: string;
  title: string;
  type: DraftType;
  matchScore: number;
  reasons: string;
  postedAgo: string;
  upvotes: number;
  comments: number;
  url: string;
  originalExcerpt: string;
  draft: string;
}

type DraftAction = 'opened' | 'posted' | 'skipped';

// Visual + UX rules per draft type.
const TYPE_META: Record<DraftType, { label: string; cls: string; hint: string }> = {
  warmup: {
    label: '🟢 Warmup',
    cls: 'bg-chess-best/15 text-chess-best border-chess-best/30',
    hint: 'Karma builder — zero brand mention. Posts freely without ratio limits.',
  },
  promotional: {
    label: '🎯 Promotional',
    cls: 'bg-chess-accent/15 text-chess-accent border-chess-accent/30',
    hint: 'Brand mention woven in naturally. Subject to the 9:1 warmup-to-promo rule.',
  },
  brand_monitor: {
    label: '👁 Brand mention',
    cls: 'bg-chess-inaccuracy/15 text-chess-inaccuracy border-chess-inaccuracy/30',
    hint: 'Thread already mentions chess-dna — respond as a peer user, not as the team.',
  },
};

function getPat(): string | null {
  try {
    const stored = localStorage.getItem(PAT_STORAGE_KEY);
    if (stored) return stored;
    if (import.meta.env.DEV) {
      const envPat = (import.meta.env as Record<string, string | undefined>).VITE_SEO_GH_PAT;
      if (envPat) {
        try { localStorage.setItem(PAT_STORAGE_KEY, envPat); } catch {}
        return envPat;
      }
    }
    return null;
  } catch { return null; }
}

function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Each draft block in the issue body is delimited by `### [r/sub] title <!-- draft-N -->`
// and ends at the next `---` separator. This parser is intentionally tolerant
// of formatting drift since the issue body is markdown the script writes.
function parseDrafts(body: string | null): ParsedDraft[] {
  if (!body) return [];
  const out: ParsedDraft[] = [];
  // Split on the `## Drafts` heading, then on each `### [r/...]` block.
  const draftsSection = body.split(/^##\s+Drafts\s*$/m)[1] ?? '';
  const blocks = draftsSection.split(/^---\s*$/m);
  for (const block of blocks) {
    const headerMatch = block.match(/^###\s+\[r\/([^\]]+)\]\s+(.+?)\s*<!--\s*(draft-\d+)\s*-->/m);
    if (!headerMatch) continue;
    const [, subreddit, title, id] = headerMatch;
    const typeM = block.match(/\*\*Type\*\*:\s*(warmup|promotional|brand_monitor)/);
    const match = block.match(/\*\*Match\*\*:\s*(\d+)%(?:\s*·\s*_([^_]+)_)?/);
    const posted = block.match(/\*\*Posted\*\*:\s*([\d.]+h)\s+ago\s*·\s*(\d+)↑\s*·\s*(\d+)\s+comments/);
    const url = block.match(/\*\*URL\*\*:\s*(\S+)/);
    const original = block.match(/\*\*Original post\*\*:\s*\n>\s*(.+?)(?=\n\n)/s);
    const draftBlock = block.match(/\*\*AI draft\*\*:\s*\n```\s*\n([\s\S]+?)\n```/);
    out.push({
      id,
      subreddit,
      title: title.trim(),
      // Default to warmup for pre-classifier issues so legacy drafts still parse.
      type: (typeM?.[1] as DraftType) ?? 'warmup',
      matchScore: match ? Number(match[1]) : 0,
      reasons: match?.[2]?.trim() ?? '',
      postedAgo: posted?.[1] ?? '',
      upvotes: posted ? Number(posted[2]) : 0,
      comments: posted ? Number(posted[3]) : 0,
      url: url?.[1] ?? '',
      originalExcerpt: original?.[1]?.trim() ?? '',
      draft: draftBlock?.[1]?.trim() ?? '',
    });
  }
  return out;
}

// State per draft comes from `📋|✅|🗑 **<title>** — …` comments on the issue.
// First matching comment wins; status priority is posted > skipped > opened.
function parseDraftActions(comments: GhComment[]): Map<string, DraftAction> {
  const map = new Map<string, DraftAction>();
  for (const c of comments) {
    const body = c.body ?? '';
    const titleM = body.match(/\*\*([^*]+?)\*\*/);
    if (!titleM) continue;
    const title = titleM[1].trim();
    let next: DraftAction | null = null;
    if (body.startsWith('✅')) next = 'posted';
    else if (body.startsWith('🗑')) next = 'skipped';
    else if (body.startsWith('📋')) next = 'opened';
    if (!next) continue;
    const cur = map.get(title);
    // Promote toward terminal states.
    if (!cur) map.set(title, next);
    else if (cur === 'opened' && (next === 'posted' || next === 'skipped')) map.set(title, next);
    else if (cur === 'skipped' && next === 'posted') map.set(title, next);
  }
  return map;
}

function extractSummary(body: string | null): string | null {
  if (!body) return null;
  const m = body.match(/##\s+Summary\s*\n([\s\S]*?)(?=\n##|\n---|$)/);
  if (!m) return null;
  // Strip markdown bold so **N** doesn't leak through as literal asterisks.
  return m[1].trim().replace(/\*\*([^*]+)\*\*/g, '$1');
}

function countDraftsInBody(body: string | null): number {
  if (!body) return 0;
  const matches = body.match(/<!--\s*draft-\d+\s*-->/g);
  return matches?.length ?? 0;
}

function extractTokens(body: string | null): number {
  if (!body) return 0;
  const m = body.match(/Tokens used:\s*([\d,]+)/i);
  return m ? Number(m[1].replace(/,/g, '')) : 0;
}

const COST_PER_M_TOKENS_USD = 4;
function fmtUsd(n: number): string {
  if (n < 0.01) return `<$0.01`;
  return `$${n.toFixed(2)}`;
}

function PatSetup({ onSaved }: { onSaved: (pat: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="bg-chess-surface rounded-xl p-6 border border-chess-border/40">
      <h2 className="text-lg font-bold text-chess-text mb-2">Connect to GitHub</h2>
      <p className="text-[13px] text-chess-text-tertiary mb-4">
        Paste a GitHub PAT with repo Issues scope on {GH_REPO}. Stored in localStorage on this device only. Shared with /seo — set it once.
      </p>
      <input
        type="password"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="ghp_…"
        className="w-full px-3 py-2 bg-chess-bg/50 border border-chess-border/40 rounded text-sm text-chess-text mb-3 font-mono"
      />
      <button
        onClick={() => { try { localStorage.setItem(PAT_STORAGE_KEY, value); onSaved(value); } catch {} }}
        disabled={!value.trim()}
        className="px-4 py-2 bg-chess-accent text-white rounded font-bold text-sm disabled:opacity-40"
      >
        Save & load drafts
      </button>
    </div>
  );
}

export default function RedditAdmin() {
  const { isAdmin } = useAuth();
  const [pat, setPat] = useState<string | null>(getPat());
  const [issues, setIssues] = useState<GhIssue[] | null>(null);
  const [comments, setComments] = useState<GhComment[] | null>(null);
  const [showIssueId, setShowIssueId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ──────── Data fetching ────────
  const ghFetch = async (path: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined ?? {}),
    };
    const res = await fetch(`https://api.github.com${path}`, { ...init, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text.slice(0, 200)}`);
    }
    return res.status === 204 ? null : res.json();
  };

  useEffect(() => {
    if (isAdmin !== true || !pat) return;
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const list: GhIssue[] = await ghFetch(`/repos/${GH_REPO}/issues?labels=reddit-daily&state=all&per_page=30`);
        if (!cancelled) setIssues(list);
      } catch (e) {
        if (!cancelled) setError(`Load failed: ${(e as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, pat]);

  const displayed = useMemo(() => {
    if (!issues || issues.length === 0) return null;
    if (showIssueId == null) return issues[0];
    return issues.find(i => i.number === showIssueId) ?? issues[0];
  }, [issues, showIssueId]);

  useEffect(() => {
    if (!displayed?.number || !pat) { setComments(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const list: GhComment[] = await ghFetch(`/repos/${GH_REPO}/issues/${displayed.number}/comments?per_page=100`);
        if (!cancelled) setComments(list);
      } catch { if (!cancelled) setComments(null); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed?.number, pat]);

  const drafts = useMemo(() => parseDrafts(displayed?.body ?? null), [displayed]);
  const actions = useMemo(
    () => (comments ? parseDraftActions(comments) : new Map<string, DraftAction>()),
    [comments],
  );

  const totalTokens = (issues ?? []).reduce((sum, i) => sum + extractTokens(i.body), 0);
  const todayTokens = displayed ? extractTokens(displayed.body) : 0;
  const past = issues ? issues.filter(i => i.number !== displayed?.number) : [];

  // Per-day draft counts for the activity calendar (last ~91 days).
  const draftsByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const issue of issues ?? []) {
      const d = new Date(issue.created_at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      m.set(k, (m.get(k) ?? 0) + countDraftsInBody(issue.body));
    }
    return m;
  }, [issues]);

  // Rolling stats for the header strip.
  const now = Date.now();
  const draftsToday = displayed ? countDraftsInBody(displayed.body) : 0;
  const draftsLast7 = (issues ?? [])
    .filter(i => now - new Date(i.created_at).getTime() < 7 * 24 * 3600 * 1000)
    .reduce((s, i) => s + countDraftsInBody(i.body), 0);
  const draftsLast30 = (issues ?? [])
    .filter(i => now - new Date(i.created_at).getTime() < 30 * 24 * 3600 * 1000)
    .reduce((s, i) => s + countDraftsInBody(i.body), 0);

  // 9:1 warmup-to-promotional ratio. Only counts posted (✅) drafts within the
  // currently-displayed issue — across all issues would need fetching every
  // issue's comments. Good enough as a guardrail since users typically post
  // a batch per day and the ratio violation is most acute within that batch.
  const postedByType = useMemo(() => {
    const tally: Record<DraftType, number> = { warmup: 0, promotional: 0, brand_monitor: 0 };
    if (!comments) return tally;
    const titleToType = new Map<string, DraftType>();
    for (const d of drafts) titleToType.set(d.title, d.type);
    for (const c of comments) {
      const body = c.body ?? '';
      if (!body.startsWith('✅')) continue;
      const titleM = body.match(/\*\*([^*]+?)\*\*/);
      if (!titleM) continue;
      const t = titleToType.get(titleM[1].trim());
      if (t) tally[t] += 1;
    }
    return tally;
  }, [comments, drafts]);

  // Threshold the user must clear before a Promotional draft is allowed.
  // Reddit's unwritten norm is 9 helpful comments per 1 self-promotion.
  const promoBudget = Math.max(0, Math.floor(postedByType.warmup / 9) - postedByType.promotional);
  const ratioOK = promoBudget > 0;

  // ──────── Actions ────────
  const postComment = async (draft: ParsedDraft, kind: DraftAction) => {
    if (!displayed) return;
    const emoji = kind === 'posted' ? '✅' : kind === 'skipped' ? '🗑' : '📋';
    const verb = kind === 'posted' ? 'marked posted' : kind === 'skipped' ? 'skipped' : 'opened in Reddit';
    const body = `${emoji} **${draft.title}** — ${verb} by user`;
    const synth: GhComment = { id: -Date.now(), body, created_at: new Date().toISOString() };
    setComments(prev => [...(prev ?? []), synth]);
    setBusy(`${kind}:${draft.id}`);
    try {
      await ghFetch(`/repos/${GH_REPO}/issues/${displayed.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
    } catch (e) {
      setComments(prev => (prev ?? []).filter(c => c.id !== synth.id));
      setError(`${kind} failed: ${(e as Error).message}`);
    } finally { setBusy(null); }
  };

  const copyAndOpen = async (draft: ParsedDraft) => {
    try { await navigator.clipboard.writeText(draft.draft); } catch {}
    window.open(draft.url, '_blank', 'noopener');
    await postComment(draft, 'opened');
  };

  // ──────── Render ────────
  // Admin gate now lives in SeoShell; this component renders inside it. The
  // PAT setup screen stays here because it's tab-local UX — only shown if
  // the user hasn't pasted a PAT yet (rare given the dev-mode auto-load).
  if (isAdmin !== true) return null;
  if (!pat) {
    return (
      <div className="pb-20">
        <h1 className="text-2xl font-extrabold text-chess-text mb-4">Reddit Outreach</h1>
        <PatSetup onSaved={setPat} />
      </div>
    );
  }

  return (
    <div className="pb-20">
      <header className="flex flex-wrap items-baseline gap-3 mb-4">
        <h1 className="text-2xl font-extrabold text-chess-text">Reddit Outreach</h1>
        <span className="text-[12px] text-chess-text-tertiary">
          {issues ? `${issues.length} run${issues.length === 1 ? '' : 's'}` : 'Loading…'}
        </span>
        {issues && issues.length > 0 && (
          <span
            className="text-[11px] text-chess-text-tertiary"
            title={`${totalTokens.toLocaleString()} tokens total · est. $${COST_PER_M_TOKENS_USD}/M`}
          >
            {fmtUsd((todayTokens / 1_000_000) * COST_PER_M_TOKENS_USD)} today · {fmtUsd((totalTokens / 1_000_000) * COST_PER_M_TOKENS_USD)} total
          </span>
        )}
        <a
          href={`https://github.com/${GH_REPO}/issues?q=is%3Aissue+label%3Areddit-daily`}
          target="_blank"
          rel="noreferrer"
          className="ms-auto text-[12px] text-chess-accent hover:underline"
        >
          on github.com →
        </a>
      </header>

      {issues && issues.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <StatCard label="Today" value={draftsToday} sublabel="drafts" />
          <StatCard label="Last 7 days" value={draftsLast7} sublabel="drafts" />
          <StatCard label="Last 30 days" value={draftsLast30} sublabel="drafts" />
        </div>
      )}

      {issues && issues.length > 0 && (
        <div className="mb-4">
          <ActivityCalendar counts={draftsByDay} label="drafts" colorClass="bg-chess-accent" />
        </div>
      )}

      {error && (
        <div className="bg-chess-blunder/10 border border-chess-blunder/30 text-chess-blunder text-[13px] rounded-lg p-3 mb-4">
          {error}
        </div>
      )}

      {!issues && <div className="text-chess-text-tertiary text-center py-10">Loading runs…</div>}

      {issues && issues.length === 0 && (
        <div className="bg-chess-surface rounded-xl p-8 border border-chess-border/40 text-center">
          <h2 className="text-lg font-bold text-chess-text mb-2">No runs yet</h2>
          <p className="text-[13px] text-chess-text-tertiary mb-4">
            Trigger the daily scanner to populate this dashboard:
          </p>
          <code className="block text-[12px] bg-chess-bg/60 rounded p-2 text-chess-text-tertiary text-left max-w-md mx-auto">
            ANTHROPIC_API_KEY=… GH_TOKEN=… node scripts/reddit-daily.mjs
          </code>
        </div>
      )}

      {displayed && (
        <>
          <div className="bg-chess-surface rounded-xl border border-chess-border/40 p-4 mb-4">
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <a
                href={displayed.html_url}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] font-bold text-chess-text hover:underline"
              >
                #{displayed.number} · {displayed.title}
              </a>
              {displayed.number === issues?.[0]?.number && (
                <span className="text-[10px] uppercase tracking-wider text-chess-accent font-bold">latest</span>
              )}
              <span className="text-[11px] text-chess-text-tertiary ms-auto">
                created {fmtTime(displayed.created_at)}
              </span>
            </div>
            {extractSummary(displayed.body) && (
              <p className="text-[13px] text-chess-text-secondary whitespace-pre-wrap">
                {extractSummary(displayed.body)}
              </p>
            )}
          </div>

          {drafts.length > 0 && (
            <div className="bg-chess-surface rounded-xl p-4 border border-chess-border/40 mb-4">
              <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
                <h3 className="text-sm font-bold text-chess-text">Drafts ({drafts.length})</h3>
                <span className="text-[11px] text-chess-text-tertiary">
                  {drafts.filter(d => actions.get(d.title) === 'posted').length} posted ·{' '}
                  {drafts.filter(d => actions.get(d.title) === 'opened').length} opened ·{' '}
                  {drafts.filter(d => actions.get(d.title) === 'skipped').length} skipped
                </span>
              </div>
              <RatioBadge postedByType={postedByType} promoBudget={promoBudget} ratioOK={ratioOK} />
              {drafts.map(draft => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  action={actions.get(draft.title)}
                  busyKey={busy}
                  ratioOK={ratioOK}
                  promoBudget={promoBudget}
                  onCopyOpen={() => copyAndOpen(draft)}
                  onPosted={() => postComment(draft, 'posted')}
                  onSkipped={() => postComment(draft, 'skipped')}
                />
              ))}
            </div>
          )}
        </>
      )}

      {past.length > 0 && (
        <div className="bg-chess-surface rounded-xl p-4 border border-chess-border/40 mb-4">
          <h3 className="text-sm font-bold text-chess-text mb-3">Past runs ({past.length})</h3>
          <div className="divide-y divide-chess-border/20">
            {past.map(p => (
              <button
                key={p.number}
                onClick={() => setShowIssueId(p.number)}
                className="w-full text-left py-2 hover:bg-chess-bg/40 px-2 rounded transition-colors"
              >
                <div className="flex items-center gap-3 text-[13px]">
                  <span className="text-chess-text-tertiary w-12">#{p.number}</span>
                  <span className="text-chess-text flex-1 truncate">{p.title}</span>
                  <span className="text-[11px] text-chess-text-tertiary">{fmtTime(p.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DraftCard({
  draft, action, busyKey, ratioOK, promoBudget, onCopyOpen, onPosted, onSkipped,
}: {
  draft: ParsedDraft;
  action?: DraftAction;
  busyKey: string | null;
  ratioOK: boolean;
  promoBudget: number;
  onCopyOpen: () => void;
  onPosted: () => void;
  onSkipped: () => void;
}) {
  const isPosted = action === 'posted';
  const isSkipped = action === 'skipped';
  const isOpened = action === 'opened';
  const typeMeta = TYPE_META[draft.type];
  // Block copy on Promotional drafts when the 9:1 ratio isn't met — Reddit's
  // anti-spam classifier looks for this. Brand-monitor and warmup pass freely.
  const ratioBlocked = draft.type === 'promotional' && !ratioOK && !isPosted;
  const cardCls = isPosted
    ? 'border-chess-best/30 bg-chess-best/5'
    : isSkipped
      ? 'border-chess-border/30 bg-chess-surface/30 opacity-60'
      : isOpened
        ? 'border-chess-accent/30 bg-chess-accent/5'
        : 'border-chess-border/30';

  const scoreColor =
    draft.matchScore >= 80 ? 'bg-chess-best/15 text-chess-best border-chess-best/30'
    : draft.matchScore >= 65 ? 'bg-chess-accent/15 text-chess-accent border-chess-accent/30'
    : 'bg-chess-inaccuracy/15 text-chess-inaccuracy border-chess-inaccuracy/30';

  return (
    <div className={`border rounded-lg p-3 mb-3 transition-colors ${cardCls}`}>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${typeMeta.cls}`}
          title={typeMeta.hint}
        >
          {typeMeta.label}
        </span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${scoreColor}`}>
          {draft.matchScore}% match
        </span>
        <span className="text-[11px] text-chess-text-tertiary">r/{draft.subreddit}</span>
        <span className="text-[11px] text-chess-text-tertiary">·</span>
        <span className="text-[11px] text-chess-text-tertiary">{draft.postedAgo} ago</span>
        <span className="text-[11px] text-chess-text-tertiary">·</span>
        <span className="text-[11px] text-chess-text-tertiary">{draft.upvotes}↑</span>
        <span className="text-[11px] text-chess-text-tertiary">·</span>
        <span className="text-[11px] text-chess-text-tertiary">{draft.comments} comments</span>
        {isPosted && <span className="ms-auto text-[10px] uppercase tracking-wider text-chess-best font-bold">✓ posted</span>}
        {isSkipped && <span className="ms-auto text-[10px] uppercase tracking-wider text-chess-text-tertiary font-bold">skipped</span>}
        {isOpened && !isPosted && !isSkipped && (
          <span className="ms-auto text-[10px] uppercase tracking-wider text-chess-accent font-bold">opened — confirm</span>
        )}
      </div>
      <div className="text-sm font-bold text-chess-text mb-2">{draft.title}</div>
      {draft.originalExcerpt && (
        <blockquote className="text-[12px] text-chess-text-tertiary italic border-l-2 border-chess-border/40 pl-2 mb-3 line-clamp-3">
          {draft.originalExcerpt}
        </blockquote>
      )}
      <div className="bg-chess-bg/40 rounded p-2.5 mb-3 text-[13px] text-chess-text-secondary whitespace-pre-wrap leading-relaxed">
        {draft.draft}
      </div>
      {draft.reasons && (
        <div className="text-[11px] text-chess-text-tertiary mb-2 italic">{draft.reasons}</div>
      )}
      {ratioBlocked && (
        <div className="text-[11px] bg-chess-blunder/10 border border-chess-blunder/30 rounded p-2 mb-2 text-chess-blunder">
          ⚠ <strong>Ratio gate</strong>: post {-promoBudget + 1} more Warmup comment{-promoBudget === 0 ? '' : 's'} before this Promotional draft. Reddit flags accounts with more than 1 self-promo per 9 helpful posts.
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={onCopyOpen}
          disabled={busyKey != null || ratioBlocked}
          className={`text-[12px] font-bold px-3 py-1.5 rounded-md border disabled:opacity-60 ${
            ratioBlocked
              ? 'bg-chess-surface text-chess-text-tertiary border-chess-border/40 cursor-not-allowed'
              : 'bg-chess-accent text-white border-chess-accent hover:bg-chess-accent/90'
          }`}
          title={ratioBlocked
            ? 'Blocked: post more Warmup drafts first to maintain a healthy 9:1 ratio'
            : 'Copy the draft to clipboard and open the Reddit thread in a new tab'}
        >
          📋 Copy & Open Reddit
        </button>
        {isOpened && !isPosted && !isSkipped && (
          <button
            onClick={onPosted}
            disabled={busyKey != null}
            className="text-[12px] font-bold px-3 py-1.5 rounded-md border bg-chess-best text-white border-chess-best hover:bg-chess-best/90 disabled:opacity-60"
          >
            ✓ Mark posted
          </button>
        )}
        {!isPosted && !isSkipped && (
          <button
            onClick={onSkipped}
            disabled={busyKey != null}
            className="text-[12px] font-bold px-3 py-1.5 rounded-md border bg-transparent text-chess-text-tertiary border-chess-border/40 hover:text-chess-blunder hover:border-chess-blunder/60"
          >
            ✕ Skip
          </button>
        )}
        <a
          href={draft.url}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-chess-text-tertiary hover:text-chess-accent ms-auto self-center"
        >
          view thread →
        </a>
      </div>
    </div>
  );
}

function StatCard({ label, value, sublabel }: { label: string; value: number; sublabel: string }) {
  return (
    <div className="bg-chess-surface rounded-xl border border-chess-border/40 p-3">
      <div className="text-[11px] text-chess-text-tertiary uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-extrabold text-chess-text leading-tight mt-0.5">
        {value}
        <span className="text-[12px] text-chess-text-tertiary font-normal ml-1.5">{sublabel}</span>
      </div>
    </div>
  );
}

function RatioBadge({
  postedByType, promoBudget, ratioOK,
}: {
  postedByType: Record<DraftType, number>;
  promoBudget: number;
  ratioOK: boolean;
}) {
  const totalPosted = postedByType.warmup + postedByType.promotional + postedByType.brand_monitor;
  if (totalPosted === 0) {
    return (
      <div className="text-[11px] text-chess-text-tertiary mb-3 italic">
        9:1 ratio gate active — post Warmup drafts first to unlock Promotional drafts. Each 9 Warmup posts buys 1 Promotional slot.
      </div>
    );
  }
  return (
    <div className={`text-[11px] mb-3 px-3 py-2 rounded border ${
      ratioOK
        ? 'bg-chess-best/10 border-chess-best/30 text-chess-best'
        : 'bg-chess-mistake/10 border-chess-mistake/30 text-chess-mistake'
    }`}>
      <strong>{ratioOK ? '✓ Ratio healthy' : '⚠ Ratio under 9:1'}</strong>
      <span className="text-chess-text-tertiary ms-2">
        Posted this issue: {postedByType.warmup} Warmup · {postedByType.promotional} Promotional · {postedByType.brand_monitor} Brand-mention
        {' · '}Promotional budget: {promoBudget}
      </span>
    </div>
  );
}
