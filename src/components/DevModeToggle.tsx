/* ────────────────────────────────────────────────────────────────────────
 *  DevModeToggle — floating panel rendered only when `import.meta.env.DEV`.
 *
 *  Why: by default the local dev server short-circuits auth (always
 *  authenticated, always admin, no real Base44 token). That's great for
 *  rapid UI iteration but useless for testing anything that depends on
 *  real entity CRUD, RLS, analytics writes, or admin gating against a
 *  real email. This toggle flips a localStorage flag (`chess-dna-real-
 *  mode`) that the AuthContext respects, then loads a Base44 access
 *  token so requests against the real backend succeed.
 *
 *  Three modes:
 *    • DEV  — shortcut auth, no real backend writes (fast UI iteration).
 *    • REAL — real mode, bring-your-own token (paste from any account).
 *    • ME   — real mode, one-click sign-in using a token stored in
 *             `localStorage['dev-auth-token']`. Per-browser, never in
 *             any shipped bundle.
 *
 *  ME-mode workflow:
 *    1) Once per dev browser, in DevTools console:
 *         localStorage.setItem('dev-auth-token', 'eyJ...your.jwt...')
 *    2) Refresh the page. The "Me" button now enables.
 *    3) Click it. Real-mode + your token are applied and the page reloads.
 *
 *  Why localStorage and not a VITE_* env var:
 *    Vite inlines every VITE_* variable into `import.meta.env` for any
 *    code path that could reference it, regardless of `import.meta.env.DEV`
 *    gates around the usage. A previous version of this file used
 *    `VITE_DEV_AUTH_TOKEN` and the dev JWT leaked into the prod bundle
 *    on 2026-05-25. localStorage is per-browser so no leak is possible.
 * ──────────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react';

const REAL_MODE_KEY = 'chess-dna-real-mode';
const TOKEN_KEY = 'base44_access_token';
const ME_TOKEN_KEY = 'dev-auth-token';

/**
 * Token source for "Sign in as me" mode. Previously this came from
 * VITE_DEV_AUTH_TOKEN in .env.local — but Vite inlines every VITE_*
 * env var into the bundle regardless of dead-code-elimination, so the
 * dev JWT leaked to all chessdna.app visitors. Switched to reading
 * from localStorage instead — per-browser, never in any shipped bundle.
 *
 * To enable on a dev machine, paste this once in DevTools:
 *   localStorage.setItem('dev-auth-token', 'eyJ...your.base44.jwt...')
 *
 * Then the "Me" button copies that into `base44_access_token` and
 * flips real-mode on. Re-read every render so the user can pop open
 * DevTools, set the value, and the button enables without a reload.
 */
function readMeToken(): string {
  // Belt-and-suspenders: also gate on DEV so even the localStorage read
  // can't happen in a prod build that somehow ships this component.
  if (!import.meta.env.DEV) return '';
  try {
    return localStorage.getItem(ME_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Best-effort decode of the JWT `sub` claim (Base44 puts the email there). */
function decodeJwtEmail(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    const email = typeof payload.email === 'string' ? payload.email : null;
    return email ?? (sub && sub.includes('@') ? sub : null);
  } catch {
    return null;
  }
}
// Email / short-name are derived per render from whatever's currently in
// localStorage so that pasting the token in DevTools updates the button
// label without a refresh.
function getMeEmail(token: string): string | null {
  return token ? decodeJwtEmail(token) : null;
}
function getMeShort(email: string | null): string {
  return email ? email.split('@')[0].split('.')[0] : 'me';
}

function readRealMode(): boolean {
  try {
    return localStorage.getItem(REAL_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}
function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function DevModeToggle() {
  const isDev = import.meta.env.DEV;
  const [open, setOpen] = useState(false);
  const [realMode] = useState<boolean>(() => readRealMode());
  const [tokenInput, setTokenInput] = useState<string>('');
  const [tokenPresent, setTokenPresent] = useState<boolean>(() => readToken().length > 0);

  useEffect(() => {
    if (!isDev) return;
    setTokenPresent(readToken().length > 0);
  }, [isDev]);

  if (!isDev) return null;

  const apply = (nextRealMode: boolean, nextToken?: string) => {
    try {
      if (nextRealMode) localStorage.setItem(REAL_MODE_KEY, 'true');
      else localStorage.removeItem(REAL_MODE_KEY);
      if (typeof nextToken === 'string') {
        if (nextToken.trim()) localStorage.setItem(TOKEN_KEY, nextToken.trim());
        else localStorage.removeItem(TOKEN_KEY);
      }
    } catch { /* ignore */ }
    window.location.reload();
  };

  const clearToken = () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    window.location.reload();
  };

  // "ME" mode is real-mode + the current token equals the localStorage
  // dev-auth-token. Re-read both per render so the user can paste a
  // token into DevTools and the UI updates without a reload.
  const currentToken = readToken();
  const meToken = readMeToken();
  const meEmail = getMeEmail(meToken);
  const meShort = getMeShort(meEmail);
  const isMe = realMode && tokenPresent && !!meToken && currentToken === meToken;

  const dotColor = isMe
    ? '#22d3ee' // cyan for ME
    : realMode
      ? (tokenPresent ? '#4ade80' : '#fbbf24')
      : '#64748b';
  const modeLabel = isMe
    ? `ME · ${meShort}`
    : realMode
      ? (tokenPresent ? 'REAL' : 'REAL · no token')
      : 'DEV';

  return (
    <div
      className="fixed z-[200] bottom-3 left-3 select-none"
      style={{ fontFamily: 'ui-sans-serif, system-ui' }}
    >
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 border border-white/15 text-[11px] font-bold text-white/80 hover:text-white hover:border-white/30 backdrop-blur transition-colors shadow-lg"
          aria-label="Dev mode"
        >
          <span
            className="inline-block rounded-full"
            style={{ width: 8, height: 8, background: dotColor }}
          />
          {modeLabel}
        </button>
      ) : (
        <div
          className="bg-black/85 border border-white/20 rounded-xl p-3 backdrop-blur shadow-2xl text-white text-[12px]"
          style={{ width: 320 }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: dotColor }} />
              <span className="font-extrabold tracking-wider uppercase text-[10px]">Dev mode</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-white/50 hover:text-white text-[14px] leading-none -me-1"
              aria-label="Close"
            >×</button>
          </div>

          {/* Mode switch — three options:
              DEV  = shortcut auth (no real backend writes)
              REAL = real-mode, bring-your-own token
              ME   = real-mode, pre-baked token from VITE_DEV_AUTH_TOKEN */}
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            <button
              type="button"
              onClick={() => apply(false, '')}
              className={`py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                !realMode ? 'bg-blue-500/25 text-blue-300 border border-blue-400/40' : 'bg-white/5 border border-white/10 text-white/60 hover:text-white'
              }`}
            >
              Dev
            </button>
            <button
              type="button"
              onClick={() => apply(true)}
              className={`py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                realMode && !isMe ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-400/40' : 'bg-white/5 border border-white/10 text-white/60 hover:text-white'
              }`}
            >
              Real
            </button>
            <button
              type="button"
              disabled={!meToken}
              onClick={() => apply(true, meToken)}
              title={meToken
                ? `Sign in as ${meEmail ?? 'me'}`
                : "Set localStorage 'dev-auth-token' to enable"}
              className={`py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                isMe
                  ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-400/40'
                  : meToken
                    ? 'bg-white/5 border border-white/10 text-white/60 hover:text-white'
                    : 'bg-white/5 border border-white/10 text-white/25 cursor-not-allowed'
              }`}
            >
              Me
            </button>
          </div>

          {/* Real-mode panel */}
          {realMode ? (
            <>
              <div className="text-[10px] uppercase tracking-wider font-bold text-white/45 mb-1">Base44 token</div>
              {tokenPresent ? (
                <div className="flex items-center gap-2 mb-2">
                  <span className={`flex-1 truncate font-mono text-[10px] ${isMe ? 'text-cyan-300' : 'text-emerald-300'}`}>
                    {isMe ? `●●●●●●●● ${meEmail ?? 'me'}` : '●●●●●●●● token loaded'}
                  </span>
                  <button
                    type="button"
                    onClick={clearToken}
                    className="text-[10px] text-white/60 hover:text-white px-2 py-0.5 rounded border border-white/15"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <div className="mb-2">
                  <textarea
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="Paste your base44_access_token"
                    rows={3}
                    className="w-full bg-white/5 border border-white/15 rounded-md px-2 py-1.5 text-[11px] font-mono text-white placeholder:text-white/30 resize-y focus:outline-none focus:border-emerald-400/60"
                  />
                  <button
                    type="button"
                    disabled={!tokenInput.trim()}
                    onClick={() => apply(true, tokenInput)}
                    className="w-full mt-1.5 py-1.5 rounded-md bg-emerald-500/30 hover:bg-emerald-500/40 disabled:opacity-40 text-emerald-200 border border-emerald-400/40 text-[11px] font-bold transition-colors"
                  >
                    Save & reload
                  </button>
                </div>
              )}
              <div className="text-[10px] text-white/45 leading-snug">
                On the deployed site → DevTools → Application → Local Storage → copy
                <span className="font-mono text-white/70"> base44_access_token</span>.
              </div>
            </>
          ) : (
            <div className="text-[10px] text-white/45 leading-snug">
              Dev shortcut: always-authenticated, always-admin, no real Base44 writes.
              Use <b className="text-white/70">Real</b> to paste any user's token, or{' '}
              <b className="text-white/70">Me</b>{meEmail ? <> to one-click sign in as <span className="font-mono text-white/65">{meEmail}</span></> : <> (disabled: set <span className="font-mono text-white/65">localStorage['dev-auth-token']</span> in DevTools)</>}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
