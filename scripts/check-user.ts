// Explore what's available on base44 for listing users.
console.log('base44 keys:', Object.keys(base44));
console.log('base44.auth keys:', Object.keys((base44 as any).auth ?? {}));
console.log('base44.users:', typeof (base44 as any).users);
console.log('base44.entities keys:', Object.keys(base44.entities));

// Try a few likely calls
for (const fn of ['list', 'all', 'listUsers']) {
  const target = (base44 as any).auth?.[fn];
  if (typeof target === 'function') {
    try {
      const res = await target.call((base44 as any).auth);
      console.log(`auth.${fn}() success, type=${Array.isArray(res) ? 'array(' + res.length + ')' : typeof res}`);
      if (Array.isArray(res) && res[0]) {
        const sample = { ...res[0] };
        console.log('  sample keys:', Object.keys(sample).join(', '));
        console.log('  first row:', JSON.stringify(sample, null, 2));
      }
    } catch (err) {
      console.log(`auth.${fn}() error:`, (err as Error).message);
    }
  }
}

// Also try entities.User
try {
  const users = await (base44.entities as any).User?.list?.();
  console.log('entities.User.list:', Array.isArray(users) ? `${users.length} rows` : typeof users);
  if (Array.isArray(users) && users[0]) {
    console.log('  sample:', JSON.stringify(users[0], null, 2));
  }
} catch (err) {
  console.log('entities.User.list error:', (err as Error).message);
}
