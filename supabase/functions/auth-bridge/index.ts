/**
 * auth-bridge — validates a Base44 JWT, then proxies the request to
 * Supabase PostgREST using the project's service-role key.
 *
 * Phase 2 of the Fly + Supabase migration. We migrated from the original
 * "mint a Supabase JWT" architecture to this "proxy write" pattern on
 * 2026-05-26 — the older flow needed a shared HS256 secret matching what
 * PostgREST verifies against, but newer Supabase projects use asymmetric
 * JWKS keys whose private side isn't exposed to apps. The proxy pattern
 * sidesteps that entirely: the edge function executes the call as the
 * service role (auto-injected SUPABASE_SERVICE_ROLE_KEY), bypassing RLS,
 * and only does so once we've verified the caller has a valid Base44
 * session token.
 *
 * Request shape:
 *   POST /auth-bridge
 *   Authorization: Bearer <base44-jwt>
 *   Content-Type: application/json
 *   Body: { method: 'GET'|'POST'|'PATCH'|'DELETE', path: '/games?...',
 *            body?: any, prefer?: string }
 *
 * Response:
 *   - 200/201/204 with PostgREST's payload on success
 *   - 401/403 if the Base44 token is invalid or absent
 *   - 4xx/5xx mirroring whatever PostgREST returned for the underlying op
 *
 * Authz model:
 *   - Base44 JWT is validated (or accepted in shadow mode without
 *     verification — same compat behavior as before, see SHADOW MODE note).
 *   - We enforce that the payload's `user_id` field matches the JWT's sub
 *     for writes. Reads are returned unfiltered (RLS is bypassed by service
 *     role, but the caller can only request paths they construct).
 *
 * Env vars (Supabase auto-injects the two Supabase ones; we just read them):
 *   - SUPABASE_URL                Project REST base.
 *   - SUPABASE_SERVICE_ROLE_KEY   Service-role key (bypasses RLS).
 *   - BASE44_JWT_SECRET           Optional. HS256 secret for verifying Base44 tokens.
 *                                 If unset, we decode without verifying ("SHADOW MODE").
 */
import { jwtVerify, decodeJwt, type JWTPayload } from 'jose';

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('BRIDGE_SERVICE_KEY') ??
  '';
const BASE44_JWT_SECRET = Deno.env.get('BASE44_JWT_SECRET');

interface ProxyRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;        // begins with `/` — appended after `/rest/v1`
  body?: unknown;
  prefer?: string;     // optional Prefer header value
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(
      {
        error: 'server_misconfigured',
        detail: 'SUPABASE_URL or service key missing (set BRIDGE_SERVICE_KEY if SUPABASE_SERVICE_ROLE_KEY isn\'t auto-injected)',
      },
      500,
    );
  }

  // ── 1. Validate Base44 caller ──
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'missing_token' }, 401);

  let claims: JWTPayload;
  try {
    claims = await validateBase44Token(token);
  } catch (err) {
    return json({ error: 'invalid_base44_token', detail: String(err) }, 401);
  }

  const userId = (claims.sub ?? claims.userId ?? claims.user_id) as string | undefined;
  if (!userId) return json({ error: 'token_missing_userid' }, 401);

  // ── 2. Parse proxy payload ──
  let payload: ProxyRequest;
  try {
    payload = await req.json() as ProxyRequest;
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!payload.method || !payload.path) {
    return json({ error: 'missing_method_or_path' }, 400);
  }
  if (!payload.path.startsWith('/')) {
    return json({ error: 'path_must_start_with_slash' }, 400);
  }

  // ── 3. Authz: writes must target rows owned by the caller ──
  // For batch upserts (body is an array), enforce per-row: every row that
  // carries a user_id must match the caller. Single-object bodies behave
  // the same as before. Bodies without any user_id field (e.g. PATCH that
  // only updates certain columns) are allowed through — PostgREST's
  // path-level filter is then the auth boundary, and the caller can only
  // build paths they construct themselves.
  if (payload.method !== 'GET' && payload.body && typeof payload.body === 'object') {
    const rows = Array.isArray(payload.body)
      ? (payload.body as unknown[])
      : [payload.body];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const rowUserId = (row as Record<string, unknown>).user_id;
      if (rowUserId !== undefined && rowUserId !== userId) {
        return json(
          { error: 'forbidden', detail: `row.user_id (${rowUserId}) does not match caller (${userId})` },
          403,
        );
      }
    }
  }

  // ── 4. Forward to PostgREST ──
  const url = `${SUPABASE_URL}/rest/v1${payload.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
    'Content-Type': 'application/json',
  };
  if (payload.prefer) headers.Prefer = payload.prefer;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(url, {
      method: payload.method,
      headers,
      body: payload.body !== undefined && payload.method !== 'GET'
        ? JSON.stringify(payload.body)
        : undefined,
    });
  } catch (err) {
    return json({ error: 'upstream_fetch_failed', detail: String(err) }, 502);
  }

  const upstreamBody = await upstreamRes.text();

  // Status codes 101 / 204 / 205 / 304 are "null body" per the Fetch spec;
  // `new Response(text, { status: 204 })` throws — Deno surfaces that as a
  // generic 500 and the browser sees "TypeError: Failed to fetch". PATCH to
  // PostgREST without `Prefer: return=representation` returns 204, which is
  // exactly how we hit this.
  const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
  const body = NULL_BODY_STATUSES.has(upstreamRes.status) ? null : upstreamBody;
  return new Response(body, {
    status: upstreamRes.status,
    headers: {
      'Content-Type': upstreamRes.headers.get('content-type') ?? 'application/json',
      ...corsHeaders(),
    },
  });
});

async function validateBase44Token(token: string): Promise<JWTPayload> {
  if (BASE44_JWT_SECRET) {
    const secret = new TextEncoder().encode(BASE44_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return payload;
  }
  // SHADOW MODE: decode without verification. Acceptable in shadow rollout
  // because Supabase data is just a mirror — the source of truth is Base44.
  // MUST get BASE44_JWT_SECRET (or move to introspection via Base44 /User/me)
  // before Phase 6 flips read source to Supabase.
  console.warn('[auth-bridge] SHADOW MODE: BASE44_JWT_SECRET missing, decoding without verification');
  return decodeJwt(token);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, apikey, x-client-info, x-supabase-api-version, prefer',
  };
}
