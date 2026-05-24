/**
 * Lists every email that has signed in / used the app, by unioning the
 * `created_by` field across UserPreferences and Game records.
 *
 * Used to seed the LEGACY_USERS_EMAILS list so we don't lock out anyone
 * who signed up before the closed-beta gate was deployed.
 *
 * Run with: `cat scripts/list-existing-users.ts | npx base44 exec`
 */
const emails = new Set<string>();

const prefs = await base44.entities.UserPreferences.list();
for (const p of prefs) {
  const email = (p as Record<string, unknown>).created_by;
  if (typeof email === 'string' && email.includes('@')) {
    emails.add(email.toLowerCase());
  }
}
console.log(`UserPreferences rows: ${prefs.length} → ${emails.size} unique emails so far`);

const games = await base44.entities.Game.list();
const beforeGames = emails.size;
for (const g of games) {
  const email = (g as Record<string, unknown>).created_by;
  if (typeof email === 'string' && email.includes('@')) {
    emails.add(email.toLowerCase());
  }
}
console.log(`Game rows: ${games.length} → +${emails.size - beforeGames} new emails from games`);

console.log(`\nTotal unique emails: ${emails.size}`);
console.log('\n--- LEGACY_USERS_EMAILS list (paste into beta-testers.ts) ---');
for (const e of [...emails].sort()) {
  console.log(`  '${e}',`);
}
