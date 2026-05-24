/**
 * Drill into Shaked's specific situation:
 * 1. Get all chess.com games for shaked2219 since May 8.
 * 2. For each, query Base44 by gameId — see if a record exists, and under whose created_by_id.
 * 3. Compare with what Shaked's user_id owns.
 *
 * The hypothesis: if Shaked's recent games exist on Base44 under another
 * user's created_by_id (e.g., they're in Yuval's friend list), then Shaked's
 * `entities.Game.filter({ gameId })` returns those cross-user records, and
 * the dedup blocks Shaked from creating their own copy.
 */
const SHAKED_USERNAME = 'shaked2219';
const SHAKED_USER_ID = '6a0235684d7ee2d5d44dcbe0'; // the active one (91 games, May 12 newest)

// 1. Fetch chess.com games for shaked2219 — last archive only.
const archivesRes = await fetch(`https://api.chess.com/pub/player/${SHAKED_USERNAME}/games/archives`);
const { archives } = await archivesRes.json() as { archives: string[] };
const lastArchive = archives[archives.length - 1];
console.log(`Latest archive: ${lastArchive}`);
const monthRes = await fetch(lastArchive);
const { games: monthGames } = await monthRes.json() as { games: Array<{ end_time: number; url: string }> };

// Latest 10 games
const latest = monthGames.slice(-10);
console.log(`\nChess.com latest 10 games for ${SHAKED_USERNAME}:`);
for (const g of latest) {
  const idMatch = g.url.match(/\/(\d+)$/);
  const gameId = idMatch ? idMatch[1] : g.url;
  console.log(`  end_time=${new Date(g.end_time * 1000).toISOString()}  gameId=${gameId}`);
}

// 2. For each gameId, ask Base44 what records exist.
console.log(`\n\nChecking Base44 for each gameId:`);
for (const g of latest) {
  const idMatch = g.url.match(/\/(\d+)$/);
  const gameId = idMatch ? idMatch[1] : g.url;
  try {
    const existing = await (base44.entities as any).Game.filter({ gameId });
    const arr = Array.isArray(existing) ? existing : [];
    if (arr.length === 0) {
      console.log(`  ${gameId}: NO RECORDS on Base44`);
    } else {
      for (const rec of arr as Array<Record<string, unknown>>) {
        const owner = rec.created_by_id as string;
        const isShaked = owner === SHAKED_USER_ID;
        console.log(`  ${gameId}: owner=${owner} ${isShaked ? '(SHAKED)' : '(OTHER USER)'}  playedAt=${new Date((rec.playedAt as number) ?? 0).toISOString()}`);
      }
    }
  } catch (err) {
    console.log(`  ${gameId}: filter error: ${(err as Error).message}`);
  }
}

// 3. Sample Shaked's last 5 imported games.
const shakedGames = await (base44.entities as any).Game.filter({ created_by_id: SHAKED_USER_ID });
const sortedShaked = (shakedGames as Array<Record<string, unknown>>)
  .sort((a, b) => ((b.playedAt as number) ?? 0) - ((a.playedAt as number) ?? 0));
console.log(`\n\nShaked's local last 5 imported games:`);
for (const r of sortedShaked.slice(0, 5)) {
  console.log(`  ${r.gameId}: playedAt=${new Date((r.playedAt as number) ?? 0).toISOString()}  url=${r.url}`);
}
