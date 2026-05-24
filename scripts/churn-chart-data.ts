/**
 * Build the per-day cohort/churn series and write to scripts/.churn-chart-data.json
 *
 * Cohort = BetaTester emails − EXCLUDED.
 * Per user we fetch the FULL event history via filter({userEmail}) so we are
 * not bitten by the global 5000-record cap on entity.list().
 *
 * Output series, one point per day from Day 0 (first event in cohort) to today:
 *   - everActivated[D]  : cumulative count of users whose first event ≤ day D
 *   - stillEngaged[D]   : count whose last event ≥ day D  (treat today's actives as engaged)
 *   - churned[D]        : everActivated[D] − stillEngaged[D]
 *   - dau[D]            : count with any event on day D
 *   - cohortSize        : total approved users (BetaTester − excluded)
 *
 * Run: `cat scripts/churn-chart-data.ts | npx base44 exec`
 */

const EXCLUDED = new Set(['yuval.inc@gmail.com', 'capsule.stands@gmail.com']);

type Row = Record<string, unknown>;
const DAY = 24 * 60 * 60 * 1000;
const fmtDate = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const toUtcMid = (iso: string) => Date.UTC(
  Number(iso.slice(0, 4)),
  Number(iso.slice(5, 7)) - 1,
  Number(iso.slice(8, 10)),
);

const beta = (await base44.entities.BetaTester.list()) as Row[];
const cohort = new Set(
  beta.map(b => String(b.email ?? '').toLowerCase()).filter(e => e && !EXCLUDED.has(e))
);
console.log(`BetaTester cohort (after exclude): ${cohort.size}`);

// 3) Per user, pull full event history and capture first/last day.
type UserStat = { email: string; firstDay: string | null; lastDay: string | null; activeDays: Set<string>; events: number };
const stats: UserStat[] = [];

for (const email of cohort) {
  const ev = (await base44.entities.AnalyticsEvent.filter({ userEmail: email })) as Row[];
  const days = new Set<string>();
  let firstTs = Infinity;
  let lastTs = 0;
  for (const e of ev) {
    const ts = Number(e.timestamp ?? 0);
    if (!ts) continue;
    days.add(fmtDate(ts));
    if (ts < firstTs) firstTs = ts;
    if (ts > lastTs) lastTs = ts;
  }
  stats.push({
    email,
    firstDay: ev.length ? fmtDate(firstTs) : null,
    lastDay: ev.length ? fmtDate(lastTs) : null,
    activeDays: days,
    events: ev.length,
  });
}

// 4) Build day axis: from earliest first-event day → today, inclusive.
const firstDays = stats.map(s => s.firstDay).filter(Boolean) as string[];
const earliestIso = firstDays.sort()[0]; // e.g. '2026-05-12'
const todayIso = fmtDate(Date.now());
const start = toUtcMid(earliestIso);
const end = toUtcMid(todayIso);
const numDays = Math.round((end - start) / DAY) + 1;
const days: string[] = [];
for (let i = 0; i < numDays; i++) days.push(fmtDate(start + i * DAY));

// 5) Compute series.
const everActivated: number[] = [];
const stillEngaged: number[] = [];
const churned: number[] = [];
const dau: number[] = [];

for (const d of days) {
  let ever = 0;
  let still = 0;
  let active = 0;
  for (const s of stats) {
    if (s.firstDay && s.firstDay <= d) ever++;
    if (s.lastDay && s.lastDay >= d && s.firstDay && s.firstDay <= d) still++;
    if (s.activeDays.has(d)) active++;
  }
  everActivated.push(ever);
  stillEngaged.push(still);
  churned.push(ever - still);
  dau.push(active);
}

// 6) Print a compact table.
console.log('\nDay         Date         DAU  Ever-Active  Still-Engaged  Churned');
days.forEach((d, i) => {
  console.log(
    `Day ${String(i).padStart(2)}      ${d}      ${String(dau[i]).padStart(3)}      ${String(everActivated[i]).padStart(3)}            ${String(stillEngaged[i]).padStart(3)}        ${String(churned[i]).padStart(3)}`
  );
});

const cohortNeverActivated = [...cohort].filter(em => {
  const s = stats.find(x => x.email === em);
  return !s || s.events === 0;
});
console.log(`\nNever activated: ${cohortNeverActivated.length}/${cohort.size}`);
console.log(`Today's DAU: ${dau.at(-1)} / cohort ${cohort.size} (${((dau.at(-1)! / cohort.size) * 100).toFixed(0)}%)`);

// 7) Write JSON for the renderer.
const out = {
  generatedAt: new Date().toISOString(),
  excluded: [...EXCLUDED],
  cohortSize: cohort.size,
  neverActivated: cohortNeverActivated.length,
  todayIso,
  days,
  dau,
  everActivated,
  stillEngaged,
  churned,
};

// base44 exec runs in a Node context — fs is available.
const fs = await import('node:fs');
const path = '/Users/yuval/Chess-dna/scripts/.churn-chart-data.json';
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`\nWrote ${path}`);
