/**
 * Drill into dvirs12's state — appeared multiple times in the stale list.
 */
const DVIR_USERNAME = 'dvirs12';

const prefs = await base44.entities.UserPreferences.list();
const games = await base44.entities.Game.list();

// Find all preference rows tied to dvirs12 (by chesscomUsername)
const dvirPrefs = (prefs as Array<Record<string, unknown>>).filter(p =>
  String(p.chesscomUsername ?? '').toLowerCase() === DVIR_USERNAME
);

console.log(`=== ${dvirPrefs.length} UserPreferences rows with chesscomUsername=${DVIR_USERNAME} ===\n`);

for (const p of dvirPrefs) {
  const id = String(p.created_by_id);
  const userGames = (games as Array<Record<string, unknown>>)
    .filter(g => String(g.created_by_id) === id)
    .sort((a, b) => ((b.playedAt as number) ?? 0) - ((a.playedAt as number) ?? 0));
  console.log(`  pref.id=${p.id}, created_by_id=${id}`);
  console.log(`    created_date=${p.created_date}`);
  console.log(`    updated_date=${p.updated_date}`);
  console.log(`    radarRevealedAt=${p.radarRevealedAt ? new Date(p.radarRevealedAt as number).toISOString() : 'null'}`);
  console.log(`    language=${p.language}`);
  console.log(`    games owned by this user_id: ${userGames.length}`);
  if (userGames[0]) {
    console.log(`    newest local playedAt: ${new Date((userGames[0].playedAt as number) ?? 0).toISOString()}`);
    console.log(`    newest local created_date: ${userGames[0].created_date}`);
  }
  console.log();
}

// chess.com newest game for dvirs12
const archivesRes = await fetch(`https://api.chess.com/pub/player/${DVIR_USERNAME}/games/archives`);
const { archives } = await archivesRes.json() as { archives: string[] };
console.log(`Chess.com archives: ${archives.length}`);
const lastArchive = archives[archives.length - 1];
console.log(`Latest archive: ${lastArchive}`);
const monthRes = await fetch(lastArchive);
const { games: monthGames } = await monthRes.json() as { games: Array<{ end_time: number; url: string }> };
const latest10 = monthGames.slice(-10);
console.log(`\nChess.com latest 10 games:`);
for (const g of latest10) {
  const idMatch = g.url.match(/\/(\d+)$/);
  const gameId = idMatch ? idMatch[1] : g.url;
  console.log(`  end_time=${new Date(g.end_time * 1000).toISOString()}  gameId=${gameId}`);
}

// Check each gameId — does it exist on Base44, and under whose ID?
const dvirIds = new Set(dvirPrefs.map(p => String(p.created_by_id)));
console.log(`\n=== Are dvir's recent chess.com games on Base44? ===`);
for (const g of latest10) {
  const idMatch = g.url.match(/\/(\d+)$/);
  const gameId = idMatch ? idMatch[1] : g.url;
  try {
    const existing = await (base44.entities as any).Game.filter({ gameId });
    const arr = Array.isArray(existing) ? existing : [];
    if (arr.length === 0) {
      console.log(`  ${gameId}: NO RECORDS`);
    } else {
      for (const rec of arr as Array<Record<string, unknown>>) {
        const owner = String(rec.created_by_id);
        const isDvir = dvirIds.has(owner);
        console.log(`  ${gameId}: owner=${owner} ${isDvir ? '(DVIR)' : '(OTHER USER)'}`);
      }
    }
  } catch (err) {
    console.log(`  ${gameId}: filter error: ${(err as Error).message}`);
  }
}
