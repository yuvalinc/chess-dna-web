/**
 * Closed-beta waitlist gate.
 *
 * Shown to authenticated users whose email isn't on the BETA_TESTERS list.
 * - First visit: collect their details (name, ELO, platform) and create a
 *   BetaWaitlist record in Base44.
 * - Already submitted: thank-you state read straight from the saved record.
 * - JWT fallback failed: "we couldn't verify you" with a sign-out button.
 */
import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

type GateState = 'loading' | 'form' | 'submitting' | 'thanks' | 'error';

interface WaitlistRecord {
  id: string;
  email?: string;
  fullName?: string;
  elo?: number;
  platform?: string;
  status?: string;
}

const entities = base44.entities as Record<string, any>;

interface Props {
  /** The user's email from auth — used to look up an existing record + lock the field. */
  email: string;
}

export default function WaitlistGate({ email }: Props) {
  const [state, setState] = useState<GateState>('loading');
  const [existing, setExisting] = useState<WaitlistRecord | null>(null);

  // Form state
  const [fullName, setFullName] = useState('');
  const [elo, setElo] = useState('');
  const [platform, setPlatform] = useState<'android' | 'iphone'>('android');
  const [submitError, setSubmitError] = useState<string | null>(null);

  // On mount: look up existing waitlist record by email so we don't show the
  // form again on revisit. RLS allows users to read their own records.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const records = await entities.BetaWaitlist.filter({ email });
        if (!alive) return;
        const found = Array.isArray(records) && records.length > 0 ? records[0] : null;
        if (found) {
          setExisting(found);
          setState('thanks');
        } else {
          setState('form');
        }
      } catch (err) {
        console.warn('[WaitlistGate] Lookup failed:', err);
        if (!alive) return;
        // If the lookup fails we still show the form — better to risk a duplicate
        // entry than block the user from joining the list.
        setState('form');
      }
    })();
    return () => { alive = false; };
  }, [email]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!fullName.trim()) {
      setSubmitError('Please enter your name');
      return;
    }
    setState('submitting');
    try {
      const record = await entities.BetaWaitlist.create({
        email,
        fullName: fullName.trim(),
        elo: elo ? Number(elo) : undefined,
        platform,
        status: 'waiting',
      });
      setExisting(record);
      setState('thanks');
    } catch (err) {
      console.error('[WaitlistGate] Submit failed:', err);
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit. Please try again.');
      setState('form');
    }
  };

  const handleSignOut = () => {
    base44.auth.logout();
  };

  return (
    <div className="min-h-screen bg-chess-bg flex items-center justify-center px-4 py-8" data-theme="dark">
      <div className="max-w-md w-full">
        <div className="text-center mb-6">
          <img src="/favicon.png" alt="Chess DNA" width={64} height={64} className="rounded-2xl inline-block mb-4" />
          <h1 className="text-chess-accent font-black text-xl tracking-tight">Chess DNA</h1>
        </div>

        {state === 'loading' && (
          <div className="text-center text-chess-text-secondary text-sm py-8">
            Checking your access…
          </div>
        )}

        {state === 'form' && (
          <div className="bg-chess-surface border border-chess-border rounded-2xl p-6">
            <h2 className="text-xl font-bold text-chess-text mb-2">Sorry — you're not in the beta yet</h2>
            <p className="text-sm text-chess-text-secondary mb-5">
              We're currently running a closed beta with a small group. Want to be notified when we open up to more users?
              Drop your details below and we'll reach out.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-chess-text-secondary mb-1.5">Full name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  autoFocus
                  className="w-full bg-chess-bg border border-chess-border rounded-lg px-3 py-2 text-sm text-chess-text focus:outline-none focus:border-chess-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-chess-text-secondary mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full bg-chess-bg/60 border border-chess-border rounded-lg px-3 py-2 text-sm text-chess-text-secondary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-chess-text-secondary mb-1.5">
                  Chess.com / Lichess ELO <span className="text-gray-500 font-normal">(optional)</span>
                </label>
                <input
                  type="number"
                  value={elo}
                  onChange={(e) => setElo(e.target.value)}
                  placeholder="e.g. 1200"
                  min={0}
                  max={3500}
                  className="w-full bg-chess-bg border border-chess-border rounded-lg px-3 py-2 text-sm text-chess-text focus:outline-none focus:border-chess-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-chess-text-secondary mb-1.5">Platform</label>
                <div className="flex gap-2">
                  {(['android', 'iphone'] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPlatform(p)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        platform === p
                          ? 'bg-chess-accent/15 text-chess-accent border-chess-accent/40'
                          : 'bg-chess-bg text-chess-text-secondary border-chess-border hover:border-chess-text-secondary'
                      }`}
                    >
                      {p === 'android' ? 'Android' : 'iPhone'}
                    </button>
                  ))}
                </div>
              </div>

              {submitError && (
                <p className="text-xs text-chess-blunder">{submitError}</p>
              )}

              <button
                type="submit"
                className="w-full bg-chess-accent text-chess-bg font-bold uppercase tracking-wide py-3 rounded-xl text-sm hover:brightness-110 transition-all"
              >
                Notify me
              </button>
            </form>

            <button
              onClick={handleSignOut}
              className="block mx-auto mt-4 text-xs text-gray-500 hover:text-chess-text-secondary transition-colors"
            >
              Sign out and try a different email
            </button>
          </div>
        )}

        {state === 'submitting' && (
          <div className="text-center text-chess-text-secondary text-sm py-8">
            Saving…
          </div>
        )}

        {state === 'thanks' && (
          <div className="bg-chess-surface border border-chess-border rounded-2xl p-6 text-center">
            <div className="text-3xl mb-3">✓</div>
            <h2 className="text-xl font-bold text-chess-text mb-2">You're on the waitlist</h2>
            <p className="text-sm text-chess-text-secondary mb-5">
              {existing?.fullName ? `Thanks, ${existing.fullName}. ` : ''}
              We'll email <span className="text-chess-text">{email}</span> as soon as we open up to more users.
            </p>
            <button
              onClick={handleSignOut}
              className="text-xs text-gray-500 hover:text-chess-text-secondary transition-colors"
            >
              Sign out
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="bg-chess-surface border border-chess-border rounded-2xl p-6 text-center">
            <h2 className="text-xl font-bold text-chess-text mb-2">Something went wrong</h2>
            <p className="text-sm text-chess-text-secondary mb-5">
              We couldn't verify your account. Please try signing in again.
            </p>
            <button
              onClick={handleSignOut}
              className="bg-chess-accent text-chess-bg font-bold uppercase tracking-wide px-6 py-2.5 rounded-xl text-sm hover:brightness-110 transition-all"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
