/* ────────────────────────────────────────────────────────────────────────
 *  TutorialContext — 4-step coachmark tour over the live main screens.
 *
 *  Persistence model (per-page, per-step "seen"):
 *    Stored in localStorage under TUTORIAL_SEEN_KEY as a JSON array of step
 *    numbers (1..N). A step fires only when
 *      (a) the user is on its `page`, AND
 *      (b) its number is NOT in the seen list, AND
 *      (c) the seen list isn't already full.
 *    Skip / completion adds every remaining step number to the list, so the
 *    tour never re-triggers. Each step is independent.
 *
 *    NOTE: localStorage is used (not Base44) because the UserPreferences
 *    schema doesn't include this field — Base44 silently drops unknown
 *    fields, so settings.tutorialStepsSeen would never persist. The
 *    settings field is kept around for future schema extension but the
 *    runtime source of truth is localStorage.
 *
 *  Coachmarks render at the AppShell level (one component handles all
 *  steps); each page just marks its target with `data-tutorial-target="<id>"`.
 * ──────────────────────────────────────────────────────────────────────── */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTheme } from '@/components/ThemeContext';
import { useChessData } from '@/contexts/ChessDataContext';

const TUTORIAL_SEEN_KEY = 'chess-dna-tutorial-seen';

function loadSeenFromStorage(): number[] {
  try {
    const raw = localStorage.getItem(TUTORIAL_SEEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((n) => typeof n === 'number');
    }
  } catch { /* ignore */ }
  return [];
}

function saveSeenToStorage(seen: number[]) {
  try {
    localStorage.setItem(TUTORIAL_SEEN_KEY, JSON.stringify(seen));
  } catch { /* ignore */ }
}

export interface TutorialTarget {
  /** data-tutorial-target attribute value to find the spotlight element.
   *  Empty string when `noSpotlight` is true. */
  id: string;
  title: string;
  body: string;
  /** Label for the primary "Next" button */
  primary: string;
  /** Override for tooltip placement; defaults to 'bottom' */
  tooltipPos?: 'top' | 'bottom';
  /** Optional special action — when set, the primary button performs this
   *  side-effect instead of advancing to the next sub-step. The Coachmark
   *  component is responsible for executing it. */
  action?: 'practice-first-game';
  /** Skip the spotlight entirely — just show the bubble centered on the
   *  screen. Useful for "let's take a look around" intros. */
  noSpotlight?: boolean;
  /** Pin the tooltip card to a fixed bottom position regardless of where
   *  the target is. Prevents the bubble from jumping between sub-steps
   *  on the same page. */
  pinTooltipBottom?: boolean;
  /** Render the bubble vertically centered on screen with a big celebration
   *  icon at the top. Used for "Nice work!" milestones. Implies noSpotlight. */
  celebrate?: boolean;
}

export interface TutorialStepDef {
  /** Route pathname this step appears on. May be a literal path ('/games')
   *  or a `:gameId` template path. The matcher fn handles both. */
  page: string;
  /** Where to navigate when this step's last sub-step finishes. Same
   *  template rules as `page`. The TutorialCoachmark resolves `:gameId`
   *  with the demo game id at runtime. */
  navPath: string;
  /** One or more sub-step targets within this step */
  targets: TutorialTarget[];
  /** Optional human label for debugging */
  label?: string;
}

/* The guided 7-step tour:
 *   1. DNA Radar             (/)
 *   2. Games card             (/games)               — opens a real game
 *   3. Game detail            (/games/:gameId)       — 3 sub-steps
 *   4. Games practice button  (/games)               — same page as #2
 *   5. TM challenge board     (/timemachine, in-fly)
 *   6. TM patterns list       (/timemachine, list)
 *   7. Compare                (/compare)             — 3 sub-steps
 *
 * Steps 2 & 4 share the /games page and steps 5 & 6 share /timemachine —
 * the matcher picks the first step whose page matches AND hasn't been
 * seen yet, so they fire in order. Step 5 only renders when the in-game
 * board target exists (challenge active); when the user finishes and
 * returns to the list, the `tm-list` target appears and step 6 fires.
 */
export const TUTORIAL_STEPS: TutorialStepDef[] = [
  // (step 0 reserved for "not started" — no entry)
  {
    label: 'DNA radar',
    page: '/',
    navPath: '/games',
    targets: [
      {
        id: 'dna-radar',
        title: 'This is your Chess DNA',
        body: "Eight skills derived from your real games — the shape tells you what's working and where you bleed rating.",
        primary: 'Next: Games',
      },
    ],
  },
  {
    label: 'Games card',
    page: '/games',
    navPath: '/games/:gameId',
    targets: [
      {
        id: 'games-card',
        title: 'Every game, decoded',
        body: 'Each row is one of your games — opponent, accuracy, time class. Tap a row to open the full review.',
        primary: 'Next',
      },
      {
        id: 'games-action-analyze',
        title: 'Analyze',
        body: 'The fastest way in: an engine review of every move with key moments highlighted and an AI summary of what swung the game.',
        primary: 'Open this game',
      },
    ],
  },
  {
    label: 'Game detail',
    page: '/games/:gameId',
    navPath: '/games',
    targets: [
      {
        id: '',
        title: 'The full game review',
        body: "Take a quick look — we'll walk you through it next.",
        primary: 'Show me',
        noSpotlight: true,
      },
      {
        id: 'game-detail-tabs',
        title: 'Switch lenses',
        body: 'Stats / Moments / Patterns — pick the angle.',
        primary: 'Next',
      },
      {
        id: 'game-detail-moment',
        title: 'A key moment',
        body: 'Tap one to jump the board there.',
        primary: 'Next',
      },
      {
        id: 'game-detail-ai-explanation',
        title: 'Why it mattered',
        body: 'AI explains what changed and what was better.',
        primary: 'Back to Games',
      },
    ],
  },
  {
    label: 'Games practice',
    page: '/games',
    navPath: '/timemachine',
    targets: [
      {
        id: 'games-action-practice',
        title: 'Practice',
        body: "Send this game's mistakes to Replays. You'll get the same positions back as puzzles until you find the right move.",
        primary: 'Try it',
        action: 'practice-first-game',
      },
    ],
  },
  {
    label: 'TM challenge',
    page: '/timemachine',
    navPath: '/timemachine',
    targets: [
      {
        id: '',
        title: 'Your turn',
        body: 'Three stages: review the lead-up, play your move, then see the continuation.',
        primary: 'Got it',
        noSpotlight: true,
      },
    ],
  },
  {
    label: 'TM challenge celebration',
    // Sentinel path — never matches any real route. The step is fired
    // imperatively via triggerStep(6) when the user clicks "Next" after
    // their first challenge, so we don't want the route matcher firing
    // it as soon as the user lands on /timemachine.
    page: '__forced_only__',
    navPath: '/timemachine',
    targets: [
      {
        id: '',
        title: 'Nice work!',
        body: "You finished your first challenge. Keep going to lock in the patterns.",
        primary: 'Keep going',
        noSpotlight: true,
        celebrate: true,
      },
    ],
  },
  {
    label: 'TM patterns list',
    page: '/timemachine',
    navPath: '/compare',
    targets: [
      {
        id: 'tm-list',
        title: 'Your patterns',
        body: 'When you exit a challenge, the queue ranks your repeating mistakes. Practice the top ones to shrink your weakest skills first.',
        primary: 'Next: Compare',
      },
    ],
  },
  {
    label: 'Compare',
    page: '/compare',
    navPath: '/',
    targets: [
      {
        id: 'compare-pick',
        title: 'Pick anyone to compare',
        body: 'Tap a friend, opponent, or top player from your chip row — or paste any chess.com / lichess username to pull their DNA on the fly.',
        primary: 'Next',
      },
      {
        id: 'compare-result',
        title: 'See both DNAs, side by side',
        body: 'Two scores, two radars on one chart. The shapes show exactly where you out-skill them and where they out-skill you.',
        primary: 'Next',
        tooltipPos: 'top',
      },
      {
        id: 'compare-diff',
        title: 'Spot the gap, target the gap',
        body: 'Per-skill diffs make the asymmetry obvious. Open Replays on any red row to start closing it.',
        primary: 'Start exploring',
        tooltipPos: 'top',
      },
    ],
  },
];

/** Match a step's page template against the live pathname.
 *  Supports literal paths and `/games/:gameId` (any non-empty id). */
function pageMatches(stepPage: string, pathname: string): boolean {
  if (stepPage === '/games/:gameId') {
    return pathname.startsWith('/games/') && pathname.length > '/games/'.length;
  }
  return stepPage === pathname;
}

export const TUTORIAL_TOTAL_STEPS = TUTORIAL_STEPS.length;

interface TutorialContextValue {
  /** 0 = not started, 1–N = active step, > N = completed */
  step: number;
  /** Local-only sub-step within the current step (0-indexed) */
  subStep: number;
  /** Whether the tour is currently active (1 ≤ step ≤ N) */
  isActive: boolean;
  /** Definition of the current step, or null if inactive */
  currentDef: TutorialStepDef | null;
  /** Definition of the current sub-step target, or null if inactive */
  currentTarget: TutorialTarget | null;
  /** Game id used by the GameDetail step — pre-resolved at tour start so
   *  the navigation from "Open a game" is deterministic. */
  demoGameId: string | null;
  /** Half-move index within the demo game that we want to spotlight in
   *  step 3 (the "key moment that's also a pattern"). */
  demoMoveHalfIndex: number | null;
  /** Advance to the next sub-step (or next step). Returns the path to navigate to next, if any. */
  advance: () => string | null;
  /** Step backward — to previous sub-step, or previous step's last sub-step.
   *  Returns the path to navigate to (if step changed), or null. */
  goBack: () => string | null;
  /** True if there's a previous sub-step or step the user can return to. */
  canGoBack: boolean;
  /** Skip the entire tour (sets step to N+1) */
  skip: () => void;
  /** Restart the tour from step 1 (used by admin/debug) */
  restart: () => void;
  /** Imperatively mark a specific step number as seen — used by pages
   *  that need to dismiss a coachmark in response to internal state
   *  changes (e.g. TM auto-dismisses Step 5 when the player's turn ends). */
  markSeen: (stepNumber: number) => void;
  /** Imperatively force a specific step to fire regardless of page-match
   *  rules. Used for one-shot celebrations (e.g. "Nice work!" after the
   *  user's first practice challenge). Cleared automatically on advance. */
  triggerStep: (stepNumber: number) => void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function TutorialProvider({ children }: { children: ReactNode }) {
  // settings/updateSettings kept for legacy admin nav compatibility — the
  // actual seen-tracking lives in localStorage.
  void useTheme();
  const location = useLocation();
  const { games, allAnalyses } = useChessData();
  const [subStep, setSubStep] = useState(0);
  const [stepsSeen, setStepsSeen] = useState<number[]>(() => loadSeenFromStorage());

  // Pick a single game + move to use throughout the GameDetail demo step.
  // Preference: most recent game whose biggestMistake exists. Fallbacks:
  // most recent game with any analysis, or simply most recent game.
  const { demoGameId, demoMoveHalfIndex } = useMemo(() => {
    if (games.length === 0) return { demoGameId: null, demoMoveHalfIndex: null };
    const sorted = [...games].sort((a, b) => b.playedAt - a.playedAt);
    for (const g of sorted) {
      const a = allAnalyses.find((x) => x.gameId === g.id);
      const big = a?.summary?.biggestMistake;
      if (a && big) {
        // halfMoveIndex = (moveNumber - 1) * 2 + (playerColor === 'black' ? 1 : 0)
        const playerColor = a.summary.playerColor;
        const halfIdx = (big.moveNumber - 1) * 2 + (playerColor === 'black' ? 1 : 0);
        return { demoGameId: g.id, demoMoveHalfIndex: halfIdx };
      }
    }
    // No game with a biggest mistake — fall back to first game w/ analysis,
    // or just the most recent.
    const fallback = sorted.find((g) => allAnalyses.some((a) => a.gameId === g.id)) ?? sorted[0];
    return { demoGameId: fallback?.id ?? null, demoMoveHalfIndex: null };
  }, [games, allAnalyses]);

  // Forced-step: a one-shot override (e.g. for celebration popups) that
  // makes a specific step fire regardless of page-match rules. Cleared
  // automatically when the user advances past it.
  const [forcedStep, setForcedStep] = useState<number | null>(null);
  const triggerStep = useCallback((stepNumber: number) => {
    if (stepNumber < 1 || stepNumber > TUTORIAL_STEPS.length) return;
    if (stepsSeen.includes(stepNumber)) return;
    setForcedStep(stepNumber);
  }, [stepsSeen]);

  // Find the first un-seen step whose page-template matches the live URL,
  // OR the forced step if one is set.
  // Two consecutive steps can share a page (e.g. Games card + Games practice
  // both on /games) — they fire in order as each gets marked seen.
  const stepIndex = useMemo(() => {
    if (forcedStep !== null && !stepsSeen.includes(forcedStep)) {
      return forcedStep - 1;
    }
    for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
      const s = TUTORIAL_STEPS[i];
      if (!pageMatches(s.page, location.pathname)) continue;
      if (stepsSeen.includes(i + 1)) continue;
      return i;
    }
    return -1;
  }, [location.pathname, stepsSeen, forcedStep]);
  const stepForPage = stepIndex >= 0 ? stepIndex + 1 : 0;
  const allSeen = stepsSeen.length >= TUTORIAL_TOTAL_STEPS;
  const isActive = stepForPage > 0 && !allSeen;

  const step = isActive ? stepForPage : 0;
  const currentDef = isActive ? TUTORIAL_STEPS[stepIndex] : null;
  const currentTarget = currentDef ? (currentDef.targets[subStep] ?? null) : null;

  // Reset sub-step whenever the *step* changes (not just the route — two
  // sibling steps on the same /games page would otherwise keep a stale
  // sub-step index from the previous step).
  useEffect(() => {
    setSubStep(0);
  }, [stepForPage]);

  const persistSeen = useCallback((next: number[]) => {
    setStepsSeen(next);
    saveSeenToStorage(next);
  }, []);

  const markStepSeen = useCallback((n: number) => {
    if (!stepsSeen.includes(n)) {
      persistSeen([...stepsSeen, n]);
    }
  }, [stepsSeen, persistSeen]);

  const advance = useCallback((): string | null => {
    if (!currentDef || !isActive) return null;
    const nextSub = subStep + 1;
    if (nextSub < currentDef.targets.length) {
      setSubStep(nextSub);
      return null;
    }
    // Last sub-step on this page → mark the step as seen and let the user
    // navigate (we still return the def's navPath as a convenience handoff).
    setSubStep(0);
    markStepSeen(step);
    setForcedStep(null);
    return currentDef.navPath;
  }, [currentDef, isActive, subStep, step, markStepSeen]);

  // Back walks within the current sub-steps and across step boundaries.
  // Going back across steps un-marks the previous step as seen so it
  // re-fires when the user lands on its route.
  const canGoBack = subStep > 0 || step > 1;

  const goBack = useCallback((): string | null => {
    if (subStep > 0) {
      setSubStep(subStep - 1);
      return null;
    }
    if (step <= 1) return null;
    // Move to the previous top-level step. Un-seen it (and any later
    // step that was marked seen along with it) so the spotlight re-fires.
    const prevStepIdx = step - 2; // step is 1-indexed; previous is (step-1) → idx (step-2)
    const prevDef = TUTORIAL_STEPS[prevStepIdx];
    if (!prevDef) return null;
    const prevStepNumber = prevStepIdx + 1;
    const newSeen = stepsSeen.filter((n) => n < prevStepNumber);
    persistSeen(newSeen);
    setSubStep(Math.max(0, prevDef.targets.length - 1));
    // If the previous step lives on a different page, return its page so
    // the caller can navigate back. Returning null keeps us on the
    // current route (relevant for step 6 → step 5 which share /timemachine).
    if (!pageMatches(prevDef.page, location.pathname)) {
      return prevDef.page;
    }
    return null;
  }, [subStep, step, stepsSeen, persistSeen, location.pathname]);

  const skip = useCallback(() => {
    setSubStep(0);
    const everyStep = TUTORIAL_STEPS.map((_, i) => i + 1);
    persistSeen(everyStep);
  }, [persistSeen]);

  const restart = useCallback(() => {
    setSubStep(0);
    persistSeen([]);
  }, [persistSeen]);

  const value = useMemo<TutorialContextValue>(() => ({
    step, subStep, isActive, currentDef, currentTarget,
    demoGameId, demoMoveHalfIndex,
    advance, goBack, canGoBack, skip, restart, markSeen: markStepSeen, triggerStep,
  }), [step, subStep, isActive, currentDef, currentTarget, demoGameId, demoMoveHalfIndex, advance, goBack, canGoBack, skip, restart, markStepSeen, triggerStep]);

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorial must be used inside <TutorialProvider>');
  return ctx;
}
