import { useEffect, useState } from 'react';

// Karma ladder + per-account stats fetched from Reddit's public user JSON
// endpoint. Mirrors the ladder in ReddGrow: Start → Newcomer 10 →
// Contributor 50 → Trusted 100 → Established 500. The threshold here is
// total karma (post + comment). Account-creation date hints at how seasoned
// the account looks to Reddit's anti-spam model.

interface KarmaJourneyProps {
  username: string;
}

interface RedditUserData {
  total_karma: number;
  link_karma: number;
  comment_karma: number;
  created_utc: number;
  is_suspended?: boolean;
  has_verified_email?: boolean;
}

const STAGES = [
  { name: 'Start',       threshold: 0,   hint: 'New account — only Warmup drafts. No links allowed by most subs.' },
  { name: 'Newcomer',    threshold: 10,  hint: 'Some karma — most subs unlock posting. Still avoid promotional content.' },
  { name: 'Contributor', threshold: 50,  hint: 'Trusted enough for occasional Promotional drafts (1 per 9 Warmup).' },
  { name: 'Trusted',     threshold: 100, hint: 'Most subs treat you as a regular. Self-promo allowed within 9:1.' },
  { name: 'Established', threshold: 500, hint: 'Karma cushion is real. Mistakes recover instead of getting banned.' },
];

const CACHE_KEY = (u: string) => `chess-dna:karma-cache:${u}`;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — Reddit's about.json is heavily cached anyway.

async function fetchKarma(username: string): Promise<RedditUserData | null> {
  // Try cache first to avoid hammering Reddit on every dashboard load.
  try {
    const raw = localStorage.getItem(CACHE_KEY(username));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts < CACHE_TTL_MS) return parsed.data;
    }
  } catch {}

  try {
    const res = await fetch(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const data = json?.data;
    if (!data) return null;
    try { localStorage.setItem(CACHE_KEY(username), JSON.stringify({ ts: Date.now(), data })); } catch {}
    return data;
  } catch {
    return null;
  }
}

export default function KarmaJourney({ username }: KarmaJourneyProps) {
  const [data, setData] = useState<RedditUserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const d = await fetchKarma(username);
      if (cancelled) return;
      if (!d) setError(`Couldn't fetch u/${username}`);
      setData(d);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [username]);

  const karma = data?.total_karma ?? 0;
  const currentStage = [...STAGES].reverse().find(s => karma >= s.threshold) ?? STAGES[0];
  const currentIdx = STAGES.indexOf(currentStage);
  const nextStage = STAGES[currentIdx + 1];

  // Progress to next stage (clamped 0–1).
  const progress = nextStage
    ? Math.min(1, Math.max(0, (karma - currentStage.threshold) / (nextStage.threshold - currentStage.threshold)))
    : 1;

  const accountAgeDays = data ? Math.floor((Date.now() / 1000 - data.created_utc) / 86400) : 0;

  return (
    <div className="bg-chess-surface rounded-xl border border-chess-border/40 p-4 mb-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <div>
          <h3 className="text-sm font-bold text-chess-text">Karma Journey</h3>
          <a
            href={`https://www.reddit.com/user/${username}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-chess-text-tertiary hover:text-chess-accent"
          >
            u/{username} →
          </a>
        </div>
        {!loading && data && (
          <div className="text-right">
            <div className="text-xl font-extrabold text-chess-text leading-tight">
              {karma.toLocaleString()}
              <span className="text-[12px] text-chess-text-tertiary font-normal ms-1">total karma</span>
            </div>
            <div className="text-[10px] text-chess-text-tertiary">
              {data.link_karma.toLocaleString()} post · {data.comment_karma.toLocaleString()} comment · {accountAgeDays}d old
            </div>
          </div>
        )}
        {loading && <div className="text-[11px] text-chess-text-tertiary">Loading…</div>}
        {error && <div className="text-[11px] text-chess-blunder">{error}</div>}
      </div>

      <div className="flex items-center gap-1 mb-2">
        {STAGES.map((s, i) => {
          const reached = karma >= s.threshold;
          const isCurrent = s === currentStage;
          return (
            <div key={s.name} className="flex-1 flex flex-col items-center" title={s.hint}>
              <div
                className={`w-full h-1.5 rounded-full ${
                  reached
                    ? isCurrent
                      ? 'bg-chess-accent'
                      : 'bg-chess-best'
                    : i === currentIdx + 1
                      ? 'bg-chess-bg/60 overflow-hidden'
                      : 'bg-chess-bg/40'
                }`}
              >
                {i === currentIdx + 1 && (
                  <div
                    className="h-full bg-chess-accent transition-all"
                    style={{ width: `${progress * 100}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-chess-text-tertiary">
        {STAGES.map(s => (
          <div key={s.name} className="flex-1 text-center">
            <div className={karma >= s.threshold ? 'font-bold text-chess-text' : ''}>{s.name}</div>
            <div>{s.threshold}</div>
          </div>
        ))}
      </div>

      {!loading && data && (
        <div className="mt-3 text-[12px] text-chess-text-secondary bg-chess-bg/40 rounded p-2.5">
          <strong className="text-chess-text">{currentStage.name}.</strong>{' '}
          {currentStage.hint}
          {nextStage && (
            <span className="text-chess-text-tertiary">
              {' '}Reach <strong>{nextStage.name}</strong> in {(nextStage.threshold - karma).toLocaleString()} more karma.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
