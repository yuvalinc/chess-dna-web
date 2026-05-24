/**
 * Does Base44 actually persist `lastSyncAt` despite it not being in the schema?
 */
const prefs = await base44.entities.UserPreferences.list();
let withLastSync = 0;
let withoutLastSync = 0;
const samples: Array<{ id: string; cc: string; lastSyncAt: unknown; updated: string }> = [];

for (const p of prefs as Array<Record<string, unknown>>) {
  if ('lastSyncAt' in p && p.lastSyncAt != null) {
    withLastSync++;
    if (samples.length < 5) {
      samples.push({
        id: String(p.id),
        cc: String(p.chesscomUsername ?? ''),
        lastSyncAt: p.lastSyncAt,
        updated: String(p.updated_date),
      });
    }
  } else {
    withoutLastSync++;
  }
}

console.log(`UserPreferences with lastSyncAt: ${withLastSync}`);
console.log(`UserPreferences without lastSyncAt: ${withoutLastSync}`);

console.log('\nSamples (with lastSyncAt):');
for (const s of samples) {
  const iso = typeof s.lastSyncAt === 'number' ? new Date(s.lastSyncAt).toISOString() : '(non-number)';
  console.log(`  ${s.cc}: lastSyncAt=${iso}, updated=${s.updated}`);
}

// Also check Shaked specifically
console.log('\n=== Shaked records — all fields starting with "last" ===');
const shaked = (prefs as Array<Record<string, unknown>>).filter(p =>
  String(p.chesscomUsername ?? '').toLowerCase() === 'shaked2219'
);
for (const p of shaked) {
  const lastFields = Object.entries(p).filter(([k]) => k.toLowerCase().startsWith('last') || k.toLowerCase().includes('sync'));
  console.log(`  pref.id=${p.id} created_by_id=${p.created_by_id}`);
  for (const [k, v] of lastFields) {
    const iso = typeof v === 'number' ? new Date(v).toISOString() : JSON.stringify(v);
    console.log(`    ${k} = ${iso}`);
  }
  // Also show onboardingGameIds, onboardingTimeClass
  for (const k of ['onboardingGameIds', 'onboardingTimeClass', 'bulkImportDone']) {
    if (k in p) console.log(`    ${k} = ${JSON.stringify(p[k])}`);
  }
}
