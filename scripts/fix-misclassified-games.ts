/**
 * One-shot reclassification of misclassified games.
 *
 * Criteria for a misclassified row:
 *   - timeClass === 'daily'
 *   - PGN Event header is NOT correspondence/daily
 *   - timeControl doesn't have "/" (correspondence-format)
 *   - base time + 40*increment ≤ 1800s (≤ 30 min) → should be 'rapid'
 *
 * For each, update timeClass to 'rapid'.
 *
 * Set DRY_RUN=true to preview without writing.
 */
const DRY_RUN = false;

const games = await base44.entities.Game.list();
const targets: Array<{ id: string; gameId: unknown; tc: string; owner: string; event: string }> = [];

for (const g of games as Array<Record<string, unknown>>) {
  if (g.timeClass !== 'daily') continue;
  const pgn = String(g.pgn ?? '');
  const eventMatch = pgn.match(/\[Event\s+"([^"]+)"\]/);
  const event = (eventMatch?.[1] ?? '').toLowerCase();
  const tc = String(g.timeControl ?? '');
  if (event.includes('daily') || event.includes('correspondence')) continue;
  if (tc.includes('/')) continue;
  const base = parseInt(tc.split('+')[0], 10);
  const inc = parseInt(tc.split('+')[1] ?? '0', 10) || 0;
  if (isNaN(base)) continue;
  const est = base + 40 * inc;
  if (est <= 0 || est > 1800) continue;
  targets.push({
    id: String(g.id),
    gameId: g.gameId,
    tc,
    owner: String(g.created_by_id ?? '?'),
    event: String(eventMatch?.[1] ?? '?'),
  });
}

console.log(`Found ${targets.length} misclassified games. Will reclassify to 'rapid'.${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

let updated = 0;
let failed = 0;
for (const t of targets) {
  if (DRY_RUN) { updated++; continue; }
  try {
    await base44.entities.Game.update(t.id, { timeClass: 'rapid' });
    updated++;
  } catch (err) {
    failed++;
    console.warn(`  update failed for ${t.id} (gameId=${t.gameId}): ${(err as Error).message?.slice(0, 100)}`);
  }
  if (updated % 10 === 0) console.log(`  ${updated}/${targets.length} updated`);
}

console.log(`\nResult: updated=${updated}, failed=${failed}${DRY_RUN ? ' (DRY RUN)' : ''}`);
