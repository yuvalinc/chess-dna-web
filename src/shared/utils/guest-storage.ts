/**
 * Guest storage layer — localStorage-backed entity storage for unauthenticated users.
 * Provides the same CRUD interface as Base44 entities so the app works identically
 * whether the user is a guest or authenticated.
 *
 * On login, migrateGuestToBase44() moves all guest data to Base44 entities.
 */

const GUEST_PREFIX = 'chess-dna-guest-';

/** Check if any guest ENTITY data exists (Game, Analysis, etc.).
 *  Only returns true if there are actual entity records — not just empty arrays.
 *  This prevents false migrations for authenticated users. */
export function hasGuestData(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(GUEST_PREFIX)) continue;
      // Check that this key contains actual data (non-empty array or valid singleton)
      const val = localStorage.getItem(key);
      if (!val) continue;
      // Skip empty arrays
      if (val === '[]') continue;
      // Has real data
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

/** Get all items for an entity type */
export function getGuestEntities<T>(entityName: string): T[] {
  try {
    const raw = localStorage.getItem(GUEST_PREFIX + entityName);
    if (!raw) return [];
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

/** Save (append) a new item to an entity list. Assigns an ID if missing. */
export function createGuestEntity<T extends Record<string, unknown>>(entityName: string, item: T): T {
  const items = getGuestEntities<T>(entityName);
  const withId = { ...item, id: item.id ?? `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  items.push(withId as T);
  localStorage.setItem(GUEST_PREFIX + entityName, JSON.stringify(items));
  return withId as T;
}

/** Update an existing item by ID */
export function updateGuestEntity<T extends Record<string, unknown>>(entityName: string, id: string, patch: Partial<T>): void {
  const items = getGuestEntities<T>(entityName);
  const idx = items.findIndex((item) => (item as Record<string, unknown>).id === id);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...patch } as T;
    localStorage.setItem(GUEST_PREFIX + entityName, JSON.stringify(items));
  }
}

/** Delete an item by ID */
export function deleteGuestEntity(entityName: string, id: string): void {
  const items = getGuestEntities<Record<string, unknown>>(entityName);
  const filtered = items.filter((item) => item.id !== id);
  localStorage.setItem(GUEST_PREFIX + entityName, JSON.stringify(filtered));
}

/** Get a singleton entity (like UserPreferences) */
export function getGuestSingleton<T>(entityName: string): T | null {
  try {
    const raw = localStorage.getItem(GUEST_PREFIX + entityName + '-singleton');
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Set a singleton entity */
export function setGuestSingleton<T>(entityName: string, data: T): void {
  localStorage.setItem(GUEST_PREFIX + entityName + '-singleton', JSON.stringify(data));
}

/** Update a singleton entity (merge) */
export function updateGuestSingleton<T extends Record<string, unknown>>(entityName: string, patch: Partial<T>): void {
  const current = getGuestSingleton<T>(entityName) ?? ({} as T);
  setGuestSingleton(entityName, { ...current, ...patch });
}

/** Clear all guest data (after migration) */
export function clearAllGuestData(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(GUEST_PREFIX)) keysToRemove.push(key);
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

/**
 * Migrate all guest data to Base44 entities.
 * Called after user authenticates for the first time.
 */
export async function migrateGuestToBase44(
  base44Entities: Record<string, {
    create: (data: Record<string, unknown>) => Promise<Record<string, unknown>>;
    list: () => Promise<Record<string, unknown>[]>;
  }>,
): Promise<{ games: number; analyses: number; settings: boolean }> {
  const stats = { games: 0, analyses: 0, settings: false };

  // Migrate games
  const guestGames = getGuestEntities<Record<string, unknown>>('Game');
  for (const game of guestGames) {
    try {
      const { id: _id, ...gameData } = game; // Strip guest ID
      await base44Entities.Game.create(gameData);
      stats.games++;
    } catch (err) {
      console.warn('[Guest Migration] Failed to migrate game:', err);
    }
  }

  // Migrate analyses
  const guestAnalyses = getGuestEntities<Record<string, unknown>>('Analysis');
  for (const analysis of guestAnalyses) {
    try {
      const { id: _id, ...analysisData } = analysis;
      await base44Entities.Analysis.create(analysisData);
      stats.analyses++;
    } catch (err) {
      console.warn('[Guest Migration] Failed to migrate analysis:', err);
    }
  }

  // Migrate settings (singleton)
  const guestSettings = getGuestSingleton<Record<string, unknown>>('UserPreferences');
  if (guestSettings) {
    try {
      // Check if user already has settings in Base44
      const existing = await base44Entities.UserPreferences.list();
      if (Array.isArray(existing) && existing.length > 0) {
        // Merge guest settings into existing
        const entity = base44Entities.UserPreferences as unknown as {
          update: (id: string, data: Record<string, unknown>) => Promise<void>;
        };
        await entity.update(existing[0].id as string, guestSettings);
      } else {
        await base44Entities.UserPreferences.create(guestSettings);
      }
      stats.settings = true;
    } catch (err) {
      console.warn('[Guest Migration] Failed to migrate settings:', err);
    }
  }

  // Migrate patterns (singleton)
  const guestPatterns = getGuestSingleton<Record<string, unknown>>('Pattern');
  if (guestPatterns) {
    try {
      const existing = await base44Entities.Pattern.list();
      if (Array.isArray(existing) && existing.length > 0) {
        const entity = base44Entities.Pattern as unknown as {
          update: (id: string, data: Record<string, unknown>) => Promise<void>;
        };
        await entity.update(existing[0].id as string, guestPatterns);
      } else {
        await base44Entities.Pattern.create(guestPatterns);
      }
    } catch (err) {
      console.warn('[Guest Migration] Failed to migrate patterns:', err);
    }
  }

  // Clear guest data after successful migration
  clearAllGuestData();
  console.log('[Guest Migration] Complete:', stats);

  return stats;
}
