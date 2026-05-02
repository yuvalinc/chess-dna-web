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
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeId>('30d');
  const [typeFilter, setTypeFilter] = useState<typeof TYPE_FILTERS[number]['id']>('all');

  useEffect(() => {
    if (isAdmin !== true) return;
    const entities = base44.entities as unknown as Record<string, { list: () => Promise<AnalyticsEventRecord[]> }>;
    const Entity = entities.AnalyticsEvent;
    if (!Entity) {
      setError('AnalyticsEvent entity not deployed yet. Run `npx base44 schema deploy` to push it.');
      return;
    }
    (async () => {
      try {
        const list = await Entity.list();
        setEvents(list as AnalyticsEventRecord[]);
      } catch (err) {
        setError(`Failed to load: ${(err as Error).message}`);
      }
    })();
  }, [isAdmin]);

  // ── Filter window ────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!events) return [];
    const cutoff = range === 'all' ? 0 : Date.now() - (RANGES.find(r => r.id === range)!.ms);
    return events.filter(e => {
      if (e.timestamp < cutoff) return false;
      if (typeFilter !== 'all' && e.eventType !== typeFilter) return false;
      return true;
    });
  }, [events, range, typeFilter]);

  // ── KPIs ─────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!events) return null;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const monthMs = 30 * dayMs;

    const allUsers = new Set<string>();
    const dau = new Set<string>();
    const mau = new Set<string>();
    let signupTotal = 0;
    let signupRecent = 0;
    let analyses = 0;
    let analysesToday = 0;
    let pageViews = 0;

    for (const e of events) {
      if (e.anonymousId) allUsers.add(e.anonymousId);
      if (now - e.timestamp <= dayMs && e.anonymousId) dau.add(e.anonymousId);
      if (now - e.timestamp <= monthMs && e.anonymousId) mau.add(e.anonymousId);
      if (e.eventType === 'signup') {
        signupTotal++;
        if (now - e.timestamp <= 7 * dayMs) signupRecent++;
      }
      if (e.eventType === 'analysis' && e.eventName === 'analysis_complete') {
        analyses++;
        if (now - e.timestamp <= dayMs) analysesToday++;
      }
      if (e.eventType === 'page_view') pageViews++;
    }

    return {
      totalUsers: allUsers.size,
      dau: dau.size,
      mau: mau.size,
      signupTotal,
      signupRecent,
      analyses,
      analysesToday,
      pageViews,
      eventCount: events.length,
    };
  }, [events]);

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

  // ── Onboarding funnel ────────────────────────────────────────────────
  const funnel = useMemo(() => {
    if (!events) return [];
    // Count distinct users observed at each stage. We look at `journeyStage`
    // on every event — a user counts toward stage N if any event of theirs
    // was tagged with that stage or higher.
    const reached: Record<number, Set<string>> = { 0: new Set(), 1: new Set(), 2: new Set(), 5: new Set() };
    for (const e of events) {
      if (!e.anonymousId) continue;
      const s = e.journeyStage;
      if (s >= 0) reached[0].add(e.anonymousId);
      if (s >= 1) reached[1].add(e.anonymousId);
      if (s >= 2) reached[2].add(e.anonymousId);
      if (s >= 5) reached[5].add(e.anonymousId);
    }
    const total = reached[0].size || 1;
    return [
      { stage: 'S0 Landing', users: reached[0].size, pct: 100 },
      { stage: 'S1 Decoding', users: reached[1].size, pct: Math.round(100 * reached[1].size / total) },
      { stage: 'S2 Reveal', users: reached[2].size, pct: Math.round(100 * reached[2].size / total) },
      { stage: 'S5 Onboarded', users: reached[5].size, pct: Math.round(100 * reached[5].size / total) },
    ];
  }, [events]);

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
  // a few useful per-user counters.
  type UserRow = {
    key: string;
    email: string;
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
  };
  const users = useMemo<UserRow[]>(() => {
    if (!events) return [];
    const map = new Map<string, UserRow>();
    for (const e of events) {
      const key = e.userEmail && e.userEmail.length > 0
        ? `email:${e.userEmail}`
        : `anon:${e.anonymousId}`;
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          email: e.userEmail || '',
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
        };
        map.set(key, row);
      }
      // Promote to authenticated if any event for this key carries an email.
      if (e.userEmail && !row.email) row.email = e.userEmail;
      if (!e.isGuest) row.isGuest = false;
      if (e.timestamp < row.firstSeen) row.firstSeen = e.timestamp;
      if (e.timestamp > row.lastSeen) row.lastSeen = e.timestamp;
      row.events++;
      if (e.eventType === 'page_view') row.pageViews++;
      if (e.eventType === 'click') row.clicks++;
      if (e.eventType === 'analysis' && e.eventName === 'analysis_complete') row.analyses++;
      if (e.eventType === 'signup') row.signedUp = true;
      if (typeof e.journeyStage === 'number' && e.journeyStage > row.maxStage) {
        row.maxStage = e.journeyStage;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }, [events]);

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

      {/* KPI strip */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          <KpiCard label="Total Users" value={formatNumber(kpis.totalUsers)} sub={`${formatNumber(kpis.eventCount)} events`} />
          <KpiCard label="DAU" value={formatNumber(kpis.dau)} sub="last 24h" />
          <KpiCard label="MAU" value={formatNumber(kpis.mau)} sub="last 30d" />
          <KpiCard label="Signups" value={formatNumber(kpis.signupTotal)} sub={`+${kpis.signupRecent} last 7d`} />
          <KpiCard label="Analyses" value={formatNumber(kpis.analyses)} sub={`+${kpis.analysesToday} today`} />
        </div>
      )}

      {/* Charts row 1: DAU + Funnel */}
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

        <Card title="Onboarding funnel" subtitle="Distinct users by max stage observed">
          {funnel.length === 0 ? (
            <EmptyState>Funnel will populate as users onboard.</EmptyState>
          ) : (
            <div className="space-y-2.5">
              {funnel.map((row, i) => (
                <div key={row.stage}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[12px] font-bold text-chess-text">{row.stage}</span>
                    <span className="text-[11px] text-chess-text-tertiary tabular-nums">
                      <span className="text-chess-text font-bold">{row.users}</span>
                      <span className="ms-2">{row.pct}%</span>
                    </span>
                  </div>
                  <div className="h-2 bg-chess-bg rounded overflow-hidden border border-chess-border/30">
                    <div
                      className="h-full bg-chess-accent transition-all"
                      style={{ width: `${row.pct}%`, opacity: 0.5 + (i / funnel.length) * 0.5 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
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
        <Card title="Users" subtitle={`${users.length} unique`}>
          {users.length === 0 ? <EmptyState>No users yet.</EmptyState> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-chess-text-tertiary border-b border-chess-border/30">
                    <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">User</th>
                    <th className="text-start py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Status</th>
                    <th className="text-end py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Events</th>
                    <th className="text-end py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Pages</th>
                    <th className="text-end py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Clicks</th>
                    <th className="text-end py-1.5 pr-2 font-bold uppercase tracking-wider text-[9px]">Analyses</th>
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
                      <td className="py-1 pr-2 text-end text-chess-text tabular-nums">{u.events}</td>
                      <td className="py-1 pr-2 text-end text-chess-text-tertiary tabular-nums">{u.pageViews}</td>
                      <td className="py-1 pr-2 text-end text-chess-text-tertiary tabular-nums">{u.clicks}</td>
                      <td className="py-1 pr-2 text-end text-chess-text-tertiary tabular-nums">{u.analyses}</td>
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
