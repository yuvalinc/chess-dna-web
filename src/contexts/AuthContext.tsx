import { createContext, useContext, useEffect, useState } from 'react';
import { base44 } from '../api/base44Client';
import { hasGuestData, migrateGuestToBase44 } from '@shared/utils/guest-storage';

import { ADMIN_EMAILS } from '@shared/constants';
import { isWhitelistedEmail } from '@shared/beta-testers';
const ADMIN_EMAIL = 'yuval.inc@gmail.com'; // legacy single check

/** Closed-beta access state, derived after we resolve the user's email. */
export type BetaStatus =
  | 'pending'      // still resolving auth/email
  | 'allowed'     // email is on the whitelist or user is admin
  | 'denied'      // email confirmed, not on whitelist → show waitlist gate
  | 'unknown';    // authed but email couldn't be resolved → forced sign-out

/**
 * Best-effort claim extraction from the Base44 JWT in localStorage.
 * Used as a fallback when `auth.me()` fails (this app has no User entity,
 * so /me sometimes 401s — see CLAUDE.md). Standard JWTs are
 * header.payload.signature with the payload base64url-encoded; we read
 * the `email` claim and the user-id claim (tries `sub`/`user_id`/`id` in
 * that order). No signature verification here — server-side RLS still
 * does the real auth.
 */
function decodeJwt(): { email: string | null; userId: string | null } {
  try {
    const token =
      localStorage.getItem('base44_access_token') ||
      localStorage.getItem('token');
    if (!token) return { email: null, userId: null };
    const parts = token.split('.');
    if (parts.length !== 3) return { email: null, userId: null };
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    const pickStr = (k: string): string | null =>
      typeof payload[k] === 'string' && (payload[k] as string).length > 0
        ? (payload[k] as string)
        : null;
    // Base44 tokens commonly put the email in `sub` and have no `email` claim.
    // Without this fallback, jwtEmail stays null on first render → betaStatus
    // sits at 'pending' → AuthGuard shows a loader until `auth.me()` returns.
    // That's exactly the "stuck on loading" state when the network is slow.
    const subVal = pickStr('sub');
    const emailVal = pickStr('email');
    const subLooksLikeEmail = !!subVal && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subVal);
    return {
      email: emailVal ?? (subLooksLikeEmail ? subVal : null),
      userId: subVal ?? pickStr('user_id') ?? pickStr('id'),
    };
  } catch {
    return { email: null, userId: null };
  }
}

/**
 * Check for Base44 access token in localStorage.
 * The SDK stores the JWT here after login redirect (`?access_token=...`).
 * This is the reliable auth signal — `auth.me()` fails with 401 because
 * this app has no User entity, but the token is valid for all entity CRUD.
 */
function getBase44Token(): string | null {
  try {
    return localStorage.getItem('base44_access_token') || localStorage.getItem('token') || null;
  } catch {
    return null;
  }
}

/**
 * "Real mode" — when this localStorage flag is set, the local dev server
 * skips its usual `isDev`-shortcut and runs the full production auth flow
 * against Base44. Useful for testing real entity CRUD, analytics, RLS, and
 * admin gating from localhost. Pair with a pasted access token (see
 * DevModeToggle) to actually have an authenticated session.
 */
export function isRealMode(): boolean {
  try {
    return localStorage.getItem('chess-dna-real-mode') === 'true';
  } catch {
    return false;
  }
}

interface AuthContextValue {
  /** True when a valid Base44 session token exists */
  isAuthenticated: boolean;
  /** True when no Base44 token — user is browsing as guest */
  isGuest: boolean;
  userId: string | null;
  userEmail: string | null;
  isAdmin: boolean | null; // null = still loading
  /** true once auth check has completed (success or failure) */
  authResolved: boolean;
  /** Closed-beta access decision — see BetaStatus. */
  betaStatus: BetaStatus;
}

// Module-level cache for imperative (non-React) code
let _cachedUserId: string | null = null;
let _cachedUserEmail: string | null = null;

/** Get current user ID synchronously — for use outside React components */
export function getCurrentUserId(): string | null {
  return _cachedUserId;
}

/**
 * Get current user email synchronously — for use outside React components
 * (e.g. engine routing in `game-analyzer.ts`). Returns the cached email if
 * `auth.me()` has resolved; otherwise falls back to decoding the JWT in
 * localStorage. Base44 JWTs commonly carry the email in the `sub` claim
 * rather than `email`, so we accept either path.
 */
export function getCurrentUserEmail(): string | null {
  if (_cachedUserEmail) return _cachedUserEmail;
  const jwt = decodeJwt();
  // `decodeJwt` only treats `email` as the email field; `sub` ends up in
  // `userId`. For Base44, `sub` is the email — so check whether the userId
  // looks like an email address and fall back to that.
  const looksLikeEmail = (s: string | null): s is string =>
    !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  const email = jwt.email ?? (looksLikeEmail(jwt.userId) ? jwt.userId : null);
  if (email) _cachedUserEmail = email;
  return email;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  isGuest: true,
  userId: null,
  userEmail: null,
  isAdmin: null,
  authResolved: false,
  betaStatus: 'pending',
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // `useDevShortcut` keeps the old fast-path (always-authenticated, always-
  // admin) for local development. Flipping the `chess-dna-real-mode` flag
  // turns it off so the dev server uses the same auth flow as production.
  const isDev = import.meta.env.DEV;
  const realMode = isRealMode();
  const useDevShortcut = isDev && !realMode;

  // Token check is synchronous — we know auth state immediately
  const token = getBase44Token();
  const [isAuthenticated] = useState(() => useDevShortcut || !!token);

  // Decode the JWT once up-front. The token in localStorage is stable across
  // reloads, so this is a deterministic signal we can trust without waiting
  // on auth.me() — which intermittently returns the user object without an
  // `email` field and was leaving whitelisted users stuck at the gate.
  const initialJwt = useDevShortcut ? { email: null, userId: null } : decodeJwt();
  const jwtEmail = initialJwt.email;

  // Synchronous admin/whitelist check from JWT claims. If the email is on a
  // hardcoded list (admin, BETA_TESTERS, or legacy users), allow immediately —
  // no roundtrip, no gate flicker. resolveBetaStatus still runs after
  // auth.me() to cover the dynamic legacy-by-data check.
  const initialAllowed = !!jwtEmail && (
    jwtEmail === ADMIN_EMAIL ||
    ADMIN_EMAILS.includes(jwtEmail) ||
    isWhitelistedEmail(jwtEmail)
  );

  // Seed userId from the JWT synchronously so downstream caches (list-cache,
  // singleton-cache) can build their per-user keys on first paint. auth.me()
  // overrides this with the same value asynchronously — they match for a
  // valid token.
  const [userId, setUserId] = useState<string | null>(initialJwt.userId);
  const [userEmail, setUserEmail] = useState<string | null>(jwtEmail);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(
    useDevShortcut ? true :
    jwtEmail ? (jwtEmail === ADMIN_EMAIL || ADMIN_EMAILS.includes(jwtEmail)) :
    null
  );
  const [authResolved, setAuthResolved] = useState(false);
  // Dev shortcut bypasses the closed-beta gate so local development isn't blocked.
  const [betaStatus, setBetaStatus] = useState<BetaStatus>(
    useDevShortcut || initialAllowed ? 'allowed' : 'pending'
  );

  /**
   * Resolve the closed-beta decision.
   *
   * Order of checks:
   *  1. Email is unknown → 'unknown' (forced sign-out via WaitlistGate)
   *  2. Admin email → 'allowed'
   *  3. Email on the whitelist → 'allowed'
   *  4. Legacy-user grandfather: if the user already has a UserPreferences
   *     row in Base44 (or a Game record), they signed up BEFORE the gate
   *     was activated — grandfather them in. Auto-detects every existing
   *     user without needing a static list.
   *  5. Otherwise → 'denied' (waitlist form).
   */
  const resolveBetaStatus = async (email: string | null, uid: string | null) => {
    if (!email) {
      setBetaStatus('unknown');
      return;
    }
    const isAdminEmail = email === ADMIN_EMAIL || ADMIN_EMAILS.includes(email);
    if (isAdminEmail || isWhitelistedEmail(email)) {
      setBetaStatus('allowed');
      return;
    }
    // Legacy check — needs a user ID to query Base44. Without one we can't
    // tell legacy from brand-new, so default-deny.
    if (!uid) {
      setBetaStatus('denied');
      return;
    }
    try {
      const entities = base44.entities as Record<string, any>;
      const prefs = await entities.UserPreferences.filter({ created_by_id: uid });
      if (Array.isArray(prefs) && prefs.length > 0) {
        console.log('[Chess DNA Auth] Legacy user — grandfathered past the beta gate');
        setBetaStatus('allowed');
        return;
      }
      // Fallback: user might have Games but no UserPreferences row yet.
      const games = await entities.Game.filter({ created_by_id: uid });
      if (Array.isArray(games) && games.length > 0) {
        console.log('[Chess DNA Auth] Legacy user (by Game records) — grandfathered');
        setBetaStatus('allowed');
        return;
      }
    } catch (err) {
      // If the legacy-data lookup fails, we'd rather let the user in than
      // wrongly block someone with a transient Base44 hiccup. They're
      // already authenticated; the worst case is a non-whitelisted new
      // user slipping past during an outage — admin can clean up later.
      console.warn('[Chess DNA Auth] Legacy check failed, allowing through:', err);
      setBetaStatus('allowed');
      return;
    }
    setBetaStatus('denied');
  };

  useEffect(() => {
    console.log('[Chess DNA Auth] Init — token:', !!token, 'isDev:', isDev, 'realMode:', realMode);

    if (useDevShortcut) {
      setAuthResolved(true);
      return;
    }

    if (!token) {
      // No token → definitely not authenticated → show landing page
      console.log('[Chess DNA Auth] No token found → unauthenticated');
      setIsAdmin(false);
      setAuthResolved(true);
      // Beta status irrelevant when not authed — AuthGuard shows the entry gate first.
      setBetaStatus('pending');
      return;
    }

    console.log('[Chess DNA Auth] Token found → authenticated, trying auth.me() for user details...');

    // Token exists → user is authenticated. We previously blocked
    // `authResolved` on auth.me() finishing, which gated every entity
    // fetch on a 200-500ms round-trip we don't actually need for first
    // paint. Now we fast-path: resolve auth synchronously (so entity
    // fetches kick off in parallel) and enrich userId/email/admin in
    // the background.
    //
    // Previously we ALSO blocked on guest→Base44 migration so users
    // didn't see an empty collection mid-migration. That broke down
    // once we throttled the migration to dodge Base44 rate limits —
    // hundreds of items × 250ms could leave the UI stuck on loading
    // for minutes. Resolve immediately and let migration run async;
    // entity caches will refetch once items land. The migration's own
    // .then() handler reloads the page if it completes cleanly.
    const hasGuest = hasGuestData();
    setAuthResolved(true);

    base44.auth
      .me()
      .then((user: Record<string, unknown>) => {
        const id = (user?.id as string) ?? null;
        // auth.me() occasionally returns the user object without an email
        // field — fall back to the JWT email so we don't gate a verified user.
        const email = ((user?.email as string) ?? null) || decodeJwt().email;
        _cachedUserId = id;
        _cachedUserEmail = email;
        setUserId(id);
        setUserEmail(email);
        setIsAdmin(email === ADMIN_EMAIL || ADMIN_EMAILS.includes(email ?? ''));
        void resolveBetaStatus(email, id);
        console.log('[Chess DNA Auth] auth.me() succeeded — userId:', id, 'email:', email);
        // Fire-and-forget: top up this user's Supabase mirror if it has
        // any gap vs Base44. Runs at most once per 24h per user, gated by
        // localStorage. No-op for users already at parity. Critical for
        // Phase 6 — users who never opened the app after shadow-mode shipped
        // need their historical rows mirrored before reads flip.
        void import('@/api/lazy-backfill').then(({ startLazyBackfill }) => {
          // Pass the Base44 ObjectId (id) so the backfill scopes its read by
          // created_by_id — never a bare .list(), which returns ALL users'
          // rows for admin accounts and would corrupt the mirror.
          startLazyBackfill(email, id);
        }).catch(() => { /* lazy import failed, skip silently */ });
      })
      .catch((err: unknown) => {
        // auth.me() failed but token exists → still authenticated.
        // Fall back to decoding the JWT for email + user id so we can still
        // make the closed-beta whitelist decision (and the legacy-user check).
        console.log('[Chess DNA Auth] auth.me() failed — using JWT fallback:', err);
        const jwt = decodeJwt();
        if (jwt.email) {
          _cachedUserEmail = jwt.email;
          setUserEmail(jwt.email);
          setIsAdmin(jwt.email === ADMIN_EMAIL || ADMIN_EMAILS.includes(jwt.email));
        } else {
          setIsAdmin(false);
        }
        if (jwt.userId) {
          _cachedUserId = jwt.userId;
          setUserId(jwt.userId);
        }
        void resolveBetaStatus(jwt.email, jwt.userId);
      })
      .finally(() => {
        if (hasGuest) {
          console.log('[Chess DNA Auth] Guest data detected — migrating to Base44...');
          const b44entities = base44.entities as Record<string, any>;
          migrateGuestToBase44(b44entities)
            .then((stats) => {
              console.log('[Chess DNA Auth] Guest data migrated:', stats);
              // Only reload when the migration was 100% clean. On partial failure
              // the unmigrated items are still in localStorage; a reload here would
              // immediately re-trigger the migration and (if Base44 is still
              // throttling) loop forever. Let the user refresh manually instead.
              if (stats.failures === 0) {
                window.location.reload();
              } else {
                console.warn(
                  `[Chess DNA Auth] Guest migration finished with ${stats.failures} failures. ` +
                  `Unmigrated items kept in localStorage. Refresh manually to retry.`,
                );
              }
            })
            .catch((err) => {
              console.error('[Chess DNA Auth] Guest migration failed:', err);
            })
            .finally(() => {
              setAuthResolved(true);
            });
        }
      });
  }, [useDevShortcut, isDev, realMode, token]);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isGuest: !isAuthenticated, userId, userEmail, isAdmin, authResolved, betaStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
