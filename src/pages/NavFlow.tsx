import { useNavigate } from 'react-router-dom';

/**
 * Visual site-map of every route in the app, including each page's
 * internal sub-pages (tab states, phases, or step views like the
 * onboarding's Welcome-step flow).
 */

interface SubPage {
  label: string;
  note?: string;
}

interface PageEntry {
  path?: string;
  title: string;
  description?: string;
  subs?: SubPage[];
  adminOnly?: boolean;
}

interface Group {
  heading: string;
  subheading?: string;
  icon: string;
  tint: 'accent' | 'blue' | 'amber' | 'violet' | 'slate' | 'rose';
  entries: PageEntry[];
}

const GROUPS: Group[] = [
  {
    heading: 'Public (no auth)',
    subheading: 'Reachable without signing in — App Store / GDPR compliance.',
    icon: '\u{1F310}',
    tint: 'slate',
    entries: [
      { path: '/privacy', title: 'Privacy Policy' },
      { path: '/support', title: 'Support' },
      { path: '/data-access-request', title: 'Data Access Request', description: 'GDPR / CCPA data request form.' },
    ],
  },
  {
    heading: 'DNA tab',
    subheading: 'Bottom-nav · default landing · path /',
    icon: '\u{1F9EC}',
    tint: 'accent',
    entries: [
      {
        path: '/',
        title: 'Overview',
        description: 'Skill radar, tier, journey progress, highlights.',
        subs: [
          { label: 'Welcome step 1', note: 'What is Chess DNA' },
          { label: 'Welcome step 2', note: 'How it works' },
          { label: 'Welcome step 3', note: 'AI setup / skip' },
          { label: 'Journey progress', note: 'Stages 0 – 4 unlock chain' },
          { label: 'Radar reveal', note: 'Unlocks at stage 2' },
          { label: 'Time-window tabs', note: 'last-10 / last-50 / all' },
        ],
      },
    ],
  },
  {
    heading: 'Games tab',
    subheading: 'Bottom-nav · recent games + per-game deep-dive.',
    icon: '\u265F\uFE0F',
    tint: 'blue',
    entries: [
      {
        path: '/games',
        title: 'Recent Games',
        description: 'List of imported games with analysis status.',
      },
      {
        path: '/games/:gameId',
        title: 'Game Detail',
        description: 'Move list, eval chart, chessboard, AI commentary.',
        subs: [
          { label: 'Stats', note: 'Accuracy + phase breakdown' },
          { label: 'Key Moments', note: 'Critical turning points' },
          { label: 'Patterns', note: 'Weaknesses surfaced by this game' },
          { label: 'Focus mode', note: 'Hides bottom nav' },
        ],
      },
    ],
  },
  {
    heading: 'Training tab',
    subheading: 'Bottom-nav · groups every training surface.',
    icon: '\u231B',
    tint: 'amber',
    entries: [
      {
        path: '/timemachine',
        title: 'Replays',
        description: 'Replay critical moments from past games.',
        subs: [
          { label: 'Unchecked list' },
          { label: 'Checked list' },
          { label: 'Challenge · leadup' },
          { label: 'Challenge · critical' },
          { label: 'Challenge · evaluating' },
          { label: 'Challenge · scored' },
          { label: 'Challenge · showMistake' },
          { label: 'Challenge · complete' },
        ],
      },
    ],
  },
  {
    heading: 'Compare tab',
    subheading: 'Bottom-nav · benchmarking.',
    icon: '\u{1F4CA}',
    tint: 'violet',
    entries: [
      {
        path: '/compare',
        title: 'Compare',
        description: 'Side-by-side skill comparison.',
        subs: [
          { label: 'Opponents' },
          { label: 'International' },
          { label: 'Top Country' },
        ],
      },
    ],
  },
  {
    heading: 'Deep-link pages',
    subheading: 'No direct nav button — reached from context menus or URLs.',
    icon: '\u{1F517}',
    tint: 'slate',
    entries: [
      { path: '/patterns', title: 'Patterns', description: 'Standalone patterns view.' },
      { path: '/skill', title: 'Skill Studio', description: 'Fine-tune the skill-config model.' },
      {
        path: '/settings',
        title: 'Settings',
        description: 'Account, imports, AI providers, voice, display.',
        subs: [
          { label: 'Profile' },
          { label: 'AI' },
          { label: 'Settings' },
          { label: 'Analytics', note: 'Admin only' },
        ],
      },
      { path: '/nav', title: 'Site Map (this page)', description: 'You are here.' },
    ],
  },
  {
    heading: 'Admin',
    subheading: 'Admin only.',
    icon: '\u{1F6E1}\uFE0F',
    tint: 'rose',
    entries: [
      { path: '/affiliate', title: 'Affiliate Admin', adminOnly: true },
      { path: '/prompts', title: 'Prompts Admin', adminOnly: true },
      { path: '/feedbacks', title: 'Feedback Admin', adminOnly: true },
    ],
  },
];

const TINTS: Record<Group['tint'], { dot: string; text: string; border: string; bg: string }> = {
  accent: { dot: 'bg-chess-accent', text: 'text-chess-accent', border: 'border-chess-accent/30', bg: 'bg-chess-accent/5' },
  blue: { dot: 'bg-sky-400', text: 'text-sky-300', border: 'border-sky-400/30', bg: 'bg-sky-400/5' },
  amber: { dot: 'bg-amber-400', text: 'text-amber-300', border: 'border-amber-400/30', bg: 'bg-amber-400/5' },
  violet: { dot: 'bg-violet-400', text: 'text-violet-300', border: 'border-violet-400/30', bg: 'bg-violet-400/5' },
  slate: { dot: 'bg-slate-400', text: 'text-slate-300', border: 'border-slate-400/30', bg: 'bg-slate-400/5' },
  rose: { dot: 'bg-rose-400', text: 'text-rose-300', border: 'border-rose-400/30', bg: 'bg-rose-400/5' },
};

export default function NavFlow() {
  const navigate = useNavigate();

  return (
    <div className="max-w-4xl mx-auto py-4">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-black text-chess-text">Site Map</h1>
        <p className="text-sm text-gray-400 mt-1">
          Visual flow of every page and its sub-pages. Click a page to jump to it.
        </p>
      </header>

      {/* Groups */}
      <div className="space-y-6">
        {GROUPS.map((group) => {
          const tint = TINTS[group.tint];
          return (
            <section
              key={group.heading}
              className={`rounded-2xl border ${tint.border} ${tint.bg} p-4 sm:p-5`}
            >
              {/* Group header */}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg leading-none">{group.icon}</span>
                <h2 className={`text-base font-bold ${tint.text}`}>{group.heading}</h2>
              </div>
              {group.subheading && (
                <p className="text-[11px] text-gray-500 mb-4">{group.subheading}</p>
              )}

              {/* Entries with connector rail */}
              <div className={`relative pl-4 space-y-3 border-l ${tint.border}`}>
                {group.entries.map((entry) => {
                  const navigable = entry.path && !entry.path.includes(':');
                  return (
                    <div key={entry.title} className="relative">
                      {/* Tick on the rail */}
                      <span
                        className={`absolute -left-[21px] top-4 w-2.5 h-2.5 rounded-full ${tint.dot} ring-2 ring-chess-bg`}
                      />

                      <div
                        role={navigable ? 'button' : undefined}
                        tabIndex={navigable ? 0 : -1}
                        onClick={() => navigable && navigate(entry.path!)}
                        onKeyDown={(e) => {
                          if (navigable && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            navigate(entry.path!);
                          }
                        }}
                        className={`block rounded-xl border border-chess-border/40 bg-chess-surface/80 p-3 transition-colors ${
                          navigable
                            ? 'hover:border-chess-accent/50 hover:bg-chess-surface cursor-pointer'
                            : 'cursor-default opacity-90'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-bold text-chess-text truncate">
                              {entry.title}
                            </span>
                            {entry.adminOnly && (
                              <span className="text-[9px] uppercase tracking-wider bg-rose-400/10 text-rose-300 px-1.5 py-0.5 rounded border border-rose-400/20">
                                admin
                              </span>
                            )}
                          </div>
                          {entry.path && (
                            <code className={`text-[11px] font-mono ${tint.text} shrink-0`}>
                              {entry.path}
                            </code>
                          )}
                        </div>

                        {entry.description && (
                          <div className="text-xs text-gray-400 mt-1">{entry.description}</div>
                        )}

                        {entry.subs && entry.subs.length > 0 && (
                          <div className="mt-2.5 pt-2.5 border-t border-chess-border/30">
                            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
                              Sub-pages ({entry.subs.length})
                            </div>
                            <ul className="flex flex-wrap gap-1.5">
                              {entry.subs.map((sub, i) => (
                                <li
                                  key={i}
                                  className="inline-flex items-center gap-1.5 bg-chess-bg/70 border border-chess-border/40 rounded-md px-2 py-1"
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${tint.dot}`} />
                                  <span className="text-[11px] text-chess-text-secondary">
                                    {sub.label}
                                  </span>
                                  {sub.note && (
                                    <span className="text-[10px] text-gray-500">· {sub.note}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* Footer */}
      <p className="text-[11px] text-gray-500 text-center mt-8">
        Generated from <code className="font-mono">src/App.tsx</code> routes + per-page sub-state.
      </p>
    </div>
  );
}
