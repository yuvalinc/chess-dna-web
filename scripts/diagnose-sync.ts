/**
 * Diagnose sync state across users.
 * - Find Shaked Ohana specifically.
 * - For all users with a chesscomUsername, count games + show newest playedAt.
 * - Compare newest local playedAt vs newest chess.com archive playedAt.
 *
 * Run with: `cat scripts/diagnose-sync.ts | npx base44 exec`
 */
const prefs = await base44.entities.UserPreferences.list();
const games = await base44.entities.Game.list();

console.log(`Total UserPreferences: ${prefs.length}`);
console.log(`Total Games: ${games.length}\n`);

// Bucket games by created_by email
const gamesByUser: Record<string, Array<{ playedAt: number; gameId?: string; url?: string }>> = {};
for (const g of games as Array<Record<string, unknown>>) {
  const email = (g.created_by as string) || '(none)';
  if (!gamesByUser[email]) gamesByUser[email] = [];
  gamesByUser[email].push({
    playedAt: typeof g.playedAt === 'number' ? g.playedAt : 0,
    gameId: g.gameId as string,
    url: g.url as string,
  });
}

// Search for Shaked
const shakedPrefs = (prefs as Array<Record<string, unknown>>).filter(p => {
  const email = String(p.created_by ?? '').toLowerCase();
  const cc = String(p.chesscomUsername ?? '').toLowerCase();
  const lc = String(p.lichessUsername ?? '').toLowerCase();
  return email.includes('shaked') || email.includes('ohana')
    || cc.includes('shaked') || cc.includes('ohana')
    || lc.includes('shaked') || lc.includes('ohana');
});

console.log(`\n=== Shaked candidates (${shakedPrefs.length}) ===`);
for (const p of shakedPrefs) {
  const email = String(p.created_by ?? '');
  const cc = String(p.chesscomUsername ?? '');
  const lc = String(p.lichessUsername ?? '');
  const userGames = gamesByUser[email] ?? [];
  const sorted = [...userGames].sort((a, b) => b.playedAt - a.playedAt);
  const newest = sorted[0];
  console.log(`  email=${email}`);
  console.log(`    chesscomUsername=${cc || '(none)'}`);
  console.log(`    lichessUsername=${lc || '(none)'}`);
  console.log(`    radarRevealedAt=${p.radarRevealedAt ? new Date(p.radarRevealedAt as number).toISOString() : 'null'}`);
  console.log(`    games stored=${userGames.length}`);
  if (newest) {
    console.log(`    newest game playedAt=${new Date(newest.playedAt).toISOString()}`);
    console.log(`    newest game url=${newest.url}`);
  }
  // Also fetch chess.com archive to compare
  if (cc) {
    try {
      const archivesRes = await fetch(`https://api.chess.com/pub/player/${cc.toLowerCase()}/games/archives`);
      const { archives } = await archivesRes.json() as { archives: string[] };
      const lastArchive = archives[archives.length - 1];
      const monthRes = await fetch(lastArchive);
      const { games: monthGames } = await monthRes.json() as { games: Array<{ end_time: number; url: string }> };
      const ccNewest = monthGames[monthGames.length - 1];
      if (ccNewest) {
        console.log(`    chess.com newest game (end_time)=${new Date(ccNewest.end_time * 1000).toISOString()}`);
        console.log(`    chess.com newest url=${ccNewest.url}`);
        const gap = newest ? ccNewest.end_time * 1000 - newest.playedAt : null;
        if (gap != null) {
          const hours = Math.round(gap / 3600000);
          console.log(`    GAP: chess.com is ${hours}h ahead of local`);
        }
      }
    } catch (e) {
      console.log(`    chess.com fetch failed:`, (e as Error).message);
    }
  }
  console.log();
}

// Top-level summary across all users with chess.com usernames
console.log('\n=== All users with chesscomUsername — recency snapshot ===');
const usersWithCc = (prefs as Array<Record<string, unknown>>).filter(p =>
  typeof p.chesscomUsername === 'string' && p.chesscomUsername
);
console.log(`Count: ${usersWithCc.length}\n`);

const buckets = {
  'no games': 0,
  '< 1 day stale': 0,
  '1-7 days stale': 0,
  '7-30 days stale': 0,
  '> 30 days stale': 0,
};
const now = Date.now();

for (const p of usersWithCc) {
  const email = String(p.created_by ?? '');
  const userGames = gamesByUser[email] ?? [];
  if (userGames.length === 0) { buckets['no games']++; continue; }
  const newest = userGames.reduce((m, g) => g.playedAt > m ? g.playedAt : m, 0);
  const stale = now - newest;
  const day = 86400_000;
  if (stale < day) buckets['< 1 day stale']++;
  else if (stale < 7 * day) buckets['1-7 days stale']++;
  else if (stale < 30 * day) buckets['7-30 days stale']++;
  else buckets['> 30 days stale']++;
}

for (const [k, v] of Object.entries(buckets)) {
  console.log(`  ${k}: ${v}`);
}
