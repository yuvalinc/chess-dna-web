/**
 * Per-gameId Analysis.filter() to get Dvir's TRUE count — bypasses the
 * 5000-record cap on list(). Batched to avoid rate limits.
 */
const DVIR_USER_ID = '6a020a5536d35a06a6025a3e';

const games = await base44.entities.Game.list();
const dvirGames = (games as Array<Record<string, unknown>>).filter(g =>
  String(g.created_by_id) === DVIR_USER_ID
);
console.log(`Dvir has ${dvirGames.length} games.`);

// For each game, check if Analysis exists.
let withAnalysis = 0;
let withoutAnalysis = 0;
let errors = 0;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

for (let i = 0; i < dvirGames.length; i++) {
  const gid = String(dvirGames[i].id);
  try {
    const r = await (base44.entities as any).Analysis.filter({ gameId: gid });
    if (Array.isArray(r) && r.length > 0) withAnalysis++;
    else withoutAnalysis++;
  } catch (err) {
    errors++;
    if (errors <= 3) console.warn(`  err on ${gid}: ${(err as Error).message?.slice(0, 80)}`);
  }
  // Throttle every 10 to dodge rate limit
  if ((i + 1) % 10 === 0) {
    console.log(`  ${i + 1}/${dvirGames.length} checked — analyzed so far: ${withAnalysis}`);
    await sleep(500);
  }
}

console.log(`\n=== Dvir true count ===`);
console.log(`  Games:              ${dvirGames.length}`);
console.log(`  With Analysis row:  ${withAnalysis}`);
console.log(`  Without:            ${withoutAnalysis}`);
console.log(`  Errors:             ${errors}`);
console.log(`\nFor comparison: list() returned 12 of his analyses (capped at 5000 total).`);
console.log(`If withAnalysis > 12, the UI is undercounting due to the cap.`);
