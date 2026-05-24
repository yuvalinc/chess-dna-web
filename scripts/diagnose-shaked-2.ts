/**
 * v2 deep-dive on Shaked:
 * - When was their UserPreferences last updated?
 * - When was their last imported Game created?
 * - Compare to chess.com timestamps to understand the activity timeline.
 *
 * Also: list ALL active users (chesscom set) who haven't synced in the last
 *  6h despite having games on chess.com in the last 6h. That tells us how
 *  widespread the sync gap really is.
 */
const SHAKED_USER_IDS = [
  '6a0235684d7ee2d5d44dcbe0',
  '6a020a6957da2f8b624b12ff',
];

const prefs = await base44.entities.UserPreferences.list();
console.log('=== Shaked preference records ===');
for (const p of prefs as Array<Record<string, unknown>>) {
  if (!SHAKED_USER_IDS.includes(String(p.created_by_id))) continue;
  console.log(`  pref.id=${p.id}, created_by_id=${p.created_by_id}`);
  console.log(`    chesscomUsername=${p.chesscomUsername}`);
  console.log(`    created_date=${p.created_date}`);
  console.log(`    updated_date=${p.updated_date}`);
  console.log(`    radarRevealedAt=${p.radarRevealedAt ? new Date(p.radarRevealedAt as number).toISOString() : 'null'}`);
  console.log(`    language=${p.language}`);
}

// Their last game create timestamps.
console.log('\n=== Shaked recent Game creates (by created_date) ===');
const games = await base44.entities.Game.list();
const shakedGames = (games as Array<Record<string, unknown>>)
  .filter(g => SHAKED_USER_IDS.includes(String(g.created_by_id)))
  .sort((a, b) => String(b.created_date).localeCompare(String(a.created_date)))
  .slice(0, 10);

for (const g of shakedGames) {
  console.log(`  game.id=${g.id}`);
  console.log(`    gameId=${g.gameId}, owner=${g.created_by_id}`);
  console.log(`    created_date (DB insert)=${g.created_date}`);
  console.log(`    playedAt (game time)=${new Date((g.playedAt as number) ?? 0).toISOString()}`);
}

// Wide check: how many of the 86 "active" users have synced in the last 6h?
console.log('\n=== Sync gap across all 86 users with chesscomUsername ===');
const usersWithCc = (prefs as Array<Record<string, unknown>>).filter(p =>
  typeof p.chesscomUsername === 'string' && p.chesscomUsername
);

// Bucket: when was each user's LAST sync (= most recent Game.created_date)?
const byOwner: Record<string, number> = {};
for (const g of games as Array<Record<string, unknown>>) {
  const id = String(g.created_by_id ?? '');
  const ms = new Date(String(g.created_date)).getTime();
  if (!byOwner[id] || ms > byOwner[id]) byOwner[id] = ms;
}

const now = Date.now();
const buckets = { '< 1h': 0, '1-6h': 0, '6-24h': 0, '1-7d': 0, '> 7d': 0, 'never': 0 };
const stale6hPlus: Array<{ id: string; cc: string; hours: number }> = [];
for (const p of usersWithCc) {
  const id = String(p.created_by_id);
  const last = byOwner[id];
  if (!last) { buckets['never']++; continue; }
  const ageMs = now - last;
  const h = ageMs / 3600_000;
  if (h < 1) buckets['< 1h']++;
  else if (h < 6) buckets['1-6h']++;
  else if (h < 24) {
    buckets['6-24h']++;
    stale6hPlus.push({ id, cc: String(p.chesscomUsername), hours: Math.round(h) });
  }
  else if (h < 168) {
    buckets['1-7d']++;
    stale6hPlus.push({ id, cc: String(p.chesscomUsername), hours: Math.round(h) });
  }
  else {
    buckets['> 7d']++;
  }
}
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k} since last sync (Game create): ${v}`);

console.log('\n=== Users with 6h+ sync gap (top 15) ===');
stale6hPlus.sort((a, b) => a.hours - b.hours);
for (const u of stale6hPlus.slice(0, 15)) {
  console.log(`  ${u.cc} (${u.id}): ${u.hours}h ago`);
}
