import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { base44 } from '../api/base44Client';
import { en } from '@/i18n/locales/en';
import OrbitDnaLoader from '@/components/OrbitDnaLoader';
import WaitlistGate from '@/components/WaitlistGate';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * AuthGuard gates the app behind authentication AND a closed-beta whitelist.
 *
 * Flow:
 * - Not authenticated → show entry gate (Sign In / Sign Up)
 * - Authenticated, betaStatus 'pending' → loader
 * - Authenticated, betaStatus 'allowed' → pass through
 * - Authenticated, betaStatus 'denied' → waitlist gate (form / thank-you)
 * - Authenticated, betaStatus 'unknown' → "couldn't verify" + Sign Out
 *
 * Guest mode was removed — every visitor must sign in via Base44.
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  const isDev = import.meta.env.DEV;
  const { isAuthenticated, authResolved, betaStatus, userEmail } = useAuth();

  // ?gate=1 lets us preview the EntryGate during local development even though
  // dev-mode normally short-circuits both auth gating and authentication.
  // Dev-only — in production this query param has no effect.
  const forceGate = isDev && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('gate');
  if (forceGate) return <EntryGate />;

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

  // Not authenticated → entry gate (Sign In / Sign Up only — no guest)
  if (!isAuthenticated) {
    return <EntryGate />;
  }

  // Authenticated → wait for the beta-status decision before rendering anything
  if (betaStatus === 'pending') {
    return (
      <div className="fixed inset-0 z-30 bg-chess-bg flex items-center justify-center">
        <OrbitDnaLoader size={96} caption="Checking access..." />
      </div>
    );
  }

  if (betaStatus === 'denied' || betaStatus === 'unknown') {
    // 'unknown' — auth.me failed AND the JWT had no email claim. Treat as
    // denied: WaitlistGate's email field will be blank, and the component
    // shows a sign-out path so the user can try again.
    return <WaitlistGate email={userEmail ?? ''} />;
  }

  // betaStatus === 'allowed' → use app
  return <>{children}</>;
}

/**
 * Entry gate — shown when user has no Base44 token. Sign In / Sign Up only;
 * guest mode was removed for the closed beta.
 */
function EntryGate() {
  type AuthStep = 'providers' | 'signin' | 'signup';
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authStep, setAuthStep] = useState<AuthStep>('providers');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const openAuthModal = () => {
    setAuthStep('providers');
    setAuthError(null);
    setAuthModalOpen(true);
  };
  const closeAuthModal = () => {
    setAuthModalOpen(false);
    // Reset form state after the close animation so it doesn't flash to the user.
    window.setTimeout(() => {
      setAuthStep('providers');
      setEmail('');
      setPassword('');
      setAuthError(null);
      setSubmitting(false);
    }, 200);
  };

  const continueWithGoogle = () => {
    base44.auth.loginWithProvider('google', window.location.href);
  };

  const continueWithApple = () => {
    base44.auth.loginWithProvider('apple', window.location.href);
  };

  const continueWithFacebook = () => {
    base44.auth.loginWithProvider('facebook', window.location.href);
  };

  const continueWithEmail = () => {
    setAuthError(null);
    setAuthStep('signin');
  };

  // Best-effort, friendly error message from Base44/axios errors.
  const friendlyError = (err: unknown, fallback: string): string => {
    if (err && typeof err === 'object') {
      const anyErr = err as Record<string, unknown>;
      const resp = anyErr.response as { status?: number; data?: Record<string, unknown> } | undefined;
      const data = resp?.data;
      const message = (data?.message as string) || (data?.detail as string) || (anyErr.message as string);
      if (typeof message === 'string' && message.length > 0) return message;
    }
    return fallback;
  };

  const submitSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setAuthError(null);
    setSubmitting(true);
    try {
      await base44.auth.loginViaEmailPassword(email.trim(), password);
      // Token is set by the SDK; reload so AuthContext re-initializes.
      window.location.reload();
    } catch (err) {
      setAuthError(friendlyError(err, 'Sign-in failed. Check your email and password.'));
      setSubmitting(false);
    }
  };

  const submitSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 8) {
      setAuthError('Password must be at least 8 characters.');
      return;
    }
    setAuthError(null);
    setSubmitting(true);
    try {
      await base44.auth.register({ email: email.trim(), password });
      // Some apps require email/OTP confirmation before login works. Try to log in
      // immediately; if that fails, surface the message so the user can verify their email.
      try {
        await base44.auth.loginViaEmailPassword(email.trim(), password);
        window.location.reload();
      } catch (loginErr) {
        setAuthError(friendlyError(
          loginErr,
          'Account created. Check your inbox to verify your email, then sign in.',
        ));
        setAuthStep('signin');
        setPassword('');
        setSubmitting(false);
      }
    } catch (err) {
      setAuthError(friendlyError(err, 'Sign-up failed. Try a different email.'));
      setSubmitting(false);
    }
  };

  // Close modal on Escape
  useEffect(() => {
    if (!authModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAuthModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authModalOpen]);

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

            <div className="w-full max-w-sm mt-5 md:mt-6 space-y-3">
              {/* Sign In — primary */}
              <button
                onClick={openAuthModal}
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
                onClick={openAuthModal}
                className="w-full py-3.5 rounded-2xl border-2 border-chess-accent/40 bg-transparent text-chess-accent font-bold uppercase tracking-wide text-xs hover:bg-chess-accent/10 hover:border-chess-accent/60 active:translate-y-0.5 transition-all"
              >
                {t('gate_create_account') || 'Sign Up'}
              </button>

              <p className="text-center text-[11px] text-gray-500 pt-1">
                Closed beta — sign-up is by invitation. Not invited? Sign up anyway and we'll add you to the waitlist.
              </p>
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

      {/* Sign-in modal — overlays the LP, Suggestafeature style */}
      {authModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-5 py-8 animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-modal-title"
        >
          {/* Backdrop — click to close */}
          <button
            type="button"
            aria-label="Close sign-in"
            onClick={closeAuthModal}
            className="absolute inset-0 w-full h-full bg-black/55 backdrop-blur-md cursor-default"
          />

          {/* Card */}
          <div
            className="relative w-full max-w-md rounded-3xl border border-white/10 bg-chess-surface/95 backdrop-blur-2xl shadow-[0_24px_80px_-12px_rgba(0,0,0,0.7)] overflow-hidden animate-scale-in"
          >
            {/* Close X */}
            <button
              type="button"
              aria-label="Close"
              onClick={closeAuthModal}
              className="absolute top-3 end-3 w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-chess-text hover:bg-white/[0.06] transition-colors z-10"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <div className="px-7 py-8 md:px-9 md:py-10 flex flex-col items-center">
              {/* Logo */}
              <div
                className="mb-5"
                style={{ filter: 'drop-shadow(0 0 24px rgba(74,222,128,0.4))' }}
              >
                <img
                  src="/favicon.png"
                  alt="Chess DNA"
                  className="w-16 h-16 rounded-2xl ring-1 ring-white/15"
                />
              </div>

              <h2
                id="auth-modal-title"
                className="text-xl md:text-[22px] font-bold tracking-tight text-chess-text text-center"
              >
                {authStep === 'signup' ? 'Create your account' : 'Sign in to Chess DNA'}
              </h2>

              <p className="mt-2 text-sm text-chess-text-secondary text-center leading-relaxed max-w-xs">
                Track your patterns and progress across sessions.
              </p>

              {authStep === 'providers' && (
                <div className="w-full mt-7 space-y-3">
                  {/* Continue with Google */}
                  <button
                    onClick={continueWithGoogle}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.04] text-chess-text font-medium text-sm hover:bg-white/[0.08] hover:border-white/20 active:translate-y-0.5 transition-all"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.12A6.97 6.97 0 0 1 5.47 12c0-.74.13-1.46.36-2.12V7.04H2.18A10.96 10.96 0 0 0 1 12c0 1.78.43 3.46 1.18 4.96l3.66-2.84z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
                    </svg>
                    <span>Continue with Google</span>
                  </button>

                  {/* Continue with Apple */}
                  <button
                    onClick={continueWithApple}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.04] text-chess-text font-medium text-sm hover:bg-white/[0.08] hover:border-white/20 active:translate-y-0.5 transition-all"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden>
                      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                    </svg>
                    <span>Continue with Apple</span>
                  </button>

                  {/* Continue with Facebook */}
                  <button
                    onClick={continueWithFacebook}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.04] text-chess-text font-medium text-sm hover:bg-white/[0.08] hover:border-white/20 active:translate-y-0.5 transition-all"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
                      <path fill="#1877F2" d="M24 12c0-6.63-5.37-12-12-12S0 5.37 0 12c0 5.99 4.39 10.95 10.13 11.85V15.47H7.08V12h3.05V9.36c0-3.01 1.79-4.67 4.53-4.67 1.31 0 2.69.23 2.69.23v2.96h-1.52c-1.49 0-1.96.93-1.96 1.87V12h3.33l-.53 3.47h-2.8v8.38C19.61 22.95 24 17.99 24 12z" />
                    </svg>
                    <span>Continue with Facebook</span>
                  </button>

                  {/* Continue with Email */}
                  <button
                    onClick={continueWithEmail}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.04] text-chess-text font-medium text-sm hover:bg-white/[0.08] hover:border-white/20 active:translate-y-0.5 transition-all"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-chess-text-secondary" aria-hidden>
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="M3 7l9 6 9-6" />
                    </svg>
                    <span>Continue with email</span>
                  </button>
                </div>
              )}

              {(authStep === 'signin' || authStep === 'signup') && (
                <form
                  onSubmit={authStep === 'signin' ? submitSignIn : submitSignUp}
                  className="w-full mt-7 space-y-3"
                >
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    className="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/[0.04] text-chess-text placeholder:text-gray-500 focus:outline-none focus:border-chess-accent/50 focus:bg-white/[0.06] disabled:opacity-60"
                  />
                  <input
                    type="password"
                    name="password"
                    autoComplete={authStep === 'signin' ? 'current-password' : 'new-password'}
                    required
                    placeholder={authStep === 'signup' ? 'Choose a password (8+ chars)' : 'Password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    minLength={authStep === 'signup' ? 8 : undefined}
                    className="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/[0.04] text-chess-text placeholder:text-gray-500 focus:outline-none focus:border-chess-accent/50 focus:bg-white/[0.06] disabled:opacity-60"
                  />

                  {authError && (
                    <p className="text-[12px] text-red-400 text-center" role="alert">
                      {authError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="group relative w-full overflow-hidden bg-chess-accent text-chess-bg font-bold uppercase tracking-wide px-6 py-3 rounded-xl text-sm transition-all shadow-[0_4px_0_rgb(21,128,61)] hover:brightness-110 active:translate-y-0.5 active:shadow-[0_2px_0_rgb(21,128,61)] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {submitting
                      ? (authStep === 'signin' ? 'Signing in…' : 'Creating account…')
                      : (authStep === 'signin' ? 'Sign in' : 'Create account')}
                  </button>

                  <div className="pt-1 text-center">
                    {authStep === 'signin' ? (
                      <p className="text-[12px] text-chess-text-secondary">
                        No account?{' '}
                        <button
                          type="button"
                          onClick={() => { setAuthError(null); setPassword(''); setAuthStep('signup'); }}
                          className="text-chess-accent font-semibold hover:underline"
                        >
                          Create one
                        </button>
                      </p>
                    ) : (
                      <p className="text-[12px] text-chess-text-secondary">
                        Already have one?{' '}
                        <button
                          type="button"
                          onClick={() => { setAuthError(null); setPassword(''); setAuthStep('signin'); }}
                          className="text-chess-accent font-semibold hover:underline"
                        >
                          Sign in
                        </button>
                      </p>
                    )}
                  </div>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => { setAuthError(null); setAuthStep('providers'); }}
                      className="inline-flex items-center gap-1 text-[12px] text-gray-400 hover:text-chess-text transition-colors"
                    >
                      <span aria-hidden>←</span> Other options
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Footer */}
            <div className="px-7 md:px-9 py-4 border-t border-white/[0.06] bg-white/[0.02]">
              <p className="text-center text-[11px] text-gray-500 leading-relaxed">
                Closed beta — sign-up is by invitation. Not invited? Sign up anyway and we'll add you to the waitlist.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

