/**
 * Engine backend selection — feature flag for Phase 1 of the Fly migration.
 * See docs/handoff/fly-migration-plan.md.
 *
 * Default: 'browser' (existing WASM Stockfish worker — zero behavior change).
 * Two opt-in modes (either is enough — both can be set together):
 *   1. Global: set `VITE_ENGINE_BACKEND=fly` → every user routes via Fly.
 *   2. Per-user: set `VITE_FLY_ENGINE_ALLOWED_EMAILS=a@x.com,b@y.com` →
 *      only those users route via Fly; everyone else stays on browser WASM.
 *      (Useful for "canary on my own account" without affecting other users.)
 * Both modes require `VITE_FLY_ENGINE_URL` to be set as well.
 *
 * Reads happen at module load time. To change the backend, change the env var
 * and reload the page.
 */

export type EngineBackend = 'browser' | 'fly';

const RAW_BACKEND = (import.meta.env.VITE_ENGINE_BACKEND ?? '').toLowerCase();
const RAW_URL = (import.meta.env.VITE_FLY_ENGINE_URL ?? '').trim();
const RAW_ALLOWED_EMAILS = String(import.meta.env.VITE_FLY_ENGINE_ALLOWED_EMAILS ?? '');

export const ENGINE_BACKEND: EngineBackend = RAW_BACKEND === 'fly' ? 'fly' : 'browser';
export const FLY_ENGINE_URL: string = RAW_URL.replace(/\/+$/, ''); // strip trailing slashes

/** Lowercased, trimmed allow-list. Empty = no per-user opt-ins. */
export const FLY_ENGINE_ALLOWED_EMAILS: ReadonlyArray<string> = RAW_ALLOWED_EMAILS
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s.length > 0);

/**
 * Whether the GLOBAL flag has opted every user into the Fly engine.
 * Requires both the flag AND the URL — falls back to browser if either is
 * missing so a misconfigured env doesn't break analysis.
 */
export function isFlyEngine(): boolean {
  return ENGINE_BACKEND === 'fly' && FLY_ENGINE_URL.length > 0;
}

/**
 * Per-user gate. Returns true if `email` is in the allow-list AND a Fly URL
 * is configured. Use this from `analyzeGame()` to route a specific user
 * through Fly while keeping browser WASM for everyone else.
 */
export function isFlyEngineForUser(email: string | null | undefined): boolean {
  if (!FLY_ENGINE_URL) return false;
  if (!email) return false;
  if (FLY_ENGINE_ALLOWED_EMAILS.length === 0) return false;
  return FLY_ENGINE_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * Convenience: should analysis route through Fly for the given user?
 * True when EITHER the global flag is on OR the per-user allow-list matches.
 */
export function shouldUseFlyEngine(email: string | null | undefined): boolean {
  return isFlyEngine() || isFlyEngineForUser(email);
}
