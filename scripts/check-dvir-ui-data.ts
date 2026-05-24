/**
 * What does Dvir actually SEE in the UI?
 *
 * The UI reads:
 *   - Game list (82 imported)
 *   - Analysis records (one per analyzed game)
 *   - Pattern record (snapshot of weakness patterns)
 *   - UserPreferences (chesscom username, theme, journey state)
 *
 * Compute: how many Analysis rows exist for him, what time windows have
 * coverage, and what the Pattern row looks like.
 */
const DVIR_USER_ID = '6a020a5536d35a06a6025a3e';

const games = await base44.entities.Game.list();
const analyses = await base44.entities.Analysis.list();
const patterns = await base44.entities.Pattern.list();
const prefs = await base44.entities.UserPreferences.list();

const dvirGames = (games as Array<Record<string, unknown>>).filter(g =>
  String(g.created_by_id) === DVIR_USER_ID
);
const dvirAnalyses = (analyses as Array<Record<string, unknown>>).filter(a =>
  String(a.created_by_id) === DVIR_USER_ID
);
const dvirPattern = (patterns as Array<Record<string, unknown>>).find(p =>
  String(p.created_by_id) === DVIR_USER_ID
);
const dvirPref = (prefs as Array<Record<string, unknown>>).find(p =>
  String(p.created_by_id) === DVIR_USER_ID
);

console.log(`=== Dvir UI data snapshot ===\n`);
console.log(`Games visible:    ${dvirGames.length}`);
console.log(`Analysis rows:    ${dvirAnalyses.length}`);
console.log(`Pattern rows:     ${dvirPattern ? 1 : 0}`);
console.log(`Pref rows:        ${dvirPref ? 1 : 0}`);

// Cross-reference: how many of Dvir's games have a matching Analysis?
const gameEntityIds = new Set(dvirGames.map(g => String(g.id)));
const gameIdToEntity = new Map(dvirGames.map(g => [String(g.id), g]));
const analysisGameIds = new Set(dvirAnalyses.map(a => String(a.gameId)));

const gamesWithAnalysis = dvirGames.filter(g => analysisGameIds.has(String(g.id)));
const gamesMarkedComplete = dvirGames.filter(g => g.analysisStatus === 'complete');
console.log(`\nGames with a matching Analysis row:  ${gamesWithAnalysis.length}`);
console.log(`Games marked analysisStatus=complete: ${gamesMarkedComplete.length}`);

// Orphans?
const orphanAnalyses = dvirAnalyses.filter(a => !gameEntityIds.has(String(a.gameId)));
console.log(`Orphan analyses (no matching game): ${orphanAnalyses.length}`);

// Time-window coverage (Overview's "Last week / Last month / All time")
const now = Date.now();
const day = 86400_000;
const buckets = {
  week:  dvirGames.filter(g => now - ((g.playedAt as number) ?? 0) < 7 * day).length,
  month: dvirGames.filter(g => now - ((g.playedAt as number) ?? 0) < 30 * day).length,
  all:   dvirGames.length,
};
const analyzedBuckets = {
  week:  gamesWithAnalysis.filter(g => now - ((g.playedAt as number) ?? 0) < 7 * day).length,
  month: gamesWithAnalysis.filter(g => now - ((g.playedAt as number) ?? 0) < 30 * day).length,
  all:   gamesWithAnalysis.length,
};

console.log(`\nTime-window coverage (games / analyzed):`);
console.log(`  Last 7 days:   ${buckets.week} / ${analyzedBuckets.week}`);
console.log(`  Last 30 days:  ${buckets.month} / ${analyzedBuckets.month}`);
console.log(`  All time:      ${buckets.all} / ${analyzedBuckets.all}`);

// Sample one analysis to see what it has
if (dvirAnalyses[0]) {
  const sample = dvirAnalyses[0];
  const keys = Object.keys(sample);
  console.log(`\nSample analysis keys: ${keys.slice(0, 8).join(', ')}...`);
}

// Pattern row inspection
if (dvirPattern) {
  console.log(`\nPattern row (id=${dvirPattern.id}):`);
  console.log(`  updated_date: ${dvirPattern.updated_date}`);
  const patternsArr = (dvirPattern as any).patterns;
  if (Array.isArray(patternsArr)) {
    console.log(`  patterns count: ${patternsArr.length}`);
    for (const p of patternsArr.slice(0, 4)) {
      console.log(`    - ${p.id ?? p.name ?? p.tag ?? '(unknown)'}: ${JSON.stringify(p).slice(0, 120)}`);
    }
  }
  if ((dvirPattern as any).gameCount) console.log(`  gameCount: ${(dvirPattern as any).gameCount}`);
  if ((dvirPattern as any).analyzedCount) console.log(`  analyzedCount: ${(dvirPattern as any).analyzedCount}`);
}

// Journey stage inference
if (dvirPref) {
  console.log(`\nJourney indicators:`);
  console.log(`  radarRevealedAt:    ${dvirPref.radarRevealedAt ? new Date(dvirPref.radarRevealedAt as number).toISOString() : 'null'}`);
  console.log(`  patternsUnlockedAt: ${dvirPref.patternsUnlockedAt ? new Date(dvirPref.patternsUnlockedAt as number).toISOString() : 'null'}`);
  console.log(`  selectedTimeClass:  ${dvirPref.selectedTimeClass}`);
  console.log(`  guidedWalkthroughDone: ${dvirPref.guidedWalkthroughDone}`);
}

// What he should see at top of Overview: tier from skill profile
// We don't compute the profile server-side; estimate by analyzed count.
console.log(`\nUI screens & what they show:`);
console.log(`  Overview (radar):  computed from ${analyzedBuckets.all} analyzed games (out of ${buckets.all}).`);
console.log(`                     Last-week overlay: ${analyzedBuckets.week} / ${buckets.week} analyzed (needs ≥3 to render).`);
console.log(`                     All-time overlay:  ${analyzedBuckets.all} / ${buckets.all} analyzed.`);
console.log(`  Recent Games list: ${buckets.all} rows (sorted newest first).`);
console.log(`  Patterns:          ${Array.isArray((dvirPattern as any)?.patterns) ? ((dvirPattern as any).patterns as unknown[]).length : 0} pattern entries.`);
