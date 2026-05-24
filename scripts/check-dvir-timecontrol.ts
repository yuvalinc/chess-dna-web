/**
 * Dvir says he plays 30-minute games. Our classifier says they're "daily".
 * Check actual timeControl strings and compare to chess.com's own time_class
 * (which is in the PGN's Event header for chess.com games).
 */
const DVIR_USER_ID = '6a020a5536d35a06a6025a3e';

const games = await base44.entities.Game.list();
const dvirGames = (games as Array<Record<string, unknown>>).filter(g =>
  String(g.created_by_id) === DVIR_USER_ID
);

const sorted = [...dvirGames].sort((a, b) =>
  ((b.playedAt as number) ?? 0) - ((a.playedAt as number) ?? 0)
);

console.log(`Dvir's last 10 games — full time info:\n`);
console.log('  date (IL)          | timeClass | timeControl     | Event header from PGN');
for (const g of sorted.slice(0, 10)) {
  const playedAtIL = new Date(((g.playedAt as number) ?? 0) + 3 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  const tc = String(g.timeClass ?? '?').padEnd(9);
  const tCtrl = String(g.timeControl ?? '?').padEnd(15);
  const pgn = String(g.pgn ?? '');
  const eventMatch = pgn.match(/\[Event\s+"([^"]+)"\]/);
  const event = eventMatch ? eventMatch[1] : '?';
  console.log(`  ${playedAtIL} | ${tc} | ${tCtrl} | ${event}`);
}

// Also pull from chess.com directly to see what they classify
console.log('\n--- Cross-check with chess.com API time_class field ---\n');
try {
  const archivesRes = await fetch('https://api.chess.com/pub/player/dvirs12/games/archives');
  const { archives } = await archivesRes.json() as { archives: string[] };
  const lastArchive = archives[archives.length - 1];
  const monthRes = await fetch(lastArchive);
  const { games: monthGames } = await monthRes.json() as { games: Array<{ end_time: number; url: string; time_class: string; time_control: string }> };
  const latest = monthGames.slice(-10);
  console.log('  end_time (IL)      | time_class (cc) | time_control | url');
  for (const g of latest) {
    const endIL = new Date(g.end_time * 1000 + 3 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
    console.log(`  ${endIL} | ${String(g.time_class).padEnd(13)} | ${String(g.time_control).padEnd(12)} | ${g.url}`);
  }
} catch (err) {
  console.log(`chess.com fetch failed: ${(err as Error).message}`);
}
