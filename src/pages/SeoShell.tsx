import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import SeoAdmin from './SeoAdmin';
import RedditAdmin from './RedditAdmin';

// Thin tabbed wrapper at /seo. Each tab renders a self-contained admin page
// (each handles its own PAT + data fetching — they share the same PAT key
// in localStorage so connecting once works for both).
//
// Tab state lives in ?tab so the active tab is bookmarkable.
//   /seo            → SEO daily
//   /seo?tab=reddit → ReddGrow

type TabKey = 'seo' | 'reddit';
const TABS: Array<{ key: TabKey; label: string; hint: string }> = [
  { key: 'seo',    label: 'SEO daily',  hint: 'On-site SEO tasks the daily agent produces' },
  { key: 'reddit', label: 'ReddGrow',   hint: 'AI-drafted Reddit comments ready to copy & post' },
];

export default function SeoShell() {
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab: TabKey = params.get('tab') === 'reddit' ? 'reddit' : 'seo';

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
      {tab === 'seo' ? <SeoAdmin /> : <RedditAdmin />}
    </div>
  );
}
