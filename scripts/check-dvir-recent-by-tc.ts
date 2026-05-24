/**
 * Dvir claims he sees his last game as May 8, but data shows May 13.
 * Hypothesis: his selectedTimeClass='rapid' filters out non-rapid games.
 *
 * Check: list his last 15 games with their time_class.
 */
const DVIR_USER_ID = '6a020a5536d35a06a6025a3e';

const games = await base44.entities.Game.list();
const dvirGames = (games as Array<Record<string, unknown>>).filter(g =>
  String(g.created_by_id) === DVIR_USER_ID
);

const sorted = [...dvirGames].sort((a, b) =>
  ((b.playedAt as number) ?? 0) - ((a.playedAt as number) ?? 0)
);

console.log(`Dvir has ${dvirGames.length} games total.`);
console.log(`\nLast 15 games (newest first):\n`);
console.log('  date (IL)            | timeClass | status     | gameId');
console.log('  ---------------------|-----------|------------|------------------');
for (const g of sorted.slice(0, 15)) {
  const playedAt = (g.playedAt as number) ?? 0;
  const playedAtIL = new Date(playedAt + 3 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  const tc = String(g.timeClass ?? '?').padEnd(9);
  const status = String(g.analysisStatus ?? '?').padEnd(10);
  console.log(`  ${playedAtIL}  | ${tc} | ${status} | ${g.gameId}`);
}

// Breakdown by time class
const tcCounts: Record<string, number> = {};
for (const g of dvirGames) {
  const tc = String(g.timeClass ?? 'unknown');
  tcCounts[tc] = (tcCounts[tc] ?? 0) + 1;
}
console.log(`\nTotal counts by timeClass:`);
for (const [k, v] of Object.entries(tcCounts).sort(([, a], [, b]) => b - a)) {
  console.log(`  ${k}: ${v}`);
}

// What's the newest RAPID game?
const rapidGames = dvirGames.filter(g => g.timeClass === 'rapid');
const newestRapid = rapidGames.sort((a, b) =>
  ((b.playedAt as number) ?? 0) - ((a.playedAt as number) ?? 0)
)[0];
if (newestRapid) {
  const playedAtIL = new Date((newestRapid.playedAt as number) + 3 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  console.log(`\nNewest RAPID game: ${playedAtIL} (gameId=${newestRapid.gameId})`);
}

// His selectedTimeClass
const prefs = await base44.entities.UserPreferences.list();
const dvirPref = (prefs as Array<Record<string, unknown>>).find(p =>
  String(p.created_by_id) === DVIR_USER_ID
);
console.log(`\nDvir's selectedTimeClass setting: ${dvirPref?.selectedTimeClass}`);
