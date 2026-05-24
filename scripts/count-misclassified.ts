/**
 * Count games globally where:
 *   - timeClass === 'daily' (our classification)
 *   - BUT the PGN Event header indicates a Live Chess game (not correspondence)
 *   - AND timeControl base is <= 1800s
 *
 * These are misclassifications. The fix should reclassify them to 'rapid'.
 */
const games = await base44.entities.Game.list();

let misclassifiedRapid = 0; // should be 'rapid'
let trulyDaily = 0;          // correctly 'daily' (correspondence)
const byOwner: Record<string, number> = {};

for (const g of games as Array<Record<string, unknown>>) {
  if (g.timeClass !== 'daily') continue;
  const pgn = String(g.pgn ?? '');
  const eventMatch = pgn.match(/\[Event\s+"([^"]+)"\]/);
  const event = (eventMatch?.[1] ?? '').toLowerCase();
  const tc = String(g.timeControl ?? '');
  // Parse base time
  const base = parseInt(tc.split('+')[0], 10);
  const inc = parseInt(tc.split('+')[1] ?? '0', 10) || 0;
  const est = (isNaN(base) ? 0 : base) + 40 * inc;

  const isCorrespondence = event.includes('daily') || event.includes('correspondence') || tc.includes('/');
  if (isCorrespondence) {
    trulyDaily++;
  } else if (est > 0 && est <= 1800) {
    misclassifiedRapid++;
    const owner = String(g.created_by_id ?? '?');
    byOwner[owner] = (byOwner[owner] ?? 0) + 1;
  }
}

console.log(`Total games: ${games.length}`);
console.log(`timeClass='daily' AND Event=Live Chess AND ≤ 1800s (misclassified as daily): ${misclassifiedRapid}`);
console.log(`timeClass='daily' truly correspondence: ${trulyDaily}`);
console.log(`\nMisclassified per owner (top 10):`);
const top = Object.entries(byOwner).sort(([, a], [, b]) => b - a).slice(0, 10);
for (const [k, v] of top) console.log(`  ${k}: ${v}`);
