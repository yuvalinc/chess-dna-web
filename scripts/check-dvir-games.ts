/**
 * How many games does dvirs12 have now (post-cleanup)?
 * Cleanup only touched UserPreferences + Pattern — Games should be untouched.
 */
const DVIR_USER_ID = '6a020a5536d35a06a6025a3e';

const games = await base44.entities.Game.list();
const dvirGames = (games as Array<Record<string, unknown>>).filter(g =>
  String(g.created_by_id) === DVIR_USER_ID
);

console.log(`Total Game rows on Base44: ${games.length}`);
console.log(`Dvir's games (owned by ${DVIR_USER_ID}): ${dvirGames.length}`);

// Newest 5 by playedAt
const sorted = [...dvirGames].sort((a, b) =>
  ((b.playedAt as number) ?? 0) - ((a.playedAt as number) ?? 0)
);
console.log('\nNewest 5 games (by playedAt):');
for (const g of sorted.slice(0, 5)) {
  const playedAtMs = (g.playedAt as number) ?? 0;
  const playedAtIL = new Date(playedAtMs + 3 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  const createdAtIL = new Date(new Date(String(g.created_date)).getTime() + 3 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  console.log(`  gameId=${g.gameId}`);
  console.log(`    playedAt (IL): ${playedAtIL}`);
  console.log(`    createdAt (IL): ${createdAtIL}`);
  console.log(`    status: ${g.analysisStatus}`);
}

// Also: compare to chess.com
const archivesRes = await fetch(`https://api.chess.com/pub/player/dvirs12/games/archives`);
const { archives } = await archivesRes.json() as { archives: string[] };
const lastArchive = archives[archives.length - 1];
const monthRes = await fetch(lastArchive);
const { games: monthGames } = await monthRes.json() as { games: Array<{ end_time: number; url: string }> };
const ccNewest = monthGames[monthGames.length - 1];
if (ccNewest) {
  const ccMs = ccNewest.end_time * 1000;
  const ccIL = new Date(ccMs + 3 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\nChess.com newest game ended (IL): ${ccIL}`);
  const localNewestMs = (sorted[0]?.playedAt as number) ?? 0;
  const gapMin = Math.round((ccMs - localNewestMs) / 60_000);
  console.log(`Gap (chess.com end_time − local newest playedAt): ${gapMin} min`);
}

// How many analyzed?
const analyzedCount = dvirGames.filter(g => g.analysisStatus === 'complete').length;
const pendingCount = dvirGames.filter(g => g.analysisStatus === 'pending').length;
const inProgressCount = dvirGames.filter(g => g.analysisStatus === 'in_progress').length;
const otherCount = dvirGames.length - analyzedCount - pendingCount - inProgressCount;
console.log(`\nAnalysis status breakdown:`);
console.log(`  complete:    ${analyzedCount}`);
console.log(`  pending:     ${pendingCount}`);
console.log(`  in_progress: ${inProgressCount}`);
console.log(`  other:       ${otherCount}`);

// Did pattern row survive?
const patterns = await base44.entities.Pattern.list();
const dvirPatterns = (patterns as Array<Record<string, unknown>>).filter(p =>
  String(p.created_by_id) === DVIR_USER_ID
);
console.log(`\nDvir's Pattern rows after cleanup: ${dvirPatterns.length}`);
const prefs = await base44.entities.UserPreferences.list();
const dvirPrefs = (prefs as Array<Record<string, unknown>>).filter(p =>
  String(p.created_by_id) === DVIR_USER_ID
);
console.log(`Dvir's UserPreferences rows after cleanup: ${dvirPrefs.length}`);
if (dvirPrefs[0]) {
  console.log(`  kept pref id=${dvirPrefs[0].id}`);
  console.log(`  chesscom=${dvirPrefs[0].chesscomUsername}, language=${dvirPrefs[0].language}`);
  console.log(`  radarRevealedAt=${dvirPrefs[0].radarRevealedAt ? new Date(dvirPrefs[0].radarRevealedAt as number).toISOString() : 'null'}`);
}
