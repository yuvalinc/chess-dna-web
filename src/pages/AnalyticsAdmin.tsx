/* ────────────────────────────────────────────────────────────────────────
 *  AnalyticsAdmin — admin-only dashboard for the in-app analytics events.
 *
 *  Fetches all AnalyticsEvent records once (Base44 list() — capped at
 *  5000 records, so this works fine for a small/medium app), then derives
 *  every chart client-side from the same array. Memoized aggregations
 *  keep filter changes snappy.
 *
 *  Sections:
 *    • KPI strip  — total users, DAU, MAU, signups, analyses
 *    • DAU chart  — unique anonymousIds per day over the time range
 *    • Onboarding funnel — stage 0 → 5 with conversion rates
 *    • Top pages  — page_view counts
 *    • Top clicks — click event counts
 *    • Recent events table — last N events for spot-checking
 * ──────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { base44 } from '@/api/base44Client';
import type { AnalyticsEventRecord } from '@/analytics/types';
import { safeParseProperties } from '@/analytics/types';
import { detectBot, detectAiReferrer, type BotCategory } from '@/analytics/bot-detection';
import { BETA_TESTERS, MANUAL_BETA_EMAILS } from '@shared/beta-testers';

/** Subset of UserPreferences we read on the admin dashboard. Base44 returns
 *  more fields, but we only need username + onboarding flags + identity for
 *  joining onto the per-user analytics aggregation.
 *
 *  Identity field: Base44 only reliably exposes `created_by_id` (the user's
 *  Base44 id). It does NOT include the user's email on the returned row, so
 *  the join key is `created_by_id` ↔ AnalyticsEvent.userId. */
interface UserPrefsRow {
  id?: string;
  created_by_id?: string;    // base44 user id — the join key
  created_by?: string;       // sometimes present, sometimes not — keep as fallback
  chesscomUsername?: string;
  lichessUsername?: string;
  radarRevealedAt?: number;
  patternsUnlockedAt?: number;
  guidedWalkthroughDone?: boolean;
}

/** Best-effort guess at which OAuth provider was used. Base44 doesn't expose
 *  this, so we fall back to email-domain heuristics — clearly imperfect but
 *  good enough to spot a Google-vs-Apple skew. */
function authSourceFromEmail(email: string): 'google' | 'apple' | 'other' {
  const lower = email.toLowerCase();
  if (lower.endsWith('@gmail.com') || lower.endsWith('@googlemail.com')) return 'google';
  if (lower.endsWith('@icloud.com') || lower.endsWith('@me.com') || lower.endsWith('@mac.com') || lower.endsWith('@privaterelay.appleid.com')) return 'apple';
  return 'other';
}

const RANGES = [
  { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: '90d', label: '90d', ms: 90 * 24 * 60 * 60 * 1000 },
  { id: 'all', label: 'All', ms: Number.POSITIVE_INFINITY },
] as const;
type RangeId = typeof RANGES[number]['id'];

const TYPE_FILTERS: { id: 'all' | AnalyticsEventRecord['eventType']; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'page_view', label: 'Pages' },
  { id: 'click', label: 'Clicks' },
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'signup', label: 'Signup' },
  { id: 'custom', label: 'Custom' },
];

function dayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface KpiCardProps { label: string; value: string; sub?: string }
function KpiCard({ label, value, sub }: KpiCardProps) {
  return (
    <div className="bg-chess-surface rounded-xl p-3.5 border border-chess-border/40">
      <div className="text-[10px] font-bold uppercase tracking-[1.4px] text-chess-text-tertiary">{label}</div>
      <div className="text-2xl font-extrabold text-chess-text mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-chess-text-tertiary mt-0.5">{sub}</div>}
    </div>
  );
}

interface CardProps { title: string; subtitle?: string; children: React.ReactNode }
function Card({ title, subtitle, children }: CardProps) {
  return (
    <div className="bg-chess-surface rounded-xl p-4 border border-chess-border/40">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-extrabold text-chess-text">{title}</h3>
        {subtitle && <span className="text-[11px] text-chess-text-tertiary">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

export default function AnalyticsAdmin() {
  const { isAdmin } = useAuth();
  const [events, setEvents] = useState<AnalyticsEventRecord[] | null>(null);
  const [prefs, setPrefs] = useState<UserPrefsRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeId>('30d');
  const [typeFilter, setTypeFilter] = useState<typeof TYPE_FILTERS[number]['id']>('all');

  useEffect(() => {
    if (isAdmin !== true) return;
    const entities = base44.entities as unknown as Record<string, { list: () => Promise<unknown[]> }>;
    const EvtEntity = entities.AnalyticsEvent;
    const PrefsEntity = entities.UserPreferences;
    if (!EvtEntity) {
      setError('AnalyticsEvent entity not deployed yet. Run `npx base44 schema deploy` to push it.');
      return;
    }
    (async () => {
      try {
        // Fire both fetches in parallel — admin RLS lets us read every
        // UserPreferences row, which we'll join onto each user below to
        // surface chess.com / lichess usernames.
        const [evtList, prefsList] = await Promise.all([
          EvtEntity.list() as Promise<AnalyticsEventRecord[]>,
          PrefsEntity ? (PrefsEntity.list() as Promise<UserPrefsRow[]>) : Promise.resolve([] as UserPrefsRow[]),
        ]);
        setEvents(evtList);
        setPrefs(prefsList);
      } catch (err) {
        setError(`Failed to load: ${(err as Error).message}`);
      }
    })();
  }, [isAdmin]);

  /** userId → UserPrefsRow lookup. Used to enrich per-user rows with
   *  chess.com / lichess usernames the analytics events don't carry.
   *  We key on `created_by_id` because Base44's list() doesn't return the
   *  user email on the row — only the Base44 user id. */
  const prefsById = useMemo(() => {
    const map = new Map<string, UserPrefsRow>();
    for (const p of prefs) {
      const id = p.created_by_id ?? '';
      if (!id) continue;
      // If the same user id has multiple rows (legacy migrations etc), prefer
      // the one that actually has username data populated.
      const existing = map.get(id);
      if (!existing) { map.set(id, p); continue; }
      const incomingScore = (p.chesscomUsername ? 1 : 0) + (p.lichessUsername ? 1 : 0);
      const existingScore = (existing.chesscomUsername ? 1 : 0) + (existing.lichessUsername ? 1 : 0);
      if (incomingScore > existingScore) map.set(id, p);
    }
    return map;
  }, [prefs]);

  // ── Filter windows ───────────────────────────────────────────────────
  // `rangedEvents` = events inside the active time-range filter only. Used
  // by every range-aware view (KPIs, waterfall, users table, breakdowns).
  // `filtered` adds the type-filter on top — it's only used by the bottom
  // "Recent events" / "Top X" tables that have their own type chip row.
  const rangedEvents = useMemo(() => {
    if (!events) return [];
    if (range === 'all') return events;
    const cutoff = Date.now() - (RANGES.find(r => r.id === range)!.ms);
    return events.filter(e => e.timestamp >= cutoff);
  }, [events, range]);

  const filtered = useMemo(() => {
    if (typeFilter === 'all') return rangedEvents;
    return rangedEvents.filter(e => e.eventType === typeFilter);
  }, [rangedEvents, typeFilter]);

  // ── KPIs ─────────────────────────────────────────────────────────────
  // Most KPIs respect the active range; DAU/MAU keep their own definitions
  // (last 24h / last 30d are inherent windows, not range-relative) so the
  // labels under those cards stay correct regardless of the picker.
  const kpis = useMemo(() => {
    if (!events) return null;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const monthMs = 30 * dayMs;

    const inRangeUsers = new Set<string>();
    const dau = new Set<string>();
    const mau = new Set<string>();
    let signupInRange = 0;
    let signupRecent = 0;
    let analysesInRange = 0;
    let analysesToday = 0;
    let pageViewsInRange = 0;

    // DAU/MAU are computed over the full event log so the "last 24h / 30d"
    // sub-labels remain truthful even when the picker is on 7d / 90d.
    for (const e of events) {
      if (now - e.timestamp <= dayMs && e.anonymousId) dau.add(e.anonymousId);
      if (now - e.timestamp <= monthMs && e.anonymousId) mau.add(e.anonymousId);
      if (e.eventType === 'signup' && now - e.timestamp <= 7 * dayMs) signupRecent++;
      if (e.eventType === 'analysis' && e.eventName === 'analysis_complete' && now - e.timestamp <= dayMs) {
        analysesToday++;
      }
    }
    // Range-scoped totals (these reflect the active picker).
    for (const e of rangedEvents) {
      if (e.anonymousId) inRangeUsers.add(e.anonymousId);
      if (e.eventType === 'signup') signupInRange++;
      if (e.eventType === 'analysis' && e.eventName === 'analysis_complete') analysesInRange++;
      if (e.eventType === 'page_view') pageViewsInRange++;
    }

    return {
      totalUsers: inRangeUsers.size,
      dau: dau.size,
      mau: mau.size,
      signupTotal: signupInRange,
      signupRecent,
      analyses: analysesInRange,
      analysesToday,
      pageViews: pageViewsInRange,
      eventCount: rangedEvents.length,
    };
  }, [events, rangedEvents]);

  // ── DAU time series ──────────────────────────────────────────────────
  const dauSeries = useMemo(() => {
    if (!events) return [];
    const cutoff = range === 'all'
      ? events.reduce((min, e) => Math.min(min, e.timestamp), Date.now())
      : Date.now() - (RANGES.find(r => r.id === range)!.ms);
    const buckets = new Map<string, Set<string>>();
    for (const e of events) {
      if (e.timestamp < cutoff) continue;
      const k = dayKey(e.timestamp);
      let bucket = buckets.get(k);
      if (!bucket) { bucket = new Set(); buckets.set(k, bucket); }
      if (e.anonymousId) bucket.add(e.anonymousId);
    }
    return Array.from(buckets.entries())
      .map(([day, set]) => ({ day, users: set.size }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [events, range]);

  // ── Conversion waterfall (LP → app usage) ───────────────────────────
  // Each row is a stricter superset of the row above it. A user counts
  // toward stage N if ANY of their events satisfy the predicate (or if the
  // joined UserPreferences row carries the corresponding state — important
  // for users who onboarded before we instrumented the import events).
  const waterfall = useMemo(() => {
    if (!events) return [];
    const empty = () => new Set<string>();
    const buckets = {
      landed: empty(),         // any event at all
      ctaClick: empty(),       // clicked "Get Started" on the landing page
      pickedSource: empty(),   // entered a chess.com / lichess username (or import attempted)
      importedGames: empty(),  // import completed OR journeyStage >= 1 (had games)
      sawRadar: empty(),       // journeyStage >= 2 (radarRevealedAt set)
      patternsUnlocked: empty(),
      onboarded: empty(),      // journeyStage >= 5 (guidedWalkthroughDone)
      signedUp: empty(),       // signup event fired
      returning: empty(),      // events on 2+ distinct calendar days
    };
    const daysSeen = new Map<string, Set<string>>();

    // Helper: same key the Users table uses, so the funnel and the table
    // count "the same person" identically.
    const keyOf = (e: AnalyticsEventRecord): string =>
      e.userEmail && e.userEmail.length > 0 ? `email:${e.userEmail}` : `anon:${e.anonymousId}`;

    for (const e of rangedEvents) {
      const k = keyOf(e);
      buckets.landed.add(k);

      // Track distinct days for the "returning" bucket.
      let days = daysSeen.get(k);
      if (!days) { days = new Set(); daysSeen.set(k, days); }
      days.add(dayKey(e.timestamp));

      if (e.eventType === 'click' && e.eventName === 'landing_get_started') {
        buckets.ctaClick.add(k);
      }
      if (e.eventType === 'analysis' && (e.eventName === 'chesscom_import_started' || e.eventName === 'lichess_import_started')) {
        buckets.pickedSource.add(k);
      }
      if (e.eventType === 'analysis' && (e.eventName === 'chesscom_import_complete' || e.eventName === 'lichess_import_complete')) {
        const props = safeParseProperties(e.properties);
        if (typeof props.gamesImported === 'number' && props.gamesImported > 0) {
          buckets.importedGames.add(k);
          buckets.pickedSource.add(k);
        }
      }
      if (e.eventType === 'signup') buckets.signedUp.add(k);

      // Journey-stage falls back (covers users who onboarded before we
      // instrumented imports — their stage marches forward as they progress).
      const s = e.journeyStage;
      if (s >= 1) buckets.importedGames.add(k);
      if (s >= 1) buckets.pickedSource.add(k);
      if (s >= 1) buckets.ctaClick.add(k); // they're past the landing screen
      if (s >= 2) buckets.sawRadar.add(k);
      if (s >= 4) buckets.patternsUnlocked.add(k);
      if (s >= 5) buckets.onboarded.add(k);
    }

    // UserPreferences fallback: an authenticated user with a username set
    // counts as having "picked source" even if they never fired the new
    // import events (they imported before we deployed instrumentation).
    // We need a userId → bucket-key index to match prefs (which only carry
    // created_by_id) onto the funnel keys (which use email).
    const keyByUserId = new Map<string, string>();
    for (const e of rangedEvents) {
      if (e.userId) keyByUserId.set(e.userId, keyOf(e));
    }
    for (const p of prefs) {
      const id = p.created_by_id ?? '';
      if (!id) continue;
      const k = keyByUserId.get(id);
      if (!k || !buckets.landed.has(k)) continue;
      if (p.chesscomUsername || p.lichessUsername) {
        buckets.pickedSource.add(k);
      }
      if (p.radarRevealedAt) buckets.sawRadar.add(k);
      if (p.patternsUnlockedAt) buckets.patternsUnlocked.add(k);
      if (p.guidedWalkthroughDone) buckets.onboarded.add(k);
    }

    for (const [k, days] of daysSeen) {
      if (days.size >= 2) buckets.returning.add(k);
    }

    const total = buckets.landed.size || 1;
    const row = (label: string, set: Set<string>, hint?: string) => ({
      label,
      users: set.size,
      pct: Math.round(100 * set.size / total),
      hint,
    });

    return [
      row('Landed on site', buckets.landed),
      row('Clicked Get Started', buckets.ctaClick, 'or progressed past landing'),
      row('Connected platform', buckets.pickedSource, 'chess.com / lichess username'),
      row('Imported games', buckets.importedGames),
      row('Saw their DNA radar', buckets.sawRadar),
      row('Unlocked patterns', buckets.patternsUnlocked),
      row('Fully onboarded', buckets.onboarded, 'finished walkthrough'),
      row('Created an account', buckets.signedUp),
      row('Returned (2+ days)', buckets.returning),
    ];
  }, [events, rangedEvents, prefs]);

  // ── Top pages / clicks ───────────────────────────────────────────────
  const topPages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of filtered) {
      if (e.eventType !== 'page_view') continue;
      counts.set(e.path, (counts.get(e.path) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([path, count]) => ({ name: path || '/', count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [filtered]);

  const topClicks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of filtered) {
      if (e.eventType !== 'click') continue;
      counts.set(e.eventName, (counts.get(e.eventName) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [filtered]);

  // ── Users list ───────────────────────────────────────────────────────
  // Aggregate events by user. Authenticated users key on userEmail (so the
  // same human across devices/sessions collapses into one row); guests key
  // on anonymousId. Each row carries last-seen, event count, max stage, and
  // a few useful per-user counters, plus chess.com / lichess usernames
  // joined from UserPreferences.
  type UserRow = {
    key: string;
    email: string;
    userId: string;
    anonymousId: string;
    isGuest: boolean;
    firstSeen: number;
    lastSeen: number;
    events: number;
    pageViews: number;
    analyses: number;
    clicks: number;
    maxStage: number;
    signedUp: boolean;
    chesscom: string;
    lichess: string;
    importedGames: number; // from chesscom_import_complete + lichess_import_complete events
    authSource: 'guest' | 'google' | 'apple' | 'other';
  };
  const users = useMemo<UserRow[]>(() => {
    if (!events) return [];
    const map = new Map<string, UserRow>();
    for (const e of rangedEvents) {
      const key = e.userEmail && e.userEmail.length > 0
        ? `email:${e.userEmail}`
        : `anon:${e.anonymousId}`;
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          email: e.userEmail || '',
          userId: e.userId || '',
          anonymousId: e.anonymousId,
          isGuest: e.isGuest,
          firstSeen: e.timestamp,
          lastSeen: e.timestamp,
          events: 0,
          pageViews: 0,
          analyses: 0,
          clicks: 0,
          maxStage: e.journeyStage ?? -1,
          signedUp: false,
          chesscom: '',
          lichess: '',
          importedGames: 0,
          authSource: e.isGuest ? 'guest' : 'other',
        };
        map.set(key, row);
      }
      // Promote to authenticated if any event for this key carries an email.
      if (e.userEmail && !row.email) row.email = e.userEmail;
      if (e.userId && !row.userId) row.userId = e.userId;
      if (!e.isGuest) row.isGuest = false;
      if (e.timestamp < row.firstSeen) row.firstSeen = e.timestamp;
      if (e.timestamp > row.lastSeen) row.lastSeen = e.timestamp;
      row.events++;
      if (e.eventType === 'page_view') row.pageViews++;
      if (e.eventType === 'click') row.clicks++;
      if (e.eventType === 'analysis' && e.eventName === 'analysis_complete') row.analyses++;
      if (e.eventType === 'analysis' && (e.eventName === 'chesscom_import_complete' || e.eventName === 'lichess_import_complete')) {
        const props = safeParseProperties(e.properties);
        const n = typeof props.gamesImported === 'number' ? props.gamesImported : 0;
        row.importedGames += n;
        // Capture the username if the import event included it (covers
        // guests, who don't have a UserPreferences row to join against).
        const u = typeof props.username === 'string' ? props.username : '';
        if (u && e.eventName === 'chesscom_import_complete' && !row.chesscom) row.chesscom = u;
        if (u && e.eventName === 'lichess_import_complete' && !row.lichess) row.lichess = u;
      }
      if (e.eventType === 'signup') row.signedUp = true;
      if (typeof e.journeyStage === 'number' && e.journeyStage > row.maxStage) {
        row.maxStage = e.journeyStage;
      }
    }
    // Join UserPreferences (admin reads all rows) for chess.com / lichess
    // usernames. The join key is the Base44 user id (UserPreferences carries
    // `created_by_id` but not the user's email). Auth-source label still
    // comes from the email when available.
    for (const row of map.values()) {
      if (row.userId) {
        const p = prefsById.get(row.userId);
        if (p) {
          if (p.chesscomUsername && !row.chesscom) row.chesscom = p.chesscomUsername;
          if (p.lichessUsername && !row.lichess) row.lichess = p.lichessUsername;
        }
      }
      if (row.email) {
        row.authSource = authSourceFromEmail(row.email);
      } else if (!row.isGuest) {
        // Authenticated user but auth.me() never returned an email for them
        // (Base44 occasionally 401s on /me). Mark "other" so we don't lump
        // them in with guests in the breakdown.
        row.authSource = 'other';
      } else {
        row.authSource = 'guest';
      }
    }
    return Array.from(map.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }, [events, rangedEvents, prefsById]);

  // ── Auth-source breakdown ────────────────────────────────────────────
  const authBreakdown = useMemo(() => {
    const counts = { guest: 0, google: 0, apple: 0, other: 0 };
    for (const u of users) counts[u.authSource]++;
    return counts;
  }, [users]);

  // ── Import-source breakdown ──────────────────────────────────────────
  // Counts how many users have each platform's username on file (or fired
  // an import for it). "both" is users who connected both.
  const importBreakdown = useMemo(() => {
    let chesscomOnly = 0;
    let lichessOnly = 0;
    let both = 0;
    let none = 0;
    let guestNone = 0;
    let authNone = 0;
    let matched = 0;
    for (const u of users) {
      const cc = !!u.chesscom;
      const li = !!u.lichess;
      if (cc && li) both++;
      else if (cc) chesscomOnly++;
      else if (li) lichessOnly++;
      else {
        none++;
        if (u.authSource === 'guest') guestNone++; else authNone++;
      }
      if (u.userId && prefsById.has(u.userId)) matched++;
    }
    return { chesscomOnly, lichessOnly, both, none, guestNone, authNone, matched };
  }, [users, prefsById]);

  // ── Prefs diagnostic ────────────────────────────────────────────────
  // Surfaces "is the UserPreferences join actually working?" — useful when
  // the import breakdown looks suspiciously empty.
  const prefsStats = useMemo(() => {
    let withChesscom = 0;
    let withLichess = 0;
    let withUserId = 0;
    for (const p of prefs) {
      if (p.created_by_id) withUserId++;
      if (p.chesscomUsername) withChesscom++;
      if (p.lichessUsername) withLichess++;
    }
    return { total: prefs.length, withUserId, withChesscom, withLichess };
  }, [prefs]);

  // ── AI / Bot traffic ────────────────────────────────────────────────
  // Two distinct buckets:
  //   • Bot UA hits — events whose userAgent matches a known crawler or
  //     AI agent. Note: most training crawlers (GPTBot, ClaudeBot, ...)
  //     fetch raw HTML without running JS, so they NEVER reach a pure
  //     SPA's analytics. This view therefore skews toward agentic-browse
  //     traffic (Perplexity-User, ChatGPT-User, etc.) and headless
  //     scrapers. True crawler counts need backend log access.
  //   • AI-referrer visitors — humans who arrived from an AI chat
  //     surface (chatgpt.com, claude.ai, perplexity.ai, ...). Captured
  //     via document.referrer attached to the first page_view event.
  const aiTraffic = useMemo(() => {
    const botCache = new Map<string, ReturnType<typeof detectBot>>();
    const botCounts = new Map<string, { count: number; vendor: string; category: BotCategory }>();
    const aiReferrerBuckets = new Map<string, { label: string; users: Set<string>; events: number }>();
    let botEventCount = 0;
    let llmCrawlerEvents = 0;
    let llmAgentEvents = 0;
    const seenBotUsers = new Set<string>();
    const allAiVisitors = new Set<string>();
    let aiReferrerEventCount = 0;

    // Per-session detail: one row per unique anonymousId that hit us with a
    // bot UA. Each row aggregates all events from that session so admins
    // can see what the bot actually did (which paths, when, what UA).
    interface BotSession {
      anonymousId: string;
      botName: string;
      vendor: string;
      category: BotCategory;
      userAgent: string;
      events: number;
      firstSeen: number;
      lastSeen: number;
      paths: Set<string>;
      eventNames: Set<string>;
      isAuthed: boolean;
      userEmail: string;
    }
    const sessionMap = new Map<string, BotSession>();

    for (const e of rangedEvents) {
      // ── Bot UA detection (cache per-UA — most events share a UA) ───
      const ua = e.userAgent || '';
      let match = botCache.get(ua);
      if (match === undefined) {
        match = detectBot(ua);
        botCache.set(ua, match);
      }
      if (match) {
        botEventCount++;
        if (e.anonymousId) seenBotUsers.add(e.anonymousId);
        if (match.category === 'llm-crawler') llmCrawlerEvents++;
        else if (match.category === 'llm-agent') llmAgentEvents++;
        const existing = botCounts.get(match.name);
        if (existing) existing.count++;
        else botCounts.set(match.name, { count: 1, vendor: match.vendor, category: match.category });

        // Per-session aggregation. Key on (anonymousId + bot name) so a
        // single browser that gets reused by multiple distinct bots doesn't
        // collapse — rare but possible (shared IP / proxy).
        const sKey = `${e.anonymousId}|${match.name}`;
        let sess = sessionMap.get(sKey);
        if (!sess) {
          sess = {
            anonymousId: e.anonymousId,
            botName: match.name,
            vendor: match.vendor,
            category: match.category,
            userAgent: ua,
            events: 0,
            firstSeen: e.timestamp,
            lastSeen: e.timestamp,
            paths: new Set(),
            eventNames: new Set(),
            isAuthed: !e.isGuest,
            userEmail: e.userEmail || '',
          };
          sessionMap.set(sKey, sess);
        }
        sess.events++;
        sess.firstSeen = Math.min(sess.firstSeen, e.timestamp);
        sess.lastSeen = Math.max(sess.lastSeen, e.timestamp);
        if (e.path) sess.paths.add(e.path);
        if (e.eventName) sess.eventNames.add(e.eventName);
        if (!e.isGuest) sess.isAuthed = true;
        if (e.userEmail && !sess.userEmail) sess.userEmail = e.userEmail;
      }

      // ── AI referrer detection (from _docReferrer in properties) ────
      const props = safeParseProperties(e.properties);
      const docRef = typeof props._docReferrer === 'string' ? props._docReferrer : '';
      if (docRef) {
        const aiMatch = detectAiReferrer(docRef);
        if (aiMatch) {
          aiReferrerEventCount++;
          let bucket = aiReferrerBuckets.get(aiMatch.source);
          if (!bucket) {
            bucket = { label: aiMatch.label, users: new Set(), events: 0 };
            aiReferrerBuckets.set(aiMatch.source, bucket);
          }
          bucket.events++;
          if (e.anonymousId) {
            bucket.users.add(e.anonymousId);
            allAiVisitors.add(e.anonymousId);
          }
        }
      }
    }

    const botList = Array.from(botCounts.entries())
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => b.count - a.count);
    const referrerList = Array.from(aiReferrerBuckets.entries())
      .map(([source, info]) => ({ source, label: info.label, users: info.users.size, events: info.events }))
      .sort((a, b) => b.users - a.users);
    const sessions = Array.from(sessionMap.values()).sort((a, b) => b.lastSeen - a.lastSeen);

    return {
      botEventCount,
      llmCrawlerEvents,
      llmAgentEvents,
      botUserCount: seenBotUsers.size,
      botList,
      referrerList,
      aiReferrerEventCount,
      aiVisitorCount: allAiVisitors.size,
      sessions,
    };
  }, [rangedEvents]);

  // ── Recent events ────────────────────────────────────────────────────
  const recent = useMemo(() => {
    return [...filtered]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50);
  }, [filtered]);

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
    <div className="max-w-6xl mx-auto pb-20 px-1">
      <header className="flex flex-wrap items-baseline gap-3 mb-4">
        <h1 className="text-2xl font-extrabold text-chess-text">Analytics</h1>
        <span className="text-[12px] text-chess-text-tertiary">
          {events ? `${events.length.toLocaleString()} events tracked` : 'Loading…'}
        </span>
        <div className="ms-auto flex items-center gap-1 bg-chess-surface/60 border border-chess-border/40 rounded-lg p-1">
          {RANGES.map(r => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`px-2.5 py-1 rounded-md text-[12px] font-bold transition-colors ${
                range === r.id ? 'bg-chess-accent/15 text-chess-accent' : 'text-chess-text-tertiary hover:text-chess-text'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="bg-chess-blunder/15 border border-chess-blunder/30 rounded-lg p-3 mb-4 text-sm text-chess-blunder">
          {error}
        </div>
      )}

      <BetaTesterSyncCard />

      {/* KPI strip — Total/Signups/Analyses respect the range; DAU/MAU keep
          their inherent fixed windows so the labels stay truthful. */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          <KpiCard label="Users in range" value={formatNumber(kpis.totalUsers)} sub={`${formatNumber(kpis.eventCount)} events · ${range}`} />
          <KpiCard label="DAU" value={formatNumber(kpis.dau)} sub="last 24h" />
          <KpiCard label="MAU" value={formatNumber(kpis.mau)} sub="last 30d" />
          <KpiCard label="Signups" value={formatNumber(kpis.signupTotal)} sub={`+${kpis.signupRecent} last 7d · ${range}`} />
          <KpiCard label="Analyses" value={formatNumber(kpis.analyses)} sub={`+${kpis.analysesToday} today · ${range}`} />
          <KpiCard
            label="AI / Bot"
            value={formatNumber(aiTraffic.aiVisitorCount + aiTraffic.botUserCount)}
            sub={`${aiTraffic.aiVisitorCount} from chats · ${aiTraffic.botUserCount} bot UAs`}
          />
        </div>
      )}

      {/* Conversion waterfall — full width because it's the headline view */}
      <div className="mb-3">
        <Card
          title="Conversion waterfall"
          subtitle={`Landing page → app usage · ${range}`}
        >
          {waterfall.length === 0 || waterfall[0].users === 0 ? (
            <EmptyState>Waterfall will populate as users move through onboarding.</EmptyState>
          ) : (
            <div className="space-y-2">
              {waterfall.map((row, i) => {
                const prev = i > 0 ? waterfall[i - 1].users : row.users;
                const stepConv = prev > 0 ? Math.round(100 * row.users / prev) : 100;
                const drop = prev - row.users;
                return (
                  <div key={row.label}>
                    <div className="flex items-baseline justify-between mb-1">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-[10px] font-mono text-chess-text-tertiary tabular-nums w-4 text-end">{i}</span>
                        <span className="text-[12px] font-bold text-chess-text truncate">{row.label}</span>
                        {row.hint && <span className="text-[10px] text-chess-text-tertiary truncate">— {row.hint}</span>}
                      </div>
                      <div className="text-[11px] tabular-nums whitespace-nowrap ms-2">
                        <span className="text-chess-text font-bold">{row.users}</span>
                        <span className="text-chess-text-tertiary ms-2">{row.pct}%</span>
                        {i > 0 && (
                          <span className={`ms-2 ${stepConv >= 50 ? 'text-chess-accent' : 'text-amber-400'}`}>
                            ↳ {stepConv}%
                          </span>
                        )}
                        {i > 0 && drop > 0 && (
                          <span className="text-chess-blunder/70 ms-2">−{drop}</span>
                        )}
                      </div>
                    </div>
                    <div className="h-2.5 bg-chess-bg rounded overflow-hidden border border-chess-border/30">
                      <div
                        className="h-full bg-chess-accent transition-all"
                        style={{ width: `${row.pct}%`, opacity: 0.4 + (1 - i / waterfall.length) * 0.6 }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="text-[10px] text-chess-text-tertiary mt-2 leading-relaxed">
                <span className="text-chess-text font-bold">↳ N%</span> = step-to-step conversion ·{' '}
                <span className="text-chess-blunder/80">−N</span> = users lost at that step
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Charts row 1: DAU + Auth/Import breakdown */}
      <div className="grid lg:grid-cols-2 gap-3 mb-3">
        <Card title="Active users per day" subtitle={`Range: ${range}`}>
          {dauSeries.length === 0 ? (
            <EmptyState>No activity in this range yet.</EmptyState>
          ) : (
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={dauSeries} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#888' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#888' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#0e1726', border: '1px solid #1e3a5f', fontSize: 12 }} />
                  <Line type="monotone" dataKey="users" stroke="#4ade80" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Who they are" subtitle={`Auth source · Connected platform · ${range}`}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-chess-text-tertiary mb-2 font-bold">Auth (heuristic)</div>
              <BreakdownRow label="Guest" value={authBreakdown.guest} total={users.length} color="bg-amber-400" />
              <BreakdownRow label="Google (gmail)" value={authBreakdown.google} total={users.length} color="bg-cyan-400" />
              <BreakdownRow label="Apple-likely" value={authBreakdown.apple} total={users.length} color="bg-fuchsia-400" />
              <BreakdownRow label="Other domain" value={authBreakdown.other} total={users.length} color="bg-slate-400" />
              <div className="text-[9px] text-chess-text-tertiary mt-1.5 leading-snug">
                Guess from email domain — Base44 doesn't expose the OAuth provider.
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-chess-text-tertiary mb-2 font-bold">Connected platform</div>
              <BreakdownRow label="Chess.com only" value={importBreakdown.chesscomOnly} total={users.length} color="bg-emerald-400" />
              <BreakdownRow label="Lichess only" value={importBreakdown.lichessOnly} total={users.length} color="bg-purple-400" />
              <BreakdownRow label="Both" value={importBreakdown.both} total={users.length} color="bg-chess-accent" />
              <BreakdownRow label="None" value={importBreakdown.none} total={users.length} color="bg-chess-bg" />
              <div className="text-[9px] text-chess-text-tertiary mt-1.5 leading-snug space-y-0.5">
                <div>
                  None breakdown: <span className="text-chess-text">{importBreakdown.guestNone}</span> guest ·{' '}
                  <span className="text-chess-text">{importBreakdown.authNone}</span> authed
                </div>
                <div>
                  UserPreferences: <span className="text-chess-text">{prefsStats.total}</span> rows ·{' '}
                  <span className="text-chess-text">{prefsStats.withUserId}</span> with user id ·{' '}
                  <span className="text-chess-text">{prefsStats.withChesscom}</span> chess.com ·{' '}
                  <span className="text-chess-text">{prefsStats.withLichess}</span> lichess
                </div>
                <div>
                  Joined to a user in range: <span className="text-chess-text">{importBreakdown.matched}</span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* AI / Bot traffic — humans arriving from AI chats, plus bot UAs */}
      <div className="mb-3">
        <Card
          title="AI & bot traffic"
          subtitle={`From AI chats + crawler / agent UAs · ${range}`}
        >
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-chess-text-tertiary mb-2 font-bold">
                Visitors from AI chats <span className="text-chess-text-tertiary/60 normal-case font-normal">· via document.referrer</span>
              </div>
              {aiTraffic.referrerList.length === 0 ? (
                <div className="text-[11px] text-chess-text-tertiary py-2">
                  No AI-referred traffic yet. We capture <span className="font-mono">document.referrer</span> on the first page view of each session and match it against ChatGPT, Claude, Perplexity, Gemini, Copilot, You, Phind, Mistral, Meta, Poe, and similar surfaces.
                </div>
              ) : (
                <div className="space-y-1">
                  {aiTraffic.referrerList.map((r) => (
                    <BreakdownRow
                      key={r.source}
                      label={r.label}
                      value={r.users}
                      total={aiTraffic.aiVisitorCount || 1}
                      color={aiReferrerColor(r.source)}
                    />
                  ))}
                  <div className="text-[10px] text-chess-text-tertiary mt-2">
                    Total <span className="text-chess-text font-bold">{aiTraffic.aiVisitorCount}</span> unique visitors · <span className="text-chess-text font-bold">{aiTraffic.aiReferrerEventCount}</span> events
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider text-chess-text-tertiary mb-2 font-bold">
                Bot / crawler User-Agents <span className="text-chess-text-tertiary/60 normal-case font-normal">· seen in events</span>
              </div>
              {aiTraffic.botList.length === 0 ? (
                <div className="text-[11px] text-chess-text-tertiary py-2">
                  No bot User-Agents detected yet. Note: training crawlers like GPTBot and ClaudeBot fetch HTML without executing JS, so they typically never reach client-side analytics. What you'll see here is agentic-browse traffic (ChatGPT-User, Claude-User, Perplexity-User, MistralAI-User) and headless scrapers.
                </div>
              ) : (
                <div className="space-y-1">
                  {aiTraffic.botList.slice(0, 10).map((b) => (
                    <div key={b.name} className="mb-1.5">
                      <div className="flex items-baseline justify-between mb-0.5 gap-2">
                        <span className="text-[11px] text-chess-text font-mono truncate">{b.name}</span>
                        <span className="text-[10px] text-chess-text-tertiary tabular-nums whitespace-nowrap">
                          <span className={`me-1.5 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${botCategoryClass(b.category)}`}>
                            {botCategoryLabel(b.category)}
                          </span>
                          <span className="text-chess-text font-bold">{b.count}</span>
                        </span>
                      </div>
                    </div>
                  ))}
                  {aiTraffic.botList.length > 10 && (
                    <div className="text-[10px] text-chess-text-tertiary mt-1">
                      +{aiTraffic.botList.length - 10} more
                    </div>
                  )}
                  <div className="text-[10px] text-chess-text-tertiary mt-2 space-y-0.5">
                    <div>
                      Total <span className="text-chess-text font-bold">{aiTraffic.botEventCount}</span> bot events from <span className="text-chess-text font-bold">{aiTraffic.botUserCount}</span> distinct sessions
                    </div>
                    <div>
                      <span className="text-chess-text">{aiTraffic.llmAgentEvents}</span> LLM-agent ·{' '}
                      <span className="text-chess-text">{aiTraffic.llmCrawlerEvents}</span> LLM-crawler
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {aiTraffic.sessions.length > 0 && (
            <div className="mt-4 pt-3 border-t border-chess-border/30">
              <div className="text-[10px] uppercase tracking-wider text-chess-text-tertiary mb-2 font-bold">
                Bot sessions <span className="text-chess-text-tertiary/60 normal-case font-normal">· one row per (anonymousId, bot)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-chess-text-tertiary border-b border-chess-border/30">
                      <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Bot</th>
                      <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Cat</th>
                      <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Session</th>
                      <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Authed?</th>
                      <th className="text-end py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Events</th>
                      <th className="text-end py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Paths</th>
                      <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">First</th>
                      <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Last</th>
                      <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Sample path</th>
                      <th className="text-start py-1.5 font-bold uppercase tracking-wider text-[9px]">User-Agent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiTraffic.sessions.map((s) => {
                      const samplePath = Array.from(s.paths)[0] || '–';
                      return (
                        <tr key={`${s.anonymousId}|${s.botName}`} className="border-b border-chess-border/15 hover:bg-chess-bg/30 align-top">
                          <td className="py-1 pr-2 font-mono text-chess-text font-bold whitespace-nowrap">{s.botName}</td>
                          <td className="py-1 pr-2">
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${botCategoryClass(s.category)}`}>
                              {botCategoryLabel(s.category)}
                            </span>
                          </td>
                          <td className="py-1 pr-2 font-mono text-chess-text-tertiary text-[10px]">
                            {s.anonymousId.slice(0, 10)}…
                          </td>
                          <td className="py-1 pr-2">
                            {s.isAuthed ? (
                              <span className="text-chess-accent text-[10px] font-mono truncate inline-block max-w-[140px]">{s.userEmail || 'yes'}</span>
                            ) : (
                              <span className="text-amber-400 text-[10px]">no</span>
                            )}
                          </td>
                          <td className="py-1 pr-2 text-end text-chess-text tabular-nums">{s.events}</td>
                          <td className="py-1 pr-2 text-end text-chess-text-tertiary tabular-nums">{s.paths.size}</td>
                          <td className="py-1 pr-2 text-chess-text-tertiary tabular-nums whitespace-nowrap">
                            {new Date(s.firstSeen).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-1 pr-2 text-chess-text-tertiary tabular-nums whitespace-nowrap">
                            {new Date(s.lastSeen).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-1 pr-2 text-chess-text-tertiary font-mono text-[10px] truncate max-w-[140px]" title={samplePath}>
                            {samplePath}
                            {s.paths.size > 1 && <span className="text-chess-text-tertiary/60"> +{s.paths.size - 1}</span>}
                          </td>
                          <td className="py-1 text-chess-text-tertiary font-mono text-[9px] leading-tight max-w-[260px] break-all" title={s.userAgent}>
                            {s.userAgent.slice(0, 80)}{s.userAgent.length > 80 ? '…' : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-chess-border/30 text-[10px] text-chess-text-tertiary leading-relaxed">
            <span className="text-amber-400 font-bold">SPA limitation:</span> we only see bots that execute JavaScript.
            Pure HTML-fetching crawlers (the majority of LLM training scrapers) never reach this dashboard —
            measuring those would require backend access logs. Server-side instrumentation is a follow-up if this signal matters.
          </div>
        </Card>
      </div>

      {/* Charts row 2: Top pages + clicks */}
      <div className="grid lg:grid-cols-2 gap-3 mb-3">
        <Card title="Top pages" subtitle={`${topPages.length} routes`}>
          {topPages.length === 0 ? <EmptyState>No page views yet.</EmptyState> : (
            <div style={{ height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={topPages} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#888' }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#bbb' }} tickLine={false} axisLine={false} width={120} />
                  <Tooltip contentStyle={{ background: '#0e1726', border: '1px solid #1e3a5f', fontSize: 12 }} />
                  <Bar dataKey="count" fill="#4ade80" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Top click events" subtitle={`${topClicks.length} unique`}>
          {topClicks.length === 0 ? <EmptyState>No tracked clicks yet — add data-track to buttons.</EmptyState> : (
            <div style={{ height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={topClicks} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#888' }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#bbb' }} tickLine={false} axisLine={false} width={150} />
                  <Tooltip contentStyle={{ background: '#0e1726', border: '1px solid #1e3a5f', fontSize: 12 }} />
                  <Bar dataKey="count" fill="#22d3ee" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Users list */}
      <div className="mb-3">
        <Card title="Users" subtitle={`${users.length} unique · ${range}`}>
          {users.length === 0 ? <EmptyState>No users yet.</EmptyState> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-chess-text-tertiary border-b border-chess-border/30">
                    <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">User</th>
                    <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Status</th>
                    <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Auth</th>
                    <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Chess.com</th>
                    <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Lichess</th>
                    <th className="text-end py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Events</th>
                    <th className="text-end py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Pages</th>
                    <th className="text-end py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Clicks</th>
                    <th className="text-end py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Analyses</th>
                    <th className="text-end py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Imported</th>
                    <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Stage</th>
                    <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">First seen</th>
                    <th className="text-start py-1.5 font-bold uppercase tracking-wider text-[9px]">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {users.slice(0, 200).map((u) => (
                    <tr key={u.key} className="border-b border-chess-border/15 hover:bg-chess-bg/30">
                      <td className="py-1 pr-2 font-mono text-chess-text font-bold truncate max-w-[220px]">
                        {u.email || <span className="text-chess-text-tertiary">{u.anonymousId.slice(0, 10)}…</span>}
                      </td>
                      <td className="py-1 pr-2">
                        {u.isGuest ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-400 uppercase tracking-wider">guest</span>
                        ) : u.signedUp ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-chess-accent/15 text-chess-accent uppercase tracking-wider">signed up</span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-500/10 text-cyan-400 uppercase tracking-wider">user</span>
                        )}
                      </td>
                      <td className="py-1 pr-2">
                        <AuthBadge source={u.authSource} />
                      </td>
                      <td className="py-1 pr-2 text-chess-text font-mono text-[10px] truncate max-w-[120px]">
                        {u.chesscom || <span className="text-chess-text-tertiary/60">–</span>}
                      </td>
                      <td className="py-1 pr-2 text-chess-text font-mono text-[10px] truncate max-w-[120px]">
                        {u.lichess || <span className="text-chess-text-tertiary/60">–</span>}
                      </td>
                      <td className="py-1 pr-2 text-end text-chess-text tabular-nums">{u.events}</td>
                      <td className="py-1 pr-2 text-end text-chess-text-tertiary tabular-nums">{u.pageViews}</td>
                      <td className="py-1 pr-2 text-end text-chess-text-tertiary tabular-nums">{u.clicks}</td>
                      <td className="py-1 pr-2 text-end text-chess-text-tertiary tabular-nums">{u.analyses}</td>
                      <td className="py-1 pr-2 text-end text-chess-text-tertiary tabular-nums">{u.importedGames || ''}</td>
                      <td className="py-1 pr-2 text-chess-text-tertiary tabular-nums">{u.maxStage >= 0 ? `S${u.maxStage}` : '–'}</td>
                      <td className="py-1 pr-2 text-chess-text-tertiary tabular-nums whitespace-nowrap">
                        {new Date(u.firstSeen).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-1 text-chess-text-tertiary tabular-nums whitespace-nowrap">
                        {new Date(u.lastSeen).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length > 200 && (
                <div className="text-center text-[10px] text-chess-text-tertiary mt-2">
                  Showing top 200 of {users.length}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Recent events table */}
      <Card title="Recent events" subtitle={`Last ${recent.length}`}>
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          {TYPE_FILTERS.map(tf => (
            <button
              key={tf.id}
              onClick={() => setTypeFilter(tf.id)}
              className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition-colors ${
                typeFilter === tf.id
                  ? 'bg-chess-accent/15 text-chess-accent'
                  : 'bg-chess-bg/50 text-chess-text-tertiary hover:text-chess-text'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-chess-text-tertiary border-b border-chess-border/30">
                <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Time</th>
                <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Type</th>
                <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Event</th>
                <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Path</th>
                <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">User</th>
                <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Stage</th>
                <th className="text-start py-1.5 font-bold uppercase tracking-wider text-[9px]">Props</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => {
                const props = safeParseProperties(e.properties);
                const propsStr = Object.keys(props).length > 0
                  ? Object.entries(props).slice(0, 3).map(([k, v]) => `${k}=${String(v).slice(0, 20)}`).join(' ')
                  : '';
                return (
                  <tr key={e.id ?? `${e.timestamp}-${e.eventName}`} className="border-b border-chess-border/15 hover:bg-chess-bg/30">
                    <td className="py-1 pr-2 text-chess-text-tertiary tabular-nums whitespace-nowrap">
                      {new Date(e.timestamp).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-1 pr-2">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-chess-accent/10 text-chess-accent uppercase tracking-wider">
                        {e.eventType}
                      </span>
                    </td>
                    <td className="py-1 pr-2 font-mono text-chess-text font-bold">{e.eventName}</td>
                    <td className="py-1 pr-2 text-chess-text-tertiary truncate max-w-[120px]">{e.path}</td>
                    <td className="py-1 pr-2 text-chess-text-tertiary font-mono">
                      {e.isGuest ? <span className="text-amber-400">guest</span> : (e.userId || e.anonymousId.slice(0, 6))}
                    </td>
                    <td className="py-1 pr-2 text-chess-text-tertiary tabular-nums">{e.journeyStage >= 0 ? `S${e.journeyStage}` : '–'}</td>
                    <td className="py-1 text-chess-text-tertiary truncate max-w-[180px]">{propsStr}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {recent.length === 0 && <EmptyState>No events match this filter.</EmptyState>}
        </div>
      </Card>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center text-chess-text-tertiary py-8 text-sm">{children}</div>
  );
}

interface BreakdownRowProps { label: string; value: number; total: number; color: string }
function BreakdownRow({ label, value, total, color }: BreakdownRowProps) {
  const pct = total > 0 ? Math.round(100 * value / total) : 0;
  return (
    <div className="mb-1.5">
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="text-[11px] text-chess-text">{label}</span>
        <span className="text-[10px] text-chess-text-tertiary tabular-nums">
          <span className="text-chess-text font-bold">{value}</span>
          <span className="ms-1.5">{pct}%</span>
        </span>
      </div>
      <div className="h-1.5 bg-chess-bg rounded overflow-hidden border border-chess-border/30">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function aiReferrerColor(source: string): string {
  switch (source) {
    case 'chatgpt':    return 'bg-emerald-400';
    case 'claude':     return 'bg-amber-400';
    case 'perplexity': return 'bg-cyan-400';
    case 'gemini':     return 'bg-blue-400';
    case 'copilot':    return 'bg-sky-400';
    case 'you':        return 'bg-rose-400';
    case 'phind':      return 'bg-violet-400';
    case 'mistral':    return 'bg-orange-400';
    case 'meta':       return 'bg-indigo-400';
    case 'poe':        return 'bg-fuchsia-400';
    default:           return 'bg-slate-400';
  }
}

function botCategoryClass(cat: BotCategory): string {
  switch (cat) {
    case 'llm-agent':     return 'bg-emerald-500/15 text-emerald-300';
    case 'llm-crawler':   return 'bg-amber-500/15 text-amber-300';
    case 'search-engine': return 'bg-cyan-500/15 text-cyan-300';
    case 'other-bot':     return 'bg-slate-500/15 text-slate-300';
  }
}

function botCategoryLabel(cat: BotCategory): string {
  switch (cat) {
    case 'llm-agent':     return 'agent';
    case 'llm-crawler':   return 'crawler';
    case 'search-engine': return 'search';
    case 'other-bot':     return 'bot';
  }
}

function AuthBadge({ source }: { source: 'guest' | 'google' | 'apple' | 'other' }) {
  const cls =
    source === 'guest' ? 'bg-amber-500/10 text-amber-400' :
    source === 'google' ? 'bg-cyan-500/10 text-cyan-400' :
    source === 'apple' ? 'bg-fuchsia-500/10 text-fuchsia-400' :
    'bg-slate-500/10 text-slate-300';
  const label =
    source === 'guest' ? 'guest' :
    source === 'google' ? 'gmail' :
    source === 'apple' ? 'apple?' :
    'other';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${cls}`}>{label}</span>
  );
}

/**
 * Read-only roster view, rendered from code constants — no DB calls.
 * The runtime gate is `isWhitelistedEmail()` in beta-testers.ts; the
 * Base44 BetaTester entity is irrelevant for access. Showing the roster
 * here purely for admin visibility.
 */
function BetaTesterSyncCard() {
  const totalInCode = BETA_TESTERS.length + MANUAL_BETA_EMAILS.length;

  return (
    <div className="bg-chess-surface/60 border border-chess-border/40 rounded-lg p-4 mb-4">
      <div>
        <h3 className="text-sm font-bold text-chess-text">Beta tester roster</h3>
        <p className="text-[12px] text-chess-text-tertiary mt-0.5">
          {totalInCode} approved in code · {BETA_TESTERS.length} signup-form + {MANUAL_BETA_EMAILS.length} manual
        </p>
      </div>
      {MANUAL_BETA_EMAILS.length > 0 && (
        <div className="mt-3 text-[12px]">
          <div className="text-chess-text-tertiary uppercase tracking-wider text-[10px] font-bold mb-1">Manual additions</div>
          <ul className="text-chess-text-secondary font-mono text-[11px] space-y-0.5">
            {MANUAL_BETA_EMAILS.map(email => (
              <li key={email}>{email}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
