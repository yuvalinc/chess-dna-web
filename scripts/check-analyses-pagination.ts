/**
 * Two pitfalls suspected:
 * 1. entity.list() may cap at 5000 records — silent truncation.
 * 2. Some analyses may have a different created_by_id than the game's owner.
 *
 * Diagnose by:
 *   - Counting total Analysis rows.
 *   - Counting Dvir's analyses via gameId join (NOT by created_by_id).
 *   - Looking at created_by_id distribution.
 *   - Showing when his analyses were created.
 */
const DVIR_USER_ID = '6a020a5536d35a06a6025a3e';

const games = await base44.entities.Game.list();
const dvirGames = (games as Array<Record<string, unknown>>).filter(g =>
  String(g.created_by_id) === DVIR_USER_ID
);
console.log(`Dvir game count: ${dvirGames.length}`);
const dvirGameIds = new Set(dvirGames.map(g => String(g.id)));
const dvirGameById = new Map(dvirGames.map(g => [String(g.id), g]));

// Count analyses two ways: by created_by_id and by gameId join.
const allAnalyses = await base44.entities.Analysis.list();
console.log(`Total Analysis rows returned by list(): ${allAnalyses.length}`);

const byOwner = (allAnalyses as Array<Record<string, unknown>>).filter(a =>
  String(a.created_by_id) === DVIR_USER_ID
);
const byGameJoin = (allAnalyses as Array<Record<string, unknown>>).filter(a =>
  dvirGameIds.has(String(a.gameId))
);
console.log(`Dvir analyses by created_by_id match: ${byOwner.length}`);
console.log(`Dvir analyses by gameId→Game join:    ${byGameJoin.length}`);

// If join finds more than owner match, some analyses are stamped under a
// different user (likely created during a guest-then-auth merge).
const ownerDiff = byGameJoin.filter(a => !byOwner.includes(a));
console.log(`Analyses joined-but-not-owned: ${ownerDiff.length}`);
if (ownerDiff.length > 0) {
  const ownerCounts: Record<string, number> = {};
  for (const a of ownerDiff) {
    const k = String(a.created_by_id ?? '(none)');
    ownerCounts[k] = (ownerCounts[k] ?? 0) + 1;
  }
  console.log(`  Owner distribution of mismatched analyses:`);
  for (const [k, v] of Object.entries(ownerCounts)) console.log(`    ${k}: ${v}`);
}

// Check if Analysis list() got capped
console.log(`\nIs Analysis list possibly truncated?`);
const distinctOwners = new Set((allAnalyses as Array<Record<string, unknown>>).map(a => String(a.created_by_id ?? '')));
console.log(`  Distinct owners across all analyses: ${distinctOwners.size}`);
console.log(`  Per-owner counts (top 5):`);
const ownerTotals: Record<string, number> = {};
for (const a of allAnalyses as Array<Record<string, unknown>>) {
  const k = String(a.created_by_id ?? '');
  ownerTotals[k] = (ownerTotals[k] ?? 0) + 1;
}
const top = Object.entries(ownerTotals).sort(([, a], [, b]) => b - a).slice(0, 5);
for (const [k, v] of top) console.log(`    ${k}: ${v}`);

// Show Dvir's analyses by created_date — when were they made?
console.log(`\nDvir's analyses (by created_date, newest first):`);
const sorted = [...byGameJoin].sort((a, b) =>
  String(b.created_date).localeCompare(String(a.created_date))
);
for (const a of sorted.slice(0, 15)) {
  const game = dvirGameById.get(String(a.gameId));
  const playedAt = (game?.playedAt as number) ?? 0;
  const playedAtIL = playedAt ? new Date(playedAt + 3 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') : '?';
  const createdRaw = String(a.created_date ?? '').replace(/0+$/, '');
  // Treat created_date as UTC explicitly
  const createdMs = new Date(createdRaw + 'Z').getTime();
  const createdIL = isNaN(createdMs) ? '?' : new Date(createdMs + 3 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  console.log(`  gameId=${a.gameId} | game.played(IL)=${playedAtIL} | analysis.created(IL)=${createdIL} | owner=${a.created_by_id}`);
}

// Time-based bucketing: how many of his analyses were created in last hour, 6h, 24h?
const now = Date.now();
const h = 3600_000;
const created1h = byGameJoin.filter(a => now - new Date(String(a.created_date) + 'Z').getTime() < 1 * h).length;
const created6h = byGameJoin.filter(a => now - new Date(String(a.created_date) + 'Z').getTime() < 6 * h).length;
const created24h = byGameJoin.filter(a => now - new Date(String(a.created_date) + 'Z').getTime() < 24 * h).length;
console.log(`\nDvir analyses created in last:`);
console.log(`  1h:  ${created1h}`);
console.log(`  6h:  ${created6h}`);
console.log(`  24h: ${created24h}`);
