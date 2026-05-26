/**
 * Shadow-mode wrapper.
 *
 * Imported once at app startup (from main.tsx). Replaces `base44.entities`
 * with a Proxy that intercepts each CRUD method call and routes it through
 * our dual-write + shadow-read wrappers.
 *
 * Why a Proxy and not direct mutation:
 *   The Base44 SDK implements `client.entities` as a Proxy whose `get` trap
 *   returns a FRESH handler object on every property access (see
 *   `@base44/sdk/dist/modules/entities.js` — `createEntityHandler` is called
 *   anew for each lookup). So mutating the returned handler
 *   (`handler.create = ...`) only modifies a throwaway object that's GC'd
 *   immediately. The patch silently does nothing.
 *
 *   This was the root cause of every "shadow mode does nothing in prod"
 *   symptom from 2026-05-25/26 — debugging via Chrome MCP confirmed the
 *   patch install log fired but zero auth-bridge / Supabase / drift_log
 *   activity ever followed.
 *
 *   The fix: replace `base44.entities` itself with our own Proxy. On each
 *   `base44.entities.Game` access, our Proxy reads the SDK's fresh handler
 *   and returns a NEW object that exposes the same surface but with our
 *   wrappers in front of the CRUD methods. The original handler's other
 *   properties (e.g. realtime subscribers) pass through untouched via
 *   inner-Proxy fallback.
 *
 * Importing has side effects. Only import from main.tsx.
 */
import { base44 } from './base44Client';
import { dwCreate, dwUpdate, dwDelete, type Entity } from './dual-write';
import { srGet, srList, srFilter } from './shadow-read';

const ENTITIES: Entity[] = [
  'Game',
  'Analysis',
  'Pattern',
  'PatternSnapshot',
  'UserPreferences',
  'Insight',
];
const ENTITY_SET = new Set<string>(ENTITIES);

const sdkClient = base44 as unknown as { entities: Record<string, any> };
const origEntities = sdkClient.entities;

// Per-entity wrappers, allocated once. Each closure binds the entity name.
const wrappers: Record<string, Record<string, (...args: any[]) => any>> = {};
for (const entity of ENTITIES) {
  wrappers[entity] = {
    create: (data: Record<string, unknown>) => dwCreate(entity, data),
    update: (id: string, data: Record<string, unknown>) => dwUpdate(entity, id, data),
    delete: (id: string) => dwDelete(entity, id),
    get: (id: string) => srGet(entity, id),
    list: (sort?: string, limit?: number) => srList(entity, sort, limit),
    filter: (filters: Record<string, unknown>, sort?: string, limit?: number) =>
      srFilter(entity, filters, sort, limit),
  };
}

// Replace the SDK's entities Proxy with a wrapping Proxy.
// We can't reuse the existing object because mutating its handlers does
// nothing (see comment above). A wholesale replacement is the only path
// that survives the SDK's per-access object creation.
sdkClient.entities = new Proxy({}, {
  get(_target, prop) {
    if (typeof prop !== 'string') return (origEntities as any)[prop as any];
    if (prop === 'then' || prop.startsWith('_')) return undefined;
    if (!ENTITY_SET.has(prop)) return (origEntities as any)[prop];

    // Fetch the SDK's fresh handler for this entity. Wrap its CRUD methods;
    // anything else (realtime subscribers, etc.) falls through to the orig
    // via an inner Proxy so we don't have to enumerate the surface.
    const orig = (origEntities as any)[prop];
    const wrapped = wrappers[prop];
    return new Proxy(orig, {
      get(_t, methodName) {
        if (typeof methodName === 'string' && methodName in wrapped) {
          return wrapped[methodName];
        }
        return (orig as any)[methodName];
      },
    });
  },
});

console.log('[shadow-wrap] base44.entities replaced with wrapping Proxy (per-access)');
