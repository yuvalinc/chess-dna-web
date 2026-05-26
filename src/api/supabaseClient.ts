/**
 * Supabase client — proxies REST calls through the auth-bridge Edge Function.
 *
 * The bridge validates the user's Base44 JWT, then forwards the request to
 * PostgREST using the project's service-role key. RLS is bypassed by the
 * service role, but the bridge enforces that writes carry `user_id` matching
 * the caller's Base44 sub.
 *
 * Why proxy instead of issuing client-side Supabase JWTs:
 *   Newer Supabase projects sign session JWTs with asymmetric keys (JWKS)
 *   whose private side isn't exposed to apps. The old "mint HS256 with shared
 *   secret" pattern doesn't verify against the JWKS PostgREST now uses. The
 *   proxy avoids the problem — only the service-role key on the edge side
 *   ever touches PostgREST.
 *
 * Request:
 *   const games = await supabaseFetch<GameRow[]>('/games?user_id=eq.123&order=played_at.desc');
 *   await supabaseFetch('/games', { method: 'POST', body: JSON.stringify(row) });
 *
 * The body for writes is parsed by the bridge — pass a plain object via
 * `body` (string or object both work for backwards compat with old callers).
 */

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
const AUTH_BRIDGE_URL = `${SUPABASE_URL}/functions/v1/auth-bridge`;

/** Check whether Supabase is configured. False = fall back to Base44 silently. */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

function getBase44Token(): string | null {
  try {
    return (
      localStorage.getItem('base44_access_token') ??
      localStorage.getItem('token') ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * Make an authenticated request to the Supabase REST API via the proxy bridge.
 *
 * The path is what you'd pass to PostgREST directly — e.g. `/games?user_id=eq.X`
 * or `/games`. Init mirrors fetch() RequestInit so callers can pass method,
 * body, headers (only `Prefer` is forwarded), etc.
 */
export async function supabaseFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!isSupabaseConfigured()) {
    throw new SupabaseError(0, 'Supabase not configured');
  }

  const base44Token = getBase44Token();
  if (!base44Token) {
    throw new SupabaseError(401, 'No Base44 token in localStorage — cannot mirror to Supabase');
  }

  const method = (init.method ?? 'GET').toUpperCase() as 'GET' | 'POST' | 'PATCH' | 'DELETE';

  // Body comes in as either a string (the old contract) or already-parsed
  // object. The bridge wants a JSON object on the wire, so unwrap strings.
  let parsedBody: unknown = undefined;
  if (init.body !== undefined && init.body !== null) {
    if (typeof init.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body; // keep as-is; bridge will reject if invalid
      }
    } else {
      parsedBody = init.body;
    }
  }

  // Extract the Prefer header if any — bridge forwards it explicitly so we
  // don't need to send it on the outer request.
  const preferHeader =
    (init.headers as Record<string, string> | undefined)?.['Prefer'] ??
    (init.headers as Record<string, string> | undefined)?.['prefer'] ??
    'return=representation';

  const res = await fetch(AUTH_BRIDGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${base44Token}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      method,
      path: path.startsWith('/') ? path : `/${path}`,
      body: parsedBody,
      prefer: preferHeader,
    }),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new SupabaseError(
      res.status,
      `Supabase ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`,
    );
  }

  if (res.status === 204 || text === '') {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export class SupabaseError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'SupabaseError';
  }
}

/**
 * No-op now (kept for compatibility with the previous JWT-cache API). The new
 * proxy architecture has no per-session Supabase token to clear.
 */
export function clearSupabaseToken(): void {
  /* nothing to clear */
}
