/**
 * Delete-account helper.
 *
 * Base44's client SDK doesn't expose a "delete user" API, and its
 * `auth.updateMe` endpoint returns 401 for normal users ("Authentication
 * required to update your user") — Base44 only lets admins mutate User
 * records. So "deleting an account" here means:
 *   1. Remove every entity record the user owns.
 *   2. Clear local storage (tokens, settings caches, IndexedDB).
 *   3. Call `base44.auth.logout()` with an explicit redirect — the logout
 *      endpoint clears the HTTP-only session cookie server-side, then
 *      bounces the browser to the redirect URL. Their Base44 User record
 *      still exists, but the session is terminated and all their data is
 *      gone; a fresh OAuth sign-in creates a clean empty account.
 */
import { base44 } from '@/api/base44Client';

/** Entities that belong to a user and should be wiped on account deletion. */
const USER_ENTITIES = [
  'Game',
  'Analysis',
  'Pattern',
  'PatternSnapshot',
  'UserPreferences',
  'Insight',
  'Lesson',
  'Exercise',
  'TrainingPlan',
];

/** How many delete requests to run concurrently. Keep small to avoid 429. */
const DELETE_CONCURRENCY = 4;

export interface DeleteProgress {
  entity: string;
  deleted: number;
  total: number;
}

/** Delete a single record with 429-aware retry. */
async function deleteWithRetry(ent: { delete: (id: string) => Promise<unknown> }, id: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await ent.delete(id);
      return;
    } catch (err: unknown) {
      const msg = String(err);
      const is429 = msg.includes('429') || msg.includes('Too Many Requests');
      if (!is429 && attempt > 0) return; // Non-rate-limit error: already retried once, give up.
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
}

/** Run promises with bounded concurrency, reporting progress after each. */
async function runBatched<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number,
  onOne: (completed: number) => void,
): Promise<void> {
  let completed = 0;
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
      completed++;
      onOne(completed);
    }
  });
  await Promise.all(runners);
}

export async function deleteAccountData(
  onProgress?: (p: DeleteProgress) => void,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entities = base44.entities as any;

  for (const name of USER_ENTITIES) {
    const ent = entities[name];
    if (!ent || typeof ent.list !== 'function' || typeof ent.delete !== 'function') {
      continue;
    }
    let records: Array<{ id: string }> = [];
    try {
      records = await ent.list();
    } catch {
      continue; // Entity may not exist for this user / schema — skip it.
    }
    if (!Array.isArray(records) || records.length === 0) continue;

    const total = records.length;
    onProgress?.({ entity: name, deleted: 0, total });

    await runBatched(
      records,
      async (rec) => {
        if (rec?.id) await deleteWithRetry(ent, rec.id);
      },
      DELETE_CONCURRENCY,
      (completed) => onProgress?.({ entity: name, deleted: completed, total }),
    );
  }

  // Wipe local caches: Base44 token, app settings, IndexedDB-backed stores.
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith('base44') ||
        key.startsWith('chessdna') ||
        key.startsWith('chess-dna') ||
        key.includes('settings') ||
        key.includes('onboarding') ||
        key === 'token'
      ) {
        localStorage.removeItem(key);
      }
    }
  } catch { /* ignore */ }

  try {
    const dbs = (await (indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }).databases?.()) ?? [];
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
  } catch { /* ignore */ }

  // Sign out. Pass an explicit redirect URL ('/') so Base44's logout endpoint
  // clears the session cookie then bounces back to the app root, instead of
  // back to /settings (which would try to reauth). This is the LAST step
  // because `window.location.href = logoutUrl` begins a cross-origin
  // navigation — any code after it may or may not run depending on how
  // quickly the browser tears down the page.
  try {
    base44.auth.logout('/');
  } catch { /* ignore */ }
}
