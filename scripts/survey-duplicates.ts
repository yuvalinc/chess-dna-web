/**
 * Survey duplicate-row problem across singleton entities.
 * Reports per-entity:
 *   - total rows
 *   - distinct created_by_id values
 *   - users with >1 row, and how many duplicates
 *   - sample diff between duplicates (do they have different settings?)
 */

const singletonEntities = ['UserPreferences', 'Pattern', 'TrainingPlan'];

for (const entityName of singletonEntities) {
  const ent = (base44.entities as any)[entityName];
  if (!ent) {
    console.log(`\n--- ${entityName}: entity not found ---`);
    continue;
  }
  const list = await ent.list();
  if (!Array.isArray(list)) {
    console.log(`\n--- ${entityName}: list not an array ---`);
    continue;
  }
  console.log(`\n=== ${entityName}: ${list.length} total rows ===`);

  const byOwner: Record<string, Array<Record<string, unknown>>> = {};
  for (const r of list as Array<Record<string, unknown>>) {
    const owner = String(r.created_by_id ?? '(none)');
    if (!byOwner[owner]) byOwner[owner] = [];
    byOwner[owner].push(r);
  }
  const owners = Object.keys(byOwner);
  console.log(`  Distinct created_by_id: ${owners.length}`);
  const dupOwners = owners.filter(o => byOwner[o].length > 1);
  console.log(`  Owners with >1 row: ${dupOwners.length}`);
  const totalExtra = dupOwners.reduce((s, o) => s + byOwner[o].length - 1, 0);
  console.log(`  Excess rows (could be deleted): ${totalExtra}`);

  // Distribution
  const distrib: Record<string, number> = {};
  for (const o of owners) {
    const n = byOwner[o].length;
    distrib[n] = (distrib[n] ?? 0) + 1;
  }
  const keys = Object.keys(distrib).map(Number).sort((a, b) => a - b);
  console.log('  Rows-per-owner distribution:');
  for (const k of keys) console.log(`    ${k} row(s): ${distrib[k]} owner(s)`);

  // Sample worst offenders
  const sortedDup = dupOwners.sort((a, b) => byOwner[b].length - byOwner[a].length).slice(0, 3);
  for (const o of sortedDup) {
    console.log(`\n  --- Sample owner ${o} (${byOwner[o].length} rows) ---`);
    for (const r of byOwner[o].sort((a, b) => String(a.created_date).localeCompare(String(b.created_date)))) {
      const summary = entityName === 'UserPreferences'
        ? `cc=${r.chesscomUsername ?? 'null'}, lang=${r.language}, radarRevealed=${r.radarRevealedAt ? new Date(r.radarRevealedAt as number).toISOString() : 'null'}`
        : entityName === 'Pattern'
          ? `patternsCount=${Array.isArray(r.patterns) ? (r.patterns as unknown[]).length : '?'}, version=${r.version}`
          : `id=${r.id}`;
      console.log(`    ${r.id}: created=${r.created_date}, updated=${r.updated_date}, ${summary}`);
    }
  }
}
