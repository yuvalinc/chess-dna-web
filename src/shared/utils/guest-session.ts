/**
 * Guest session tracking — manages the 1-week guest trial window.
 *
 * When a user clicks "Try as Guest", we record a timestamp.
 * After 7 days, the session expires and signup is required.
 */

// IMPORTANT: This key must NOT start with 'chess-dna-guest-' because
// that prefix is used by hasGuestData() to detect entity data for migration.
// Using that prefix causes false migrations for authenticated users.
const GUEST_SESSION_KEY = 'chess-dna-trial-session-started';
const GUEST_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Start a new guest session (records current timestamp). */
export function startGuestSession(): void {
  try {
    localStorage.setItem(GUEST_SESSION_KEY, String(Date.now()));
  } catch { /* localStorage unavailable */ }
}

/** Get the timestamp when the guest session started, or null if none. */
export function getGuestSessionStartedAt(): number | null {
  try {
    const raw = localStorage.getItem(GUEST_SESSION_KEY);
    if (!raw) return null;
    const ts = parseInt(raw, 10);
    return isNaN(ts) ? null : ts;
  } catch {
    return null;
  }
}

/** Whether a guest session has been started (regardless of expiry). */
export function hasGuestSession(): boolean {
  return getGuestSessionStartedAt() !== null;
}

/** Whether the guest session is active (started AND within 24h). */
export function isGuestSessionActive(): boolean {
  const started = getGuestSessionStartedAt();
  if (started === null) return false;
  return Date.now() - started < GUEST_EXPIRY_MS;
}

/** Whether the guest session has expired (started AND past 24h). */
export function isGuestSessionExpired(): boolean {
  const started = getGuestSessionStartedAt();
  if (started === null) return false;
  return Date.now() - started >= GUEST_EXPIRY_MS;
}

/** How much time remains in the guest session (in ms), or 0 if expired/no session. */
export function guestSessionRemainingMs(): number {
  const started = getGuestSessionStartedAt();
  if (started === null) return 0;
  return Math.max(0, GUEST_EXPIRY_MS - (Date.now() - started));
}

/** Clear the guest session (used after successful signup/login). */
export function clearGuestSession(): void {
  try {
    localStorage.removeItem(GUEST_SESSION_KEY);
  } catch { /* ignore */ }
}
