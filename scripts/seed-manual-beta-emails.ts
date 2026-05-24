/**
 * One-shot push of MANUAL_BETA_EMAILS into the BetaTester entity.
 * Run via `cat scripts/seed-manual-beta-emails.ts | npx base44 exec` —
 * the SDK is pre-authenticated as the admin so it passes RLS.
 *
 * Idempotent — emails already in BetaTester are skipped.
 *
 * Note: source of truth for access is the in-code MANUAL_BETA_EMAILS list
 * (gates via `isWhitelistedEmail`). This script only mirrors it into the
 * Base44 BetaTester table for admin/analytics visibility.
 */
const MANUAL_BETA_EMAILS = [
  'bargoldshmidt@gmail.com',
  'ereztsiton@gmail.com',
  'tanton8787@gmail.com',
];

let created = 0, skipped = 0;
const errors: string[] = [];

for (const raw of MANUAL_BETA_EMAILS) {
  const email = raw.toLowerCase();
  try {
    const existing = await base44.entities.BetaTester.filter({ email });
    if (Array.isArray(existing) && existing.length > 0) {
      skipped++;
      console.log(`skip   ${email}`);
      continue;
    }
    await base44.entities.BetaTester.create({
      email,
      fullName: email,
      platforms: [],
      preferredStage: 'manual',
    });
    created++;
    console.log(`create ${email}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`${email}: ${msg}`);
    console.error(`error  ${email}: ${msg}`);
  }
}

console.log(`\nDone — total ${MANUAL_BETA_EMAILS.length} · created ${created} · skipped ${skipped} · errors ${errors.length}`);
if (errors.length > 0) {
  console.log('\nErrors:');
  errors.forEach(e => console.log('  ' + e));
}
