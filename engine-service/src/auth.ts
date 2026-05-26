/**
 * JWT validation via Base44 token introspection.
 *
 * Base44 does NOT expose their HS256 signing secret to apps (confirmed
 * with support — it's an internal platform secret). So we can't verify
 * tokens locally. Instead we forward the token to Base44's
 * /entities/User/me endpoint — the same one the SDK's auth.me() hits.
 * If Base44 returns 200 with a user, the token is valid; anything else
 * means reject (or soft-fail via AUTH_OPTIONAL).
 *
 * To avoid adding a round-trip to every /analyze call, valid tokens
 * are cached in-memory for 5 minutes (rough TTL — a user analyzing a
 * batch of games hits Base44 once at the start).
 *
 * Env:
 *   BASE44_APP_ID    e.g. 69a04516fd2be6e9fdd5fbde (defaulted)
 *   BASE44_API_URL   e.g. https://base44.app (defaulted)
 *   AUTH_OPTIONAL    if 'true', soft-fail invalid tokens with dev-user
 *                    (useful for local dev + during shadow rollout)
 */
import type { Context, MiddlewareHandler } from 'hono';
import { decodeJwt } from 'jose';

export interface AuthedUser {
  userId: string;
  email: string | null;
}

const AUTH_OPTIONAL = process.env.AUTH_OPTIONAL === 'true';
const BASE44_APP_ID = process.env.BASE44_APP_ID ?? '69a04516fd2be6e9fdd5fbde';
const BASE44_API_URL = (process.env.BASE44_API_URL ?? 'https://base44.app').replace(/\/+$/, '');

// ─────────── token cache ───────────
// Map keyed on the raw token. Bounded eviction so a misbehaving caller
// rotating tokens can't blow up memory.
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 1000;
const cache = new Map<string, { user: AuthedUser; expiresAt: number }>();

function cacheGet(token: string): AuthedUser | null {
  const entry = cache.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(token);
    return null;
  }
  return entry.user;
}
function cacheSet(token: string, user: AuthedUser): void {
  cache.set(token, { user, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > CACHE_MAX) {
    // Drop the oldest insertion (Map iteration is insertion-order).
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

// ─────────── middleware ───────────
export const requireAuth: MiddlewareHandler<{ Variables: { user: AuthedUser } }> = async (c, next) => {
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    if (AUTH_OPTIONAL) {
      c.set('user', { userId: 'dev-user', email: 'dev@local' });
      return next();
    }
    return c.json({ error: 'missing_token' }, 401);
  }

  try {
    const user = await validateToken(token);
    c.set('user', user);
    return next();
  } catch (err) {
    if (AUTH_OPTIONAL) {
      // Soft-fail: log who we *think* it is (via unverified decode) for
      // telemetry sanity, then let them through with a placeholder user.
      const claimed = unverifiedClaims(token);
      console.warn(
        `[auth] introspection failed (${String(err)}); AUTH_OPTIONAL=true → ` +
        `allowing as ${claimed?.userId ?? 'dev-user'}`
      );
      c.set('user', claimed ?? { userId: 'dev-user', email: 'dev@local' });
      return next();
    }
    return c.json({ error: 'invalid_token', detail: String(err) }, 401);
  }
};

/**
 * Ask Base44 if the token is real. Returns the authed user on success,
 * throws on failure.
 */
async function validateToken(token: string): Promise<AuthedUser> {
  const cached = cacheGet(token);
  if (cached) return cached;

  const url = `${BASE44_API_URL}/api/apps/${BASE44_APP_ID}/entities/User/me`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-App-Id': BASE44_APP_ID,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    // Some Base44 apps have no `User` entity configured, in which case
    // /User/me returns 401 even for valid tokens (see CLAUDE.md note in
    // the parent app: "auth.me() may 401 but token still works for CRUD").
    // Fall back to a second probe against a generic auth-required path —
    // if the same token gets 401 there too, it's actually invalid.
    if (res.status === 401 || res.status === 404) {
      const probeOk = await probeTokenViaEntities(token);
      if (probeOk) {
        // Token works for CRUD; we just can't pull user details. Use the
        // unverified JWT claims for identification — risky for any
        // identity-bound logic, but engine_jobs.user_id just needs a
        // stable string to group by.
        const claimed = unverifiedClaims(token) ?? { userId: 'unknown', email: null };
        cacheSet(token, claimed);
        return claimed;
      }
    }
    throw new Error(`base44 returned ${res.status}`);
  }

  const body = (await res.json()) as { id?: string; email?: string };
  const userId = body.id;
  if (!userId) throw new Error('base44 /User/me response missing id');
  const user: AuthedUser = { userId, email: body.email ?? null };
  cacheSet(token, user);
  return user;
}

/**
 * Fallback probe: if /User/me 401s but the token IS valid for entity
 * CRUD, this confirms it. We use a HEAD against an arbitrary entity
 * list — auth check happens before pagination, so any 2xx/4xx that
 * isn't 401 means "token accepted."
 */
async function probeTokenViaEntities(token: string): Promise<boolean> {
  try {
    const url = `${BASE44_API_URL}/api/apps/${BASE44_APP_ID}/entities/Game?limit=1`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-App-Id': BASE44_APP_ID,
        Accept: 'application/json',
      },
    });
    return res.status !== 401 && res.status !== 403;
  } catch {
    return false;
  }
}

/** Decode a JWT *without* verifying — use only as a soft-fallback hint. */
function unverifiedClaims(token: string): AuthedUser | null {
  try {
    const payload = decodeJwt(token);
    const sub = (payload.sub ?? payload.userId ?? payload.user_id) as string | undefined;
    if (!sub) return null;
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sub);
    return {
      userId: sub,
      email: (payload.email as string | undefined) ?? (looksLikeEmail ? sub : null),
    };
  } catch {
    return null;
  }
}

export function getUser(c: Context<{ Variables: { user: AuthedUser } }>): AuthedUser {
  return c.var.user;
}
