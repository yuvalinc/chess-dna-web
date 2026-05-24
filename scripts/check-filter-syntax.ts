/**
 * The filter({ created_by_id }) returned 0 — suspicious.
 * Test filter() with a known-good key (gameId) against a known Dvir analysis.
 */
const knownGameId = '6a02c1ce0d9f260ef0f6038a'; // one of Dvir's analyses

// Test 1: filter by gameId
try {
  const r = await (base44.entities as any).Analysis.filter({ gameId: knownGameId });
  console.log(`filter({gameId=${knownGameId}}): ${Array.isArray(r) ? r.length : typeof r} result(s)`);
  if (Array.isArray(r) && r[0]) {
    console.log(`  first: id=${r[0].id}, created_by_id=${r[0].created_by_id}, analyzedAt=${r[0].analyzedAt}`);
  }
} catch (err) {
  console.log(`filter by gameId failed: ${(err as Error).message?.slice(0, 200)}`);
}

// Test 2: filter by created_by_id  but with a different known owner (Yuval, who has 3392)
try {
  const r = await (base44.entities as any).Analysis.filter({ created_by_id: '69a04516fd2be6e9fdd5fbdf' });
  console.log(`filter({created_by_id=Yuval}): ${Array.isArray(r) ? r.length : typeof r} result(s)`);
} catch (err) {
  console.log(`filter by created_by_id failed: ${(err as Error).message?.slice(0, 200)}`);
}

// Test 3: Maybe Base44 SDK requires nested-filter syntax
try {
  const r = await (base44.entities as any).Analysis.filter({ created_by_id: { $eq: '6a020a5536d35a06a6025a3e' } });
  console.log(`filter({created_by_id: $eq Dvir}): ${Array.isArray(r) ? r.length : typeof r} result(s)`);
} catch (err) {
  console.log(`filter with $eq failed: ${(err as Error).message?.slice(0, 200)}`);
}

// Test 4: What methods are on the entity?
const methods = Object.getOwnPropertyNames((base44.entities as any).Analysis);
console.log(`\nMethods on entity:`, methods.join(', '));

// Test 5: Use list with options? Some SDKs accept { limit, offset, sort }
try {
  const r2 = await (base44.entities as any).Analysis.list({ limit: 6000 });
  console.log(`\nlist({limit:6000}): ${Array.isArray(r2) ? r2.length : typeof r2}`);
} catch (err) {
  console.log(`\nlist with limit failed: ${(err as Error).message?.slice(0, 200)}`);
}
