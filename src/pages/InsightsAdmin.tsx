import { useEffect, useMemo, useState } from 'react';

// Insights tab — surfaces two complementary measurements of how chess-dna
// is being seen in the wild:
//   • AI Visibility (kw.com AIV) — score, citations, source mix, model mix.
//     Data shape mirrors the kw.com REST API; daily snapshot script lives at
//     scripts/insights-daily.mjs (TODO — for now we render the empty state
//     and direct the user to the kw.com dashboard).
//   • Brand Monitor (Reddit search) — mentions across all subreddits with
//     sentiment + high-intent flags. Populated by scripts/brand-monitor.mjs.

const GH_REPO = 'yuvalinc/chess-dna-web';
const PAT_STORAGE_KEY = 'chess-dna:seo-gh-pat';

interface GhIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  body: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

interface ParsedMention {
  id: string;
  subreddit: string;
  title: string;
  url: string;
  excerpt: string;
  ageHrs: number;
  upvotes: number;
  comments: number;
  author: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  highIntent: boolean;
}

interface BrandStats {
  total: number;
  highIntent: number;
  positive: number;
  neutral: number;
  negative: number;
  healthPercent: number;
  topSubs: Array<{ sub: string; count: number }>;
}

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

function parseMentions(body: string | null): ParsedMention[] {
  if (!body) return [];
  const out: ParsedMention[] = [];
  const section = body.split(/^##\s+Mentions\s*$/m)[1] ?? '';
  const blocks = section.split(/^---\s*$/m);
  for (const block of blocks) {
    const header = block.match(/^###\s+\[r\/([^\]]+)\]\s+(.+?)\s*<!--\s*(mention-\d+)\s*-->/m);
    if (!header) continue;
    const [, subreddit, title, id] = header;
    const sentM = block.match(/\*\*Sentiment\*\*:\s*(?:🟢|🔴|⚪)\s*(positive|neutral|negative)(.*?)$/m);
    const postedM = block.match(/\*\*Posted\*\*:\s*([\d.]+)h\s+ago\s*·\s*(-?\d+)↑\s*·\s*(\d+)\s+comments\s*·\s*by\s+u\/(\S+)/);
    const urlM = block.match(/\*\*URL\*\*:\s*(\S+)/);
    const excerptM = block.match(/^>\s*(.+)$/m);
    out.push({
      id,
      subreddit,
      title: title.trim(),
      sentiment: (sentM?.[1] as ParsedMention['sentiment']) ?? 'neutral',
      highIntent: !!sentM?.[2]?.includes('high-intent'),
      ageHrs: postedM ? Number(postedM[1]) : 0,
      upvotes: postedM ? Number(postedM[2]) : 0,
      comments: postedM ? Number(postedM[3]) : 0,
      author: postedM?.[4] ?? '?',
      url: urlM?.[1] ?? '',
      excerpt: excerptM?.[1]?.trim() ?? '',
    });
  }
  return out;
}

function parseStats(body: string | null): BrandStats | null {
  if (!body) return null;
  const grab = (key: string) => {
    const m = body.match(new RegExp(`-\\s*${key}:\\s*(\\d+)`));
    return m ? Number(m[1]) : 0;
  };
  const topSubs: Array<{ sub: string; count: number }> = [];
  const subSection = body.match(/##\s+Top subreddits\s*\n([\s\S]*?)(?=\n##|\n---)/);
  if (subSection) {
    const lines = subSection[1].split('\n');
    for (const line of lines) {
      const m = line.match(/-\s*r\/(\S+)\s*—\s*(\d+)\s+mention/);
      if (m) topSubs.push({ sub: m[1], count: Number(m[2]) });
    }
  }
  return {
    total: grab('TotalMentions'),
    highIntent: grab('HighIntent'),
    positive: grab('Positive'),
    neutral: grab('Neutral'),
    negative: grab('Negative'),
    healthPercent: grab('HealthPercent'),
    topSubs,
  };
}

export default function InsightsAdmin() {
  const [pat] = useState<string | null>(getPat());
  const [brandIssue, setBrandIssue] = useState<GhIssue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pat) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${GH_REPO}/issues?labels=brand-monitor&state=all&per_page=1`,
          { headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json' } },
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const list: GhIssue[] = await res.json();
        if (!cancelled) {
          setBrandIssue(list[0] ?? null);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(`Brand monitor load failed: ${(e as Error).message}`);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pat]);

  const mentions = useMemo(() => parseMentions(brandIssue?.body ?? null), [brandIssue]);
  const stats = useMemo(() => parseStats(brandIssue?.body ?? null), [brandIssue]);

  if (!pat) {
    return (
      <div className="pb-20">
        <h1 className="text-2xl font-extrabold text-chess-text mb-4">Insights</h1>
        <p className="text-chess-text-tertiary text-[13px]">
          Connect your GitHub PAT on the SEO daily tab first — the Insights tab reads the same data sources.
        </p>
      </div>
    );
  }

  return (
    <div className="pb-20">
      <header className="flex flex-wrap items-baseline gap-3 mb-4">
        <h1 className="text-2xl font-extrabold text-chess-text">Insights</h1>
        <span className="text-[12px] text-chess-text-tertiary">
          AI visibility · brand monitoring · sentiment
        </span>
      </header>

      {error && (
        <div className="bg-chess-blunder/10 border border-chess-blunder/30 text-chess-blunder text-[13px] rounded-lg p-3 mb-4">
          {error}
        </div>
      )}

      <AiVisibilitySection />
      <BrandMonitorSection
        loading={loading}
        issue={brandIssue}
        mentions={mentions}
        stats={stats}
      />
    </div>
  );
}

// ─── AI Visibility ────────────────────────────────────────────────────────
// Pulled from kw.com AIV (domain_id=4603 for chessdna.app). Score range 0–100.
// Today: all metrics are zero because the domain was added 2026-05-22 and
// AIV needs ~7 days of LLM polls to accumulate signal. Once the daily
// `scripts/insights-daily.mjs` script lands, this card will fill in.
function AiVisibilitySection() {
  // Placeholder static snapshot — once we wire the kw.com REST pull into a
  // GH issue (label: insights-aiv), swap this for a fetch + parse like
  // BrandMonitor below.
  const snapshot = {
    score: 0,
    sentiment: 0,
    mentions: 0,
    citations: 0,
    detectionRate: 0,
    avgPosition: 0,
    top3: 0,
  };
  const scoreLabel = snapshot.score <= 20 ? 'Poor'
    : snapshot.score <= 40 ? 'Fair'
    : snapshot.score <= 60 ? 'Good'
    : snapshot.score <= 80 ? 'Very good' : 'Excellent';
  const scoreColor = snapshot.score <= 20 ? 'text-chess-blunder'
    : snapshot.score <= 40 ? 'text-chess-mistake'
    : snapshot.score <= 60 ? 'text-chess-inaccuracy'
    : snapshot.score <= 80 ? 'text-chess-accent' : 'text-chess-best';

  return (
    <section className="bg-chess-surface rounded-xl border border-chess-border/40 p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-bold text-chess-text">AI Visibility</h2>
        <a
          href="https://app.keyword.com/ai-visibility"
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-chess-accent hover:underline"
        >
          on keyword.com →
        </a>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
        <Stat label="Visibility Score" value={`${snapshot.score}`} suffix="/100" hint={scoreLabel} valueClass={scoreColor} />
        <Stat label="Mentions" value={`${snapshot.mentions}`} hint="across AI engines" />
        <Stat label="Citations" value={`${snapshot.citations}`} hint="sourced answers" />
        <Stat label="Detection rate" value={`${snapshot.detectionRate}%`} hint="prompts that mention us" />
      </div>
      {snapshot.score === 0 && (
        <div className="text-[12px] bg-chess-bg/40 rounded p-3 text-chess-text-tertiary">
          <strong className="text-chess-text">No AI mentions tracked yet.</strong> chessdna.app
          was added to keyword.com's AI Visibility tracker recently — it takes 5–10 days for
          enough LLM polls to accumulate. Manage tracked prompts and competitor brands at{' '}
          <a className="text-chess-accent hover:underline" href="https://app.keyword.com/ai-visibility" target="_blank" rel="noreferrer">app.keyword.com/ai-visibility</a>.
        </div>
      )}
    </section>
  );
}

// ─── Brand Monitor ────────────────────────────────────────────────────────
function BrandMonitorSection({
  loading, issue, mentions, stats,
}: {
  loading: boolean;
  issue: GhIssue | null;
  mentions: ParsedMention[];
  stats: BrandStats | null;
}) {
  return (
    <section className="bg-chess-surface rounded-xl border border-chess-border/40 p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-bold text-chess-text">Brand Monitor — Reddit</h2>
        <div className="flex items-center gap-3">
          {issue && (
            <a
              href={issue.html_url}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-chess-accent hover:underline"
            >
              full scan on github.com →
            </a>
          )}
          <code className="text-[10px] text-chess-text-tertiary bg-chess-bg/60 px-1.5 py-0.5 rounded select-all">npm run brand:monitor</code>
        </div>
      </div>

      {loading && <div className="text-chess-text-tertiary text-[13px] py-4">Loading mentions…</div>}

      {!loading && !issue && (
        <div className="text-[12px] bg-chess-bg/40 rounded p-3 text-chess-text-tertiary">
          No brand-monitor scans yet. Run <code className="bg-chess-bg/60 px-1 rounded">npm run brand:monitor</code> to seed the first one.
        </div>
      )}

      {!loading && stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <Stat label="Total mentions" value={`${stats.total}`} hint={`last ${30}d`} />
            <Stat label="High-intent" value={`${stats.highIntent}`} hint="worth replying" />
            <Stat
              label="Brand health"
              value={`${stats.healthPercent}%`}
              hint="positive sentiment ratio"
              valueClass={
                stats.healthPercent >= 70 ? 'text-chess-best'
                : stats.healthPercent >= 40 ? 'text-chess-accent'
                : 'text-chess-mistake'
              }
            />
            <Stat label="Sentiment" value={`${stats.positive}+ ${stats.neutral}~ ${stats.negative}-`} hint="positive · neutral · negative" />
          </div>

          {stats.topSubs.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] text-chess-text-tertiary mb-1">Top subreddits</div>
              <div className="flex flex-wrap gap-1.5">
                {stats.topSubs.map(s => (
                  <span key={s.sub} className="text-[11px] bg-chess-bg/60 text-chess-text-secondary px-2 py-0.5 rounded">
                    r/{s.sub} <span className="text-chess-text-tertiary">· {s.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {mentions.length > 0 && (
        <>
          <div className="text-[11px] text-chess-text-tertiary uppercase tracking-wider mt-4 mb-2">Recent mentions</div>
          {mentions.slice(0, 15).map(m => <MentionCard key={m.id} m={m} />)}
        </>
      )}

      {!loading && mentions.length === 0 && stats?.total === 0 && (
        <div className="text-[12px] bg-chess-bg/40 rounded p-3 text-chess-text-tertiary">
          <strong className="text-chess-text">Zero brand mentions in the last 30 days.</strong> That's normal
          for an early-stage product. As ReddGrow drafts go live the count here should climb — every
          post you make + every organic mention by other users shows up here within 24h.
        </div>
      )}
    </section>
  );
}

function MentionCard({ m }: { m: ParsedMention }) {
  const sentColor = m.sentiment === 'positive' ? 'text-chess-best'
    : m.sentiment === 'negative' ? 'text-chess-blunder' : 'text-chess-text-tertiary';
  const sentDot = m.sentiment === 'positive' ? '🟢' : m.sentiment === 'negative' ? '🔴' : '⚪';
  return (
    <div className="border border-chess-border/30 rounded-lg p-3 mb-2 hover:border-chess-accent/40 transition-colors">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${sentColor}`}>{sentDot} {m.sentiment}</span>
        {m.highIntent && <span className="text-[10px] font-bold uppercase tracking-wider text-chess-accent">🎯 high-intent</span>}
        <span className="text-[11px] text-chess-text-tertiary">r/{m.subreddit}</span>
        <span className="text-[11px] text-chess-text-tertiary">·</span>
        <span className="text-[11px] text-chess-text-tertiary">{m.ageHrs.toFixed(0)}h ago</span>
        <span className="text-[11px] text-chess-text-tertiary">·</span>
        <span className="text-[11px] text-chess-text-tertiary">{m.upvotes}↑ · {m.comments} comments</span>
        <span className="text-[11px] text-chess-text-tertiary">by u/{m.author}</span>
        <a
          href={m.url}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-chess-accent hover:underline ms-auto"
        >
          open thread →
        </a>
      </div>
      <div className="text-[13px] font-bold text-chess-text mb-1">{m.title}</div>
      {m.excerpt && (
        <blockquote className="text-[12px] text-chess-text-tertiary italic border-l-2 border-chess-border/40 pl-2 line-clamp-2">
          {m.excerpt}
        </blockquote>
      )}
    </div>
  );
}

function Stat({
  label, value, suffix, hint, valueClass,
}: {
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-chess-bg/40 rounded p-3">
      <div className="text-[11px] text-chess-text-tertiary mb-1">{label}</div>
      <div className={`text-2xl font-extrabold ${valueClass ?? 'text-chess-text'}`}>
        {value}<span className="text-[12px] text-chess-text-tertiary font-normal">{suffix}</span>
      </div>
      {hint && <div className="text-[10px] text-chess-text-tertiary mt-1">{hint}</div>}
    </div>
  );
}
