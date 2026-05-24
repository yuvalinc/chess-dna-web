/**
 * Examine Dvir's Pattern row to see if its data implies MORE than 12 games
 * were analyzed at the time it was last updated. If so, some Analysis rows
 * may have been deleted.
 *
 * Also: look at all 12 Analysis rows' created_date to spot a gap that would
 * indicate deletions.
 */
const DVIR_USER_ID = '6a020a5536d35a06a6025a3e';

// 1. The Pattern row in full
const patterns = await base44.entities.Pattern.list();
const dvirPattern = (patterns as Array<Record<string, unknown>>).find(p =>
  String(p.created_by_id) === DVIR_USER_ID
);
if (!dvirPattern) {
  console.log('Dvir has no Pattern row.');
} else {
  console.log('=== Dvir Pattern row ===');
  console.log(`id: ${dvirPattern.id}`);
  console.log(`created_date: ${dvirPattern.created_date}`);
  console.log(`updated_date: ${dvirPattern.updated_date}`);
  console.log(`All keys: ${Object.keys(dvirPattern).join(', ')}`);
  for (const k of Object.keys(dvirPattern)) {
    if (k === 'patterns') continue;
    const v = (dvirPattern as any)[k];
    if (typeof v === 'object' && v !== null) {
      console.log(`  ${k}: ${JSON.stringify(v).slice(0, 200)}`);
    } else {
      console.log(`  ${k}: ${v}`);
    }
  }
  // patterns array dump (each entry may be a JSON string)
  const arr = (dvirPattern as any).patterns;
  if (Array.isArray(arr)) {
    console.log(`\npatterns[] (${arr.length} entries):`);
    for (const entry of arr) {
      const s = typeof entry === 'string' ? entry : JSON.stringify(entry);
      console.log(`  ${s.slice(0, 250)}`);
    }
  }
}

// 2. Dvir's 12 analyses created_date timeline
const allAnalyses = await base44.entities.Analysis.list();
const dvirAnalyses = (allAnalyses as Array<Record<string, unknown>>).filter(a =>
  String(a.created_by_id) === DVIR_USER_ID
);
console.log(`\n=== Dvir Analysis created_date timeline (${dvirAnalyses.length} rows) ===`);
const sorted = [...dvirAnalyses].sort((a, b) =>
  String(a.created_date).localeCompare(String(b.created_date))
);
for (const a of sorted) {
  console.log(`  ${a.created_date}  ${a.id}`);
}
