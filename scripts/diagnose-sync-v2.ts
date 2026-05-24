/**
 * v2: investigate why games count = 0 for everyone. The first script keyed
 * by `created_by` (email), but Base44 may use `created_by_id` (UUID).
 */
const prefs = await base44.entities.UserPreferences.list();
const games = await base44.entities.Game.list();

console.log(`UserPreferences: ${prefs.length}, Games: ${games.length}\n`);

// Sample 1 game and 1 pref to see what identification fields exist
const sampleGame = games[0] as Record<string, unknown> | undefined;
const samplePref = prefs[0] as Record<string, unknown> | undefined;
console.log('--- Sample Game keys ---');
console.log(sampleGame ? Object.keys(sampleGame).join(', ') : 'no games');
console.log('  created_by:', JSON.stringify(sampleGame?.created_by));
console.log('  created_by_id:', JSON.stringify(sampleGame?.created_by_id));
console.log('  playedAt:', new Date((sampleGame?.playedAt as number) ?? 0).toISOString());

console.log('\n--- Sample Pref keys ---');
console.log(samplePref ? Object.keys(samplePref).join(', ') : 'no prefs');
console.log('  created_by:', JSON.stringify(samplePref?.created_by));
console.log('  created_by_id:', JSON.stringify(samplePref?.created_by_id));

// Now bucket games by created_by_id
const gamesByUserId: Record<string, Array<{ playedAt: number; url?: string }>> = {};
for (const g of games as Array<Record<string, unknown>>) {
  const id = (g.created_by_id as string) ?? '(none)';
  if (!gamesByUserId[id]) gamesByUserId[id] = [];
  gamesByUserId[id].push({
    playedAt: typeof g.playedAt === 'number' ? g.playedAt : 0,
    url: g.url as string,
  });
}

// How many distinct user_ids own games?
console.log(`\nDistinct created_by_id buckets in Game: ${Object.keys(gamesByUserId).length}`);
// Top 5 owners
const topOwners = Object.entries(gamesByUserId)
  .sort(([, a], [, b]) => b.length - a.length)
  .slice(0, 5);
console.log('Top 5 owners by game count:');
for (const [id, gs] of topOwners) {
  console.log(`  ${id}: ${gs.length} games`);
}

// Anonymous orphans?
const anonCount = gamesByUserId['anonymous']?.length ?? 0;
const noneCount = gamesByUserId['(none)']?.length ?? 0;
console.log(`\nAnonymous-stamped games: ${anonCount}`);
console.log(`No created_by_id at all: ${noneCount}`);

// Find shaked
const shakedPrefs = (prefs as Array<Record<string, unknown>>).filter(p => {
  const cc = String(p.chesscomUsername ?? '').toLowerCase();
  return cc.includes('shaked') || cc.includes('ohana');
});

console.log(`\n=== Shaked (${shakedPrefs.length} preferences) ===`);
for (const p of shakedPrefs) {
  const id = String(p.created_by_id ?? '');
  const cc = String(p.chesscomUsername ?? '');
  const userGames = gamesByUserId[id] ?? [];
  const sorted = [...userGames].sort((a, b) => b.playedAt - a.playedAt);
  console.log(`  pref.id=${p.id}, created_by_id=${id}, chesscom=${cc}, radarRevealedAt=${p.radarRevealedAt ? new Date(p.radarRevealedAt as number).toISOString() : 'null'}`);
  console.log(`    games owned by this user_id: ${userGames.length}`);
  if (sorted[0]) console.log(`    newest local playedAt: ${new Date(sorted[0].playedAt).toISOString()}`);
}

// Recency snapshot — by user_id this time
const usersWithCc = (prefs as Array<Record<string, unknown>>).filter(p =>
  typeof p.chesscomUsername === 'string' && p.chesscomUsername
);
console.log(`\n=== ${usersWithCc.length} users with chesscomUsername — recency by created_by_id ===`);
const buckets = { 'no games': 0, '< 1 day': 0, '1-7 days': 0, '7-30 days': 0, '> 30 days': 0 };
const now = Date.now();
for (const p of usersWithCc) {
  const id = String(p.created_by_id ?? '');
  const userGames = gamesByUserId[id] ?? [];
  if (userGames.length === 0) { buckets['no games']++; continue; }
  const newest = userGames.reduce((m, g) => g.playedAt > m ? g.playedAt : m, 0);
  const stale = now - newest;
  const day = 86400_000;
  if (stale < day) buckets['< 1 day']++;
  else if (stale < 7 * day) buckets['1-7 days']++;
  else if (stale < 30 * day) buckets['7-30 days']++;
  else buckets['> 30 days']++;
}
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}: ${v}`);
