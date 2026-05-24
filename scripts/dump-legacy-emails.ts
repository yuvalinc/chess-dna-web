// Dump every Base44 user email so we can grandfather them all into the closed beta.
const users = await (base44.entities as any).User.list();
const emails: string[] = [];
for (const u of users) {
  const e = (u as any).email;
  if (typeof e === 'string' && e.includes('@')) {
    emails.push(e.toLowerCase());
  }
}
emails.sort();
console.log(`Total users: ${users.length}, with email: ${emails.length}\n`);
console.log('// Paste into beta-testers.ts as LEGACY_USERS_EMAILS:');
console.log('export const LEGACY_USERS_EMAILS: readonly string[] = [');
for (const e of emails) {
  console.log(`  '${e}',`);
}
console.log('];');
