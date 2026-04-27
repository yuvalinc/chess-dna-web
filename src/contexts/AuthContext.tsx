import { createContext, useContext, useEffect, useState } from 'react';
import { base44 } from '../api/base44Client';
import { hasGuestData, migrateGuestToBase44 } from '@shared/utils/guest-storage';

import { ADMIN_EMAILS } from '@shared/constants';
const ADMIN_EMAIL = 'yuval.inc@gmail.com'; // legacy single check

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
}

// Module-level cache for imperative (non-React) code
let _cachedUserId: string | null = null;

/** Get current user ID synchronously — for use outside React components */
export function getCurrentUserId(): string | null {
  return _cachedUserId;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  isGuest: true,
  userId: null,
  userEmail: null,
  isAdmin: null,
  authResolved: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const isDev = import.meta.env.DEV;

  // Token check is synchronous — we know auth state immediately
  const token = getBase44Token();
  const [isAuthenticated] = useState(() => isDev || !!token);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(isDev ? true : null);
  const [authResolved, setAuthResolved] = useState(false);

  useEffect(() => {
    console.log('[Chess DNA Auth] Init — token:', !!token, 'isDev:', isDev);

    if (isDev) {
      setAuthResolved(true);
      return;
    }

    if (!token) {
      // No token → definitely not authenticated → show landing page
      console.log('[Chess DNA Auth] No token found → unauthenticated');
      setIsAdmin(false);
      setAuthResolved(true);
      return;
    }

    console.log('[Chess DNA Auth] Token found → authenticated, trying auth.me() for user details...');

    // Token exists → user is authenticated.
    // Try auth.me() to get user details (userId, email) for admin check.
    // This may 401 if the app has no User entity — that's fine, we're
    // still authenticated and entity CRUD will work via the token.
    base44.auth
      .me()
      .then((user: Record<string, unknown>) => {
        const id = (user?.id as string) ?? null;
        const email = (user?.email as string) ?? null;
        _cachedUserId = id;
        setUserId(id);
        setUserEmail(email);
        setIsAdmin(email === ADMIN_EMAIL || ADMIN_EMAILS.includes(email ?? ''));
        console.log('[Chess DNA Auth] auth.me() succeeded — userId:', id, 'email:', email);
      })
      .catch((err: unknown) => {
        // auth.me() failed but token exists → still authenticated
        // Just can't determine admin status or userId
        console.log('[Chess DNA Auth] auth.me() failed (expected if no User entity):', err);
        setIsAdmin(false);
      })
      .finally(() => {
        // Migrate guest data to Base44 if user just logged in after guest session
        if (hasGuestData()) {
          console.log('[Chess DNA Auth] Guest data detected — migrating to Base44...');
          const b44entities = base44.entities as Record<string, any>;
          migrateGuestToBase44(b44entities)
            .then((stats) => {
              console.log('[Chess DNA Auth] Guest data migrated:', stats);
              // Force reload to refresh all entity hooks with Base44 data
              window.location.reload();
            })
            .catch((err) => {
              console.error('[Chess DNA Auth] Guest migration failed:', err);
            })
            .finally(() => {
              setAuthResolved(true);
            });
        } else {
          setAuthResolved(true);
        }
        console.log('[Chess DNA Auth] authResolved=true, isAuthenticated=true');
      });
  }, [isDev, token]);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isGuest: !isAuthenticated, userId, userEmail, isAdmin, authResolved }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
