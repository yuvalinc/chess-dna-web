const sample = await base44.entities.UserPreferences.list();
console.log('Total UserPreferences rows:', sample.length);
const first = sample[0] || {};
console.log('Keys:', Object.keys(first).join(', '));
const redacted = { ...first };
delete (redacted as Record<string, unknown>).claudeApiKey;
delete (redacted as Record<string, unknown>).openaiApiKey;
delete (redacted as Record<string, unknown>).geminiApiKey;
console.log(JSON.stringify(redacted, null, 2).slice(0, 2000));
