/**
 * The 5000-cap on list() may be hiding analyses. Query Dvir's analyses
 * directly via entity.filter({ created_by_id }) — that's a server-side
 * filter and shouldn't share the 5000-cap.
 *
 * Compare to what list() returns.
 */
const DVIR_USER_ID = '6a020a5536d35a06a6025a3e';

// 1. list() — capped
const listed = await base44.entities.Analysis.list();
const fromList = (listed as Array<Record<string, unknown>>).filter(a =>
  String(a.created_by_id) === DVIR_USER_ID
);
console.log(`Via list(): ${listed.length} total returned, ${fromList.length} owned by Dvir.`);

// 2. filter() — server-side filter
let filtered: Array<Record<string, unknown>> = [];
try {
  const result = await (base44.entities as any).Analysis.filter({ created_by_id: DVIR_USER_ID });
  filtered = Array.isArray(result) ? result : [];
  console.log(`Via filter({created_by_id}): ${filtered.length} owned by Dvir.`);
} catch (err) {
  console.log(`filter() failed: ${(err as Error).message}`);
}

// 3. Per-game lookup — for each Dvir game, ask if an analysis exists
const games = await base44.entities.Game.list();
const dvirGames = (games as Array<Record<string, unknown>>).filter(g =>
  String(g.created_by_id) === DVIR_USER_ID
);
console.log(`Dvir's games: ${dvirGames.length}`);

const dvirGameIds = dvirGames.map(g => String(g.id));
let perGameCount = 0;
const missingAnalysis: string[] = [];
for (const gid of dvirGameIds.slice(0, 30)) { // sample 30 to avoid hammering
  try {
    const a = await (base44.entities as any).Analysis.filter({ gameId: gid });
    if (Array.isArray(a) && a.length > 0) perGameCount++;
    else missingAnalysis.push(gid);
  } catch {
    /* skip */
  }
}
console.log(`Per-gameId lookup (first 30 of his games): ${perGameCount} have an Analysis row.`);
console.log(`  Missing (still pending): ${missingAnalysis.length}`);

// 4. Compare ownership counts: how many distinct owners are in list() vs total?
const allOwnersInList = new Set((listed as Array<Record<string, unknown>>).map(a => String(a.created_by_id)));
const perOwnerInList: Record<string, number> = {};
for (const a of listed as Array<Record<string, unknown>>) {
  const k = String(a.created_by_id);
  perOwnerInList[k] = (perOwnerInList[k] ?? 0) + 1;
}
console.log(`\nDistinct owners in capped list: ${allOwnersInList.size}`);
const top = Object.entries(perOwnerInList).sort(([, a], [, b]) => b - a).slice(0, 10);
console.log(`Top 10 owners in the 5000 cap:`);
for (const [k, v] of top) console.log(`  ${k}: ${v}`);

console.log(`\nIs Dvir capped? Compare: list=${fromList.length} vs filter=${filtered.length}`);
if (filtered.length > fromList.length) {
  console.log(`  YES — filter() returns more. The UI's list() call is hiding ${filtered.length - fromList.length} of Dvir's analyses.`);
} else if (filtered.length === fromList.length) {
  console.log(`  NO — both return the same count. The 12 is the true number.`);
}
