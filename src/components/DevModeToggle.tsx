/* ────────────────────────────────────────────────────────────────────────
 *  DevModeToggle — floating panel rendered only when `import.meta.env.DEV`.
 *
 *  Why: by default the local dev server short-circuits auth (always
 *  authenticated, always admin, no real Base44 token). That's great for
 *  rapid UI iteration but useless for testing anything that depends on
 *  real entity CRUD, RLS, analytics writes, or admin gating against a
 *  real email. This toggle flips a localStorage flag (`chess-dna-real-
 *  mode`) that the AuthContext respects, then optionally lets you paste
 *  a Base44 access token so requests against the real backend succeed.
 *
 *  Workflow to test as a real user from localhost:
 *    1) Open the deployed site, sign in.
 *    2) DevTools → Application → Local Storage → copy
 *       `base44_access_token`.
 *    3) Paste it here, click "Save & reload".
 *    4) The local app now behaves exactly like production for that user.
 * ──────────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react';

const REAL_MODE_KEY = 'chess-dna-real-mode';
const TOKEN_KEY = 'base44_access_token';

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

  const dotColor = realMode
    ? (tokenPresent ? '#4ade80' : '#fbbf24')
    : '#64748b';
  const modeLabel = realMode ? (tokenPresent ? 'REAL' : 'REAL · no token') : 'DEV';

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

          {/* Mode switch */}
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            <button
              type="button"
              onClick={() => apply(false)}
              className={`py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                !realMode ? 'bg-blue-500/25 text-blue-300 border border-blue-400/40' : 'bg-white/5 border border-white/10 text-white/60 hover:text-white'
              }`}
            >
              Dev shortcut
            </button>
            <button
              type="button"
              onClick={() => apply(true)}
              className={`py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                realMode ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-400/40' : 'bg-white/5 border border-white/10 text-white/60 hover:text-white'
              }`}
            >
              Real user
            </button>
          </div>

          {/* Real-mode panel */}
          {realMode ? (
            <>
              <div className="text-[10px] uppercase tracking-wider font-bold text-white/45 mb-1">Base44 token</div>
              {tokenPresent ? (
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex-1 truncate font-mono text-[10px] text-emerald-300">●●●●●●●● token loaded</span>
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
              Dev shortcut: always-authenticated, always-admin, no Base44 writes.
              Switch to <b className="text-white/70">Real user</b> to test against the live backend.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
