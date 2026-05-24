/**
 * Churn analysis for the closed-beta cohort.
 *
 * For each BetaTester:
 *   - last AnalyticsEvent (any kind)         → engagement recency
 *   - count of AnalyticsEvent                → engagement intensity
 *   - distinct active days                   → return-visits
 *   - chesscom/lichess username from prefs   → did they get past account-link
 *   - games / analyses imported              → did they get past onboarding
 *
 * Buckets (cohort is only ~6 days old — seeded 2026-05-11):
 *   - Never opened    : 0 events
 *   - Bounced         : ≥1 event but only on day 1, no return
 *   - Dormant 7d+     : last event ≥ 7 days ago
 *   - Cooling 3-7d    : last event 3-7 days ago
 *   - Active <3d      : last event in last 3 days
 *
 * Run: `cat scripts/churn-analysis-beta.ts | npx base44 exec`
 */

type Row = Record<string, unknown>;
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const fmtDate = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const daysAgo = (ts: number) => Math.floor((NOW - ts) / DAY);

console.log(`Run time: ${new Date(NOW).toISOString()}`);

// 1) Pull cohort
const betaTesters = (await base44.entities.BetaTester.list()) as Row[];
console.log(`Beta testers: ${betaTesters.length}`);

// 2) Pull UserPreferences once, map email <-> prefs (via chesscomUsername we cannot,
//    so we'll filter per-email below).
const allPrefs = (await base44.entities.UserPreferences.list()) as Row[];
console.log(`UserPreferences rows: ${allPrefs.length}`);

// 3) Pull all Games once (2,837 total — small enough). Group by created_by_id.
const allGames = (await base44.entities.Game.list()) as Row[];
console.log(`Game rows: ${allGames.length}`);
const gamesByUserId = new Map<string, Row[]>();
for (const g of allGames) {
  const uid = String(g.created_by_id ?? '');
  if (!uid) continue;
  if (!gamesByUserId.has(uid)) gamesByUserId.set(uid, []);
  gamesByUserId.get(uid)!.push(g);
}

// 4) For each beta tester: filter AnalyticsEvent and Prefs by their email/uid.
type Profile = {
  email: string;
  fullName: string;
  cohortDays: number;
  signedUpDate: string;
  prefsCount: number;
  userIds: string[];
  chesscom: string;
  lichess: string;
  aiChoiceMade: boolean;
  tutorialStep: number;
  guidedWalkthroughDone: boolean;
  patternsUnlockedAt: number | null;
  events: number;
  firstEvent: number | null;
  lastEvent: number | null;
  activeDays: number;
  games: number;
  gamesAnalyzed: number;
  firstGameImported: number | null;
  lastGameImported: number | null;
  lastGamePlayed: number | null;
  bucket: string;
  notes: string[];
};

const profiles: Profile[] = [];

for (const bt of betaTesters) {
  const email = String(bt.email ?? '').toLowerCase();
  const fullName = String(bt.fullName ?? '');
  const createdDate = String(bt.created_date ?? '');
  const signedUpAt = createdDate ? new Date(createdDate).getTime() : NaN;
  const cohortDays = isFinite(signedUpAt) ? Math.floor((NOW - signedUpAt) / DAY) : -1;

  // Find their UserPreferences row(s) by created_by (email) — fallback to filter.
  const myPrefs = (await base44.entities.UserPreferences.filter({ created_by: email })) as Row[];
  const userIds = [...new Set(myPrefs.map(p => String(p.created_by_id ?? '')).filter(Boolean))];
  const primaryPref = myPrefs[0] ?? {};

  // Gather their games via every user_id we found in prefs.
  const myGames = userIds.flatMap(uid => gamesByUserId.get(uid) ?? []);
  const gamesAnalyzed = myGames.filter(g => g.analysisStatus === 'complete').length;
  const importedTs = myGames.map(g => new Date(String(g.created_date ?? 0)).getTime()).filter(t => isFinite(t) && t > 0);
  const playedTs = myGames.map(g => Number(g.playedAt ?? 0)).filter(t => t > 0);
  const firstGameImported = importedTs.length ? Math.min(...importedTs) : null;
  const lastGameImported = importedTs.length ? Math.max(...importedTs) : null;
  const lastGamePlayed = playedTs.length ? Math.max(...playedTs) : null;

  // Pull all their AnalyticsEvents (filter by userEmail).
  const myEvents = (await base44.entities.AnalyticsEvent.filter({ userEmail: email })) as Row[];
  const eventTs = myEvents.map(e => Number(e.timestamp ?? 0)).filter(t => t > 0);
  const firstEvent = eventTs.length ? Math.min(...eventTs) : null;
  const lastEvent = eventTs.length ? Math.max(...eventTs) : null;
  const activeDays = new Set(eventTs.map(t => fmtDate(t))).size;

  // Bucket
  let bucket = 'Never opened';
  if (myEvents.length > 0 && lastEvent != null) {
    const ageDays = (NOW - lastEvent) / DAY;
    if (activeDays === 1 && ageDays > 2) bucket = 'Bounced (1-day only)';
    else if (ageDays >= 7) bucket = 'Dormant 7d+';
    else if (ageDays >= 3) bucket = 'Cooling 3-7d';
    else bucket = 'Active <3d';
  }

  // Notes
  const notes: string[] = [];
  if (!primaryPref.chesscomUsername && !primaryPref.lichessUsername) notes.push('no account linked');
  if (myGames.length === 0 && (primaryPref.chesscomUsername || primaryPref.lichessUsername)) {
    notes.push('linked but 0 games');
  }
  if (myPrefs.length > 1) notes.push(`${myPrefs.length} pref rows (multi-login?)`);
  if (myGames.length > 0 && myEvents.length === 0) notes.push('games imported but no events (pre-analytics)');

  profiles.push({
    email,
    fullName,
    cohortDays,
    signedUpDate: createdDate.slice(0, 10),
    prefsCount: myPrefs.length,
    userIds,
    chesscom: String(primaryPref.chesscomUsername ?? ''),
    lichess: String(primaryPref.lichessUsername ?? ''),
    aiChoiceMade: Boolean(primaryPref.aiChoiceMade),
    tutorialStep: Number(primaryPref.tutorialStep ?? 0),
    guidedWalkthroughDone: Boolean(primaryPref.guidedWalkthroughDone),
    patternsUnlockedAt: primaryPref.patternsUnlockedAt ? Number(primaryPref.patternsUnlockedAt) : null,
    events: myEvents.length,
    firstEvent,
    lastEvent,
    activeDays,
    games: myGames.length,
    gamesAnalyzed,
    firstGameImported,
    lastGameImported,
    lastGamePlayed,
    bucket,
    notes,
  });
}

// 5) Sort: bucket priority, then last activity desc within bucket.
const bucketOrder = ['Active <3d', 'Cooling 3-7d', 'Dormant 7d+', 'Bounced (1-day only)', 'Never opened'];
profiles.sort((a, b) => {
  const ai = bucketOrder.indexOf(a.bucket);
  const bi = bucketOrder.indexOf(b.bucket);
  if (ai !== bi) return ai - bi;
  return (b.lastEvent ?? 0) - (a.lastEvent ?? 0);
});

// 6) Summary
console.log('\n=== BUCKET COUNTS ===');
const counts = new Map<string, number>();
for (const p of profiles) counts.set(p.bucket, (counts.get(p.bucket) ?? 0) + 1);
for (const b of bucketOrder) {
  const c = counts.get(b) ?? 0;
  const pct = ((c / profiles.length) * 100).toFixed(0);
  console.log(`  ${b.padEnd(22)} ${String(c).padStart(2)}  (${pct}%)`);
}

// 7) Engagement quartiles among activated
const activated = profiles.filter(p => p.events > 0);
const eventCounts = activated.map(p => p.events).sort((a, b) => a - b);
const median = eventCounts.length ? eventCounts[Math.floor(eventCounts.length / 2)] : 0;
const p75 = eventCounts.length ? eventCounts[Math.floor(eventCounts.length * 0.75)] : 0;
const totalEvents = eventCounts.reduce((a, b) => a + b, 0);
console.log(`\nActivated: ${activated.length}/${profiles.length}  ·  total events: ${totalEvents}`);
console.log(`  events per activated user — median ${median}, p75 ${p75}, max ${eventCounts.at(-1) ?? 0}`);

const everImportedGames = profiles.filter(p => p.games > 0).length;
const everAnalyzed = profiles.filter(p => p.gamesAnalyzed > 0).length;
console.log(`Linked account: ${profiles.filter(p => p.chesscom || p.lichess).length}/${profiles.length}`);
console.log(`Imported ≥1 game: ${everImportedGames}/${profiles.length}`);
console.log(`Got ≥1 analysis: ${everAnalyzed}/${profiles.length}`);

// 8) Per-user table
console.log('\n=== PER-USER DETAIL ===');
console.log(
  [
    'bucket'.padEnd(22),
    'days-since'.padStart(10),
    'events'.padStart(7),
    'days'.padStart(5),
    'games'.padStart(6),
    'analyz'.padStart(7),
    'tutor'.padStart(6),
    'cc-user'.padEnd(18),
    'name'.padEnd(26),
    'email',
  ].join('  ')
);
console.log('-'.repeat(140));
for (const p of profiles) {
  const dsl = p.lastEvent ? `${daysAgo(p.lastEvent)}d` : '—';
  const cc = (p.chesscom || p.lichess || '—').slice(0, 17);
  const name = p.fullName.slice(0, 25);
  console.log(
    [
      p.bucket.padEnd(22),
      String(dsl).padStart(10),
      String(p.events).padStart(7),
      String(p.activeDays).padStart(5),
      String(p.games).padStart(6),
      String(p.gamesAnalyzed).padStart(7),
      String(p.tutorialStep).padStart(6),
      cc.padEnd(18),
      name.padEnd(26),
      p.email,
    ].join('  ')
  );
  if (p.notes.length > 0) {
    console.log(`${' '.repeat(24)}↳ ${p.notes.join(' · ')}`);
  }
}

// 9) Call-out lists
console.log('\n=== RISK LISTS ===');

const neverOpened = profiles.filter(p => p.bucket === 'Never opened');
if (neverOpened.length) {
  console.log(`\n[NEVER OPENED] ${neverOpened.length} testers — never landed on the app:`);
  for (const p of neverOpened) {
    console.log(`  • ${p.fullName.padEnd(22)} ${p.email}`);
  }
}

const bounced = profiles.filter(p => p.bucket === 'Bounced (1-day only)');
if (bounced.length) {
  console.log(`\n[BOUNCED] ${bounced.length} testers — opened once on day 1, never returned:`);
  for (const p of bounced) {
    const last = p.lastEvent ? fmtDate(p.lastEvent) : '—';
    console.log(`  • ${p.fullName.padEnd(22)} ${p.email.padEnd(34)} last seen ${last}  (${p.events} events)`);
  }
}

const dormant = profiles.filter(p => p.bucket === 'Dormant 7d+');
if (dormant.length) {
  console.log(`\n[DORMANT 7d+] ${dormant.length} testers — engaged early but quiet now:`);
  for (const p of dormant) {
    const last = p.lastEvent ? fmtDate(p.lastEvent) : '—';
    console.log(`  • ${p.fullName.padEnd(22)} ${p.email.padEnd(34)} last ${last}  (${p.events} ev, ${p.activeDays}d, ${p.games}g)`);
  }
}

const stuckPreAccount = profiles.filter(p => p.events > 0 && !p.chesscom && !p.lichess);
if (stuckPreAccount.length) {
  console.log(`\n[STUCK PRE-LINK] ${stuckPreAccount.length} opened the app but never linked an account:`);
  for (const p of stuckPreAccount) {
    console.log(`  • ${p.fullName.padEnd(22)} ${p.email.padEnd(34)} (${p.events} events, bucket: ${p.bucket})`);
  }
}

const linkedButNoGames = profiles.filter(p => (p.chesscom || p.lichess) && p.games === 0);
if (linkedButNoGames.length) {
  console.log(`\n[LINKED BUT NO IMPORT] ${linkedButNoGames.length} linked an account but no games landed:`);
  for (const p of linkedButNoGames) {
    console.log(`  • ${p.fullName.padEnd(22)} cc:${p.chesscom || p.lichess}  events:${p.events}  bucket:${p.bucket}`);
  }
}

// 10) Power users — heart of the cohort
console.log('\n=== POWER USERS (top 5 by events) ===');
const powerUsers = [...profiles].sort((a, b) => b.events - a.events).slice(0, 5);
for (const p of powerUsers) {
  const last = p.lastEvent ? fmtDate(p.lastEvent) : '—';
  console.log(`  ${p.fullName.padEnd(24)} ${p.events.toString().padStart(4)} events · ${p.activeDays}d active · ${p.games}g · last ${last}  [${p.bucket}]`);
}
