import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { base44 } from '../api/base44Client';
import { useT } from '@/i18n/index';
import { en } from '@/i18n/locales/en';
import OrbitDnaLoader from '@/components/OrbitDnaLoader';
import {
  hasGuestSession,
  isGuestSessionExpired,
  startGuestSession,
} from '@shared/utils/guest-session';
import { hasGuestData } from '@shared/utils/guest-storage';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * AuthGuard gates the app behind authentication OR an explicit guest session.
 *
 * - Authenticated users → always pass through
 * - Guest with active session (< 24h) → pass through
 * - Guest with expired session (>= 24h) → show signup wall (no skip)
 * - No session at all → show entry gate (Sign In / Try as Guest)
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  const isDev = import.meta.env.DEV;
  const { isAuthenticated, authResolved } = useAuth();
  const [guestStarted, setGuestStarted] = useState(() => {
    // Migration: if user has existing guest ENTITY data but no session timestamp,
    // auto-start a session so they aren't locked out.
    // Only do this for non-authenticated users (don't touch guest data for logged-in users).
    if (!hasGuestSession() && hasGuestData()) {
      // Don't start session if there's a Base44 token — user is authenticated
      const hasToken = !!(localStorage.getItem('base44_access_token') || localStorage.getItem('token'));
      if (!hasToken) {
        startGuestSession();
        return true;
      }
    }
    return hasGuestSession();
  });

  // In dev mode, skip gating
  if (isDev) return <>{children}</>;

  // Still loading auth
  if (!authResolved) {
    return (
      <div className="fixed inset-0 z-30 bg-chess-bg flex items-center justify-center">
        <OrbitDnaLoader size={96} caption="Loading your Chess DNA..." />
      </div>
    );
  }

  // Authenticated user → always pass
  if (isAuthenticated) return <>{children}</>;

  // No guest session yet → show entry gate
  if (!guestStarted) {
    return (
      <EntryGate onGuestStart={() => {
        startGuestSession();
        setGuestStarted(true);
      }} />
    );
  }

  // Guest session expired → must sign up
  if (isGuestSessionExpired()) {
    return <ExpiredGuestWall />;
  }

  // Active guest session → pass through
  return <>{children}</>;
}

/**
 * Entry gate — shown when user hasn't chosen login or guest yet.
 * Blocks all routes until they make a choice.
 */
function EntryGate({ onGuestStart }: { onGuestStart: () => void }) {
  const handleLogin = () => {
    base44.auth.redirectToLogin(window.location.href);
  };

  // AuthGuard renders outside I18nProvider, so useT() can't reactively serve
  // translations here. Own the language locally: read from localStorage, load
  // the matching locale via dynamic import, and translate in-place.
  const LANGS: { code: 'en' | 'he' | 'es'; label: string }[] = [
    { code: 'en', label: 'English' },
    { code: 'he', label: 'עברית' },
    { code: 'es', label: 'Español' },
  ];
  const readLang = (): 'en' | 'he' | 'es' => {
    try {
      const v = localStorage.getItem('chess-dna-language');
      if (v === 'en' || v === 'he' || v === 'es') return v;
    } catch { /* ignore */ }
    return 'en';
  };
  const [currentLang, setCurrentLang] = useState<'en' | 'he' | 'es'>(readLang());
  const [strings, setStrings] = useState<Record<string, string>>(en as unknown as Record<string, string>);
  const [showAuthOptions, setShowAuthOptions] = useState(false);
  const isRTL = currentLang === 'he';

  useEffect(() => {
    let alive = true;
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    if (currentLang === 'en') {
      setStrings(en as unknown as Record<string, string>);
      return;
    }
    const loader = currentLang === 'he'
      ? () => import('@/i18n/locales/he').then((m) => m.he as unknown as Record<string, string>)
      : () => import('@/i18n/locales/es').then((m) => m.es as unknown as Record<string, string>);
    loader()
      .then((locale) => { if (alive) setStrings(locale); })
      .catch(() => { if (alive) setStrings(en as unknown as Record<string, string>); });
    return () => { alive = false; };
  }, [currentLang, isRTL]);

  const t = (key: string): string => strings[key] ?? (en as unknown as Record<string, string>)[key] ?? key;

  const setLang = (code: 'en' | 'he' | 'es') => {
    try { localStorage.setItem('chess-dna-language', code); } catch { /* ignore */ }
    setCurrentLang(code);
  };

  return (
    <div
      className="min-h-screen bg-[#0a1628] flex flex-col relative overflow-hidden"
      data-theme="dark"
    >
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 40%, rgba(74,222,128,0.10), transparent 60%)',
        }}
      />

      {/* Top bar: wordmark left, lang selector right */}
      <header className="relative w-full px-6 md:px-10 pt-5 md:pt-7 flex items-center justify-between gap-4 animate-fade-in">
        <div className="flex items-center gap-2.5">
          <span className="text-chess-accent font-black text-lg md:text-xl tracking-tight">
            Chess DNA
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {LANGS.map((lang) => (
            <button
              key={lang.code}
              onClick={() => setLang(lang.code)}
              className={`px-2.5 py-1 rounded-md text-[11px] md:text-xs font-medium transition-all ${
                currentLang === lang.code
                  ? 'bg-chess-accent/15 text-chess-accent border border-chess-accent/30'
                  : 'text-gray-500 border border-transparent hover:text-chess-text'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main: split on desktop, stacked on mobile */}
      <main className="relative flex-1 flex flex-col items-center px-6 py-6 md:py-10">
        <div className="flex-1 flex items-center justify-center w-full">
        <div className="grid grid-cols-1 md:grid-cols-[auto_auto] gap-8 md:gap-14 items-center md:items-start justify-center mx-auto max-w-5xl">
          {/* Logo */}
          <div className="flex justify-center md:justify-end">
            <div
              className="animate-scale-in"
              style={{ filter: 'drop-shadow(0 0 60px rgba(74,222,128,0.35))' }}
            >
              <img
                src="/favicon.png"
                alt="Chess DNA"
                className="w-36 h-36 md:w-52 md:h-52 rounded-[28px] md:rounded-[36px] ring-1 ring-white/10"
              />
            </div>
          </div>

          {/* Text + CTAs */}
          <div
            className="flex flex-col items-center md:items-start rtl:md:items-end text-center md:text-start animate-fade-in-up max-w-md"
            style={{ animationDelay: '0.1s' }}
          >
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-chess-text leading-snug">
              {t('gate_desc')}
            </h1>

            <div className="w-full max-w-sm mt-5 md:mt-6 space-y-3 min-h-[168px]">
              {!showAuthOptions ? (
                <button
                  onClick={() => setShowAuthOptions(true)}
                  className="group relative w-full overflow-hidden bg-chess-accent text-chess-bg font-bold uppercase tracking-wide px-6 py-3.5 rounded-2xl text-sm transition-all shadow-[0_5px_0_rgb(21,128,61)] hover:brightness-110 active:translate-y-0.5 active:shadow-[0_2px_0_rgb(21,128,61)] animate-fade-in-up"
                >
                  <span className="relative z-10">{t('s0_get_started')}</span>
                  <span
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-[900ms] ease-out"
                  />
                </button>
              ) : (
                <div className="space-y-3 animate-fade-in-up">
                  {/* Sign In — primary */}
                  <button
                    onClick={handleLogin}
                    className="group relative w-full overflow-hidden bg-chess-accent text-chess-bg font-bold uppercase tracking-wide px-6 py-3.5 rounded-2xl text-sm transition-all shadow-[0_5px_0_rgb(21,128,61)] hover:brightness-110 active:translate-y-0.5 active:shadow-[0_2px_0_rgb(21,128,61)]"
                  >
                    <span className="relative z-10">{t('gate_sign_in')}</span>
                    <span
                      aria-hidden
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-[900ms] ease-out"
                    />
                  </button>

                  {/* Sign Up — secondary outlined */}
                  <button
                    onClick={handleLogin}
                    className="w-full py-3.5 rounded-2xl border-2 border-chess-accent/40 bg-transparent text-chess-accent font-bold uppercase tracking-wide text-xs hover:bg-chess-accent/10 hover:border-chess-accent/60 active:translate-y-0.5 transition-all"
                  >
                    {t('gate_create_account') || 'Sign Up'}
                  </button>

                  {/* Guest — tertiary subtle */}
                  <button
                    onClick={onGuestStart}
                    className="w-full py-2.5 rounded-2xl border border-white/10 bg-white/[0.02] text-gray-400 font-semibold text-xs hover:text-chess-text hover:border-white/20 hover:bg-white/[0.05] active:translate-y-0.5 transition-all"
                  >
                    {t('gate_try_guest')}
                    <span className="block text-[10px] text-gray-500 mt-0.5 font-normal">
                      {t('gate_guest_free')}
                    </span>
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
        </div>

        {/* Feature highlights — below hero */}
        <div
          className="w-full max-w-3xl grid grid-cols-3 gap-3 md:gap-5 animate-fade-in-up mt-10 md:mt-14"
          style={{ animationDelay: '0.25s' }}
        >
          {[
            {
              label: t('s0_reveal'),
              icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 md:w-7 md:h-7">
                  <polygon points="12 2 19.5 8 17.5 17 6.5 17 4.5 8" opacity="0.25" fill="currentColor" />
                  <polygon points="12 2 19.5 8 17.5 17 6.5 17 4.5 8" />
                  <line x1="12" y1="2" x2="12" y2="12" /><line x1="19.5" y1="8" x2="12" y2="12" />
                  <line x1="17.5" y1="17" x2="12" y2="12" /><line x1="6.5" y1="17" x2="12" y2="12" />
                  <line x1="4.5" y1="8" x2="12" y2="12" />
                </svg>
              ),
            },
            {
              label: t('s0_patterns'),
              icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 md:w-7 md:h-7">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <path d="M8 8l2 4 2-3 2 2" opacity="0.8" />
                </svg>
              ),
            },
            {
              label: t('s0_practice'),
              icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 md:w-7 md:h-7">
                  <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
              ),
            },
          ].map((feat, i) => (
            <div
              key={i}
              className="flex flex-col items-center text-center gap-2.5 md:gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-4 md:px-4 md:py-5 hover:border-chess-accent/25 hover:bg-chess-accent/[0.04] transition-colors"
            >
              <div className="flex items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-xl bg-chess-accent/10 text-chess-accent ring-1 ring-chess-accent/20">
                {feat.icon}
              </div>
              <p className="text-[11px] md:text-[13px] font-semibold text-chess-text-secondary leading-tight whitespace-normal">
                {feat.label}
              </p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

/**
 * Expired guest wall — shown when the 24h guest trial has ended.
 * No skip option — signup is required to continue.
 */
function ExpiredGuestWall() {
  const { t } = useT();
  const handleLogin = () => {
    base44.auth.redirectToLogin(window.location.href);
  };

  return (
    <div className="min-h-screen bg-chess-bg flex items-center justify-center px-4" data-theme="dark">
      <div className="text-center max-w-md">
        <div className="mb-4">
          <svg className="inline-block text-chess-accent" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <g transform="rotate(45 12 12)"><path d="M8 2c0 6.5 8 12.5 8 19" /><path d="M16 2c0 6.5-8 12.5-8 19" /><line x1="9.2" y1="5.5" x2="14.8" y2="5.5" /><line x1="11" y1="8.5" x2="13" y2="8.5" /><line x1="11" y1="14.5" x2="13" y2="14.5" /><line x1="9.2" y1="17.5" x2="14.8" y2="17.5" /></g>
          </svg>
        </div>
        <h2 className="text-2xl font-bold mb-2 text-chess-text">{t('gate_expired_title')}</h2>
        <p className="text-chess-text-secondary mb-6 max-w-sm mx-auto">{t('gate_expired_desc')}</p>
        <button
          onClick={handleLogin}
          className="bg-chess-accent text-chess-bg font-semibold px-8 py-3 rounded-xl text-lg hover:opacity-90 transition-all shadow-lg"
        >
          {t('gate_create_account')}
        </button>
        <p className="text-gray-600 text-xs mt-4">{t('gate_expired_note')}</p>
      </div>
    </div>
  );
}

/**
 * Auth prompt component — used at S4->S5 transition to ask guests to sign up.
 * Exported for use in Overview.tsx.
 */
export function AuthPrompt({ onSkip }: { onSkip?: () => void }) {
  const handleLogin = () => {
    base44.auth.redirectToLogin(window.location.href);
  };

  return (
    <div className="text-center py-8 px-4">
      <div className="mb-4 flex justify-center">
        <img src="/favicon.png" alt="Chess DNA" width={72} height={72} className="rounded-2xl" />
      </div>
      <h2 className="text-2xl font-bold mb-2 text-chess-text">Save Your Chess DNA</h2>
      <p className="text-chess-text-secondary mb-6 max-w-sm mx-auto">
        Create a free account to save your progress, access your data from any device, and unlock all features.
      </p>
      <button
        onClick={handleLogin}
        className="bg-chess-accent text-chess-bg font-semibold px-8 py-3 rounded-xl text-lg hover:opacity-90 transition-all shadow-lg"
      >
        Create Account
      </button>
      {onSkip && (
        <button
          onClick={onSkip}
          className="block mx-auto mt-3 text-chess-text-tertiary text-sm hover:text-chess-text-secondary transition-colors"
        >
          Continue as guest
        </button>
      )}
    </div>
  );
}
