/**
 * Minimal version: just call filter({created_by_id}) and compare to list().
 */
const DVIR_USER_ID = '6a020a5536d35a06a6025a3e';

const listed = await base44.entities.Analysis.list();
const fromList = (listed as Array<Record<string, unknown>>).filter(a =>
  String(a.created_by_id) === DVIR_USER_ID
);
console.log(`Via list(): ${listed.length} total, ${fromList.length} for Dvir.`);

let filtered: Array<Record<string, unknown>> = [];
try {
  const result = await (base44.entities as any).Analysis.filter({ created_by_id: DVIR_USER_ID });
  filtered = Array.isArray(result) ? result : [];
  console.log(`Via filter({created_by_id=Dvir}): ${filtered.length}`);
} catch (err) {
  console.log(`filter failed: ${(err as Error).message?.slice(0, 200)}`);
}

console.log(`\nConclusion:`);
if (filtered.length > fromList.length) {
  console.log(`  The UI list() is hiding ${filtered.length - fromList.length} of Dvir's analyses (5000-cap silently truncates).`);
} else if (filtered.length === fromList.length) {
  console.log(`  Same count both ways. Dvir really has ${filtered.length} analyses.`);
}
