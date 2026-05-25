import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import SeoAdmin from './SeoAdmin';
import RedditAdmin from './RedditAdmin';
import InsightsAdmin from './InsightsAdmin';

// Thin tabbed wrapper at /seo. Each tab renders a self-contained admin page
// (each handles its own PAT + data fetching — they share the same PAT key
// in localStorage so connecting once works for both).
//
// Tab state lives in ?tab so the active tab is bookmarkable.
//   /seo            → SEO daily
//   /seo?tab=reddit → ReddGrow
//
// PAT bootstrap on production: visiting /seo#pat=<gh-token> writes the token
// to localStorage and reloads, so the user never has to type into the
// PatSetup screen. The fragment is stripped from the URL before reload so
// it's not left in browser history or shareable URLs. Fragments don't go
// to the server, so this never reaches Base44 / network logs.

const PAT_STORAGE_KEY = 'chess-dna:seo-gh-pat';

type TabKey = 'seo' | 'reddit' | 'insights';
const TABS: Array<{ key: TabKey; label: string; hint: string }> = [
  { key: 'seo',      label: 'SEO daily',  hint: 'On-site SEO tasks the daily agent produces' },
  { key: 'reddit',   label: 'ReddGrow',   hint: 'AI-drafted Reddit comments ready to copy & post' },
  { key: 'insights', label: 'Insights',   hint: 'AI visibility (kw.com) + Reddit brand mentions' },
];

// Capture #pat=… from the URL fragment, save it, and clean the URL.
// Runs synchronously before React paints so the user never sees the
// PatSetup screen on the bootstrap visit.
function consumePatFragment(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash;
  const m = hash.match(/[#&]pat=([^&]+)/);
  if (!m) return false;
  try {
    const token = decodeURIComponent(m[1]);
    if (token && token.length >= 20) {
      localStorage.setItem(PAT_STORAGE_KEY, token);
    }
  } catch {
    // ignore — fall through to strip the fragment anyway
  }
  // Strip the pat param from the fragment; preserve any other fragment data.
  const cleaned = hash.replace(/[#&]pat=[^&]*/, '').replace(/^#$/, '');
  const newUrl = window.location.pathname + window.location.search + (cleaned.startsWith('#') ? cleaned : '');
  window.history.replaceState({}, '', newUrl);
  return true;
}

export default function SeoShell() {
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: TabKey = rawTab === 'reddit' ? 'reddit' : rawTab === 'insights' ? 'insights' : 'seo';
  const [bootstrapped, setBootstrapped] = useState(false);

  // Bootstrap PAT from URL fragment on first render. Uses a state flag to
  // force a re-render once the localStorage has been written (so getPat()
  // in the inner components reads the new value).
  useEffect(() => {
    if (!bootstrapped) {
      consumePatFragment();
      setBootstrapped(true);
    }
  }, [bootstrapped]);

  const setTab = (next: TabKey) => {
    // Preserve other params (none today, but future-proof) and only set ?tab
    // when it's not the default — keeps the canonical /seo URL clean.
    const nextParams = new URLSearchParams(params);
    if (next === 'seo') nextParams.delete('tab');
    else nextParams.set('tab', next);
    setParams(nextParams, { replace: true });
  };

  // Admin gate sits at the shell level so neither inner page flashes its own
  // "Access Denied" before the parent's check finishes.
  if (isAdmin === null) {
    return <div className="p-8 text-center text-chess-text-tertiary">Loading…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold mb-2">Access Denied</h2>
        <p className="text-chess-text-tertiary">This page is restricted to administrators.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-1 pt-3">
      <nav className="flex gap-1 mb-3 border-b border-chess-border/30" role="tablist">
        {TABS.map(t => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              title={t.hint}
              className={
                'px-4 py-2 text-[13px] font-bold border-b-2 -mb-px transition-colors ' +
                (active
                  ? 'text-chess-accent border-chess-accent'
                  : 'text-chess-text-tertiary border-transparent hover:text-chess-text hover:border-chess-border/40')
              }
            >
              {t.label}
            </button>
          );
        })}
      </nav>
      {tab === 'seo' && <SeoAdmin />}
      {tab === 'reddit' && <RedditAdmin />}
      {tab === 'insights' && <InsightsAdmin />}
    </div>
  );
}
