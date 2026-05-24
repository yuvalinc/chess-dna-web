/**
 * One-shot cleanup of duplicate singleton entity rows.
 *
 * For UserPreferences and Pattern, every user is supposed to have at most
 * one row. Today many users have several (Dvir has 5 UserPreferences rows;
 * one anonymous owner has 240). This script:
 *   - Groups rows by `created_by_id`.
 *   - For each owner with >1 row, keeps the most-recently-updated row.
 *   - Deletes the rest.
 *
 * Anonymous-stamped rows (owner === 'anonymous') are NOT consolidated to a
 * single row — those came from many different real users hitting an
 * auth-attachment race. They're all orphans and would never be recovered
 * anyway, so we just delete ALL of them.
 *
 * Set DRY_RUN=true in the env to preview without deleting.
 *
 * Run with: `cat scripts/cleanup-duplicate-singletons.ts | npx base44 exec`
 */
const DRY_RUN = false; // flip to preview

interface Row {
  id: string;
  created_by_id?: string;
  created_date?: string;
  updated_date?: string;
  [k: string]: unknown;
}

async function cleanup(entityName: string): Promise<void> {
  const ent = (base44.entities as any)[entityName];
  if (!ent) {
    console.log(`\n=== ${entityName}: entity not found, skipping ===`);
    return;
  }
  const list = (await ent.list()) as Row[];
  if (!Array.isArray(list)) return;
  console.log(`\n=== ${entityName}: ${list.length} rows ===`);

  // Group by owner
  const byOwner: Record<string, Row[]> = {};
  for (const r of list) {
    const owner = String(r.created_by_id ?? '(none)');
    if (!byOwner[owner]) byOwner[owner] = [];
    byOwner[owner].push(r);
  }

  let kept = 0;
  let deleted = 0;
  let failed = 0;

  for (const [owner, rows] of Object.entries(byOwner)) {
    if (rows.length <= 1) {
      kept += rows.length;
      continue;
    }
    if (owner === 'anonymous') {
      // Anonymous orphans: delete ALL. These can't be reclaimed by any user.
      console.log(`  ${owner}: ${rows.length} orphan rows → delete all`);
      for (const r of rows) {
        if (DRY_RUN) { deleted++; continue; }
        try {
          await ent.delete(r.id);
          deleted++;
        } catch (err) {
          failed++;
          console.warn(`    delete failed for ${r.id}: ${(err as Error).message}`);
        }
      }
      continue;
    }

    // Real owner: keep the most-recently-updated row, delete the rest.
    const sorted = [...rows].sort((a, b) =>
      String(b.updated_date ?? '').localeCompare(String(a.updated_date ?? ''))
    );
    const keep = sorted[0];
    const dupes = sorted.slice(1);
    console.log(`  ${owner}: ${rows.length} rows → keep ${keep.id} (updated ${keep.updated_date}), delete ${dupes.length}`);
    kept++;
    for (const r of dupes) {
      if (DRY_RUN) { deleted++; continue; }
      try {
        await ent.delete(r.id);
        deleted++;
      } catch (err) {
        failed++;
        console.warn(`    delete failed for ${r.id}: ${(err as Error).message}`);
      }
    }
  }

  console.log(`  ${entityName} summary: kept=${kept}, deleted=${deleted}, failed=${failed}${DRY_RUN ? ' (DRY RUN)' : ''}`);
}

for (const entity of ['UserPreferences', 'Pattern']) {
  await cleanup(entity);
}
console.log('\nDone.');
