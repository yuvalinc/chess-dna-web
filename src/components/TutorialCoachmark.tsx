/* ────────────────────────────────────────────────────────────────────────
 *  TutorialCoachmark — overlay that dims the screen except for one element,
 *  with a tooltip card explaining what the user is looking at.
 *
 *  Renders nothing unless:
 *    - tutorialStep is 1..N (active tour)
 *    - current location matches the step's `page`
 *    - target element with [data-tutorial-target] is present
 *
 *  The spotlight follows the target element via getBoundingClientRect()
 *  + a ResizeObserver. Auto-resume "just works": when the user navigates
 *  back to a screen mid-tour, the coachmark fires automatically.
 * ──────────────────────────────────────────────────────────────────────── */
import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTutorial, TUTORIAL_TOTAL_STEPS } from '@/contexts/TutorialContext';
import { useChessData } from '@/contexts/ChessDataContext';

interface Rect { top: number; left: number; width: number; height: number; }

function findTarget(id: string): HTMLElement | null {
  return document.querySelector(`[data-tutorial-target="${id}"]`) as HTMLElement | null;
}

export default function TutorialCoachmark() {
  const tutorial = useTutorial();
  const { step, subStep, isActive, currentDef, currentTarget, demoGameId, advance, goBack, canGoBack, skip } = tutorial;
  // Dev-only: expose triggerStep on window so it can be poked from DevTools
  // for verification flows. Stripped from production builds via the
  // import.meta.env.DEV gate.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { tutorialTrigger?: (n: number) => void }).tutorialTrigger = tutorial.triggerStep;
    }
  }, [tutorial.triggerStep]);
  const location = useLocation();
  const navigate = useNavigate();
  const { games } = useChessData();
  const [rect, setRect] = useState<Rect | null>(null);

  // Resolve `:gameId` placeholder in navPath using the demo game id.
  const resolveNav = (path: string): string => {
    if (path.includes(':gameId') && demoGameId) {
      return path.replace(':gameId', demoGameId);
    }
    return path;
  };

  // `isActive` is only true when TutorialContext's matcher already accepted
  // the current pathname for this step (handles `/games/:gameId` templates),
  // so trusting it here is equivalent to a fresh string compare.
  const onPage = isActive && !!currentDef;
  const targetId = currentTarget?.id;

  // Find + measure the target element. Re-runs when step/sub-step/page changes,
  // and via a ResizeObserver while the coachmark is visible.
  const measure = useCallback(() => {
    if (!targetId) { setRect(null); return; }
    const el = findTarget(targetId);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [targetId]);

  useEffect(() => {
    if (!isActive || !onPage || !targetId) { setRect(null); return; }

    // Reset rect at the start of every effect run so a stale rect from the
    // previous step/route doesn't keep dimming an unrelated screen (e.g.
    // when the user enters a Time Machine challenge — `tm-list` disappears,
    // but the dim should disappear too).
    setRect(null);

    // Try multiple times — the target element may not be in the DOM yet
    // on first mount (e.g. data-loading state).
    let attempts = 0;
    let scrolled = false;
    let cancelled = false;
    const tryFind = () => {
      if (cancelled) return;
      const el = findTarget(targetId);
      if (el) {
        // Scroll the target into the middle of the viewport once we find
        // it — otherwise off-screen targets leave the user staring at the
        // card alone with no idea what it's pointing at.
        if (!scrolled) {
          scrolled = true;
          try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* ignore */ }
          // Re-measure after the scroll completes so the rect picks up the
          // new viewport position.
          setTimeout(() => { if (!cancelled) measure(); }, 320);
        }
        measure();
        return;
      }
      attempts += 1;
      if (attempts < 30) setTimeout(tryFind, 100);
      // Else: target never showed up. Leave rect null → coachmark unmounts
      // and the page is fully interactive again.
    };
    tryFind();

    // If the target is removed from the DOM after we found it (e.g. user
    // clicks into a challenge), MutationObserver clears the rect so the
    // dim doesn't linger over the new screen.
    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(() => {
        if (!findTarget(targetId)) setRect(null);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    const onResize = () => measure();
    const onScroll = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);

    let ro: ResizeObserver | null = null;
    const el = findTarget(targetId);
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [isActive, onPage, targetId, measure]);

  if (!isActive || !onPage || !currentTarget || !currentDef) return null;
  // For "no spotlight" sub-steps we render the bubble alone — no target
  // lookup, no rect, no dim layer. Used for screen-overview intros where
  // the user just needs to read a sentence before moving on.
  const celebrate = currentTarget.celebrate === true;
  const noSpotlight = currentTarget.noSpotlight === true || celebrate;
  if (!noSpotlight) {
    if (!rect) return null;
    // Belt-and-suspenders: even if `rect` is set, bail if the target element
    // isn't actually in the DOM right now. Prevents a stale dim layer from
    // covering pages that have unmounted the target (e.g. entering a TM
    // challenge — the pattern list is gone, so the spotlight should be too).
    if (!findTarget(currentTarget.id)) return null;
  }
  const pinBottom = currentTarget.pinTooltipBottom === true;

  const handleAdvance = () => {
    // Special-case: the Practice sub-step's "Try it →" hands the user off
    // to Time Machine with the highlighted game pre-filtered and the first
    // challenge auto-launched. We mark every remaining sub-step seen so the
    // tour resumes at the next top-level step (Time Machine) when the user
    // returns there.
    if (currentTarget?.action === 'practice-first-game') {
      const firstGame = [...games].sort((a, b) => b.playedAt - a.playedAt)[0];
      // advance() on the last sub-step marks the step as seen. Practice is
      // now the final Games sub-step, so a single advance() finishes it.
      advance();
      if (firstGame) {
        setTimeout(() => navigate('/timemachine', {
          state: {
            gameFilter: firstGame.id,
            autoStart: true,
            tutorial: 'practice',
          },
        }), 50);
      }
      return;
    }
    const nav = advance();
    if (nav) {
      const resolved = resolveNav(nav);
      // Tiny delay so the user sees the dismiss animation
      setTimeout(() => navigate(resolved), 50);
    }
  };

  const handleBack = () => {
    const nav = goBack();
    if (nav && nav !== location.pathname) {
      const resolved = resolveNav(nav);
      setTimeout(() => navigate(resolved), 50);
    }
  };

  const totalSubSteps = currentDef.targets.length;
  // Generous padding so the spotlight gives the target some breathing room
  // (compact targets like the TM pattern card look squeezed at smaller values).
  const padding = 12;
  // Spotlight rect with a small inset so the highlight ring doesn't overlap
  // the element's own border. Falls back to zeros when there's no spotlight
  // (the dim/arrow are not rendered in that case, so values don't matter).
  const spotTop = rect ? rect.top - padding : 0;
  const spotLeft = rect ? rect.left - padding : 0;
  const spotWidth = rect ? rect.width + padding * 2 : 0;
  const spotHeight = rect ? rect.height + padding * 2 : 0;

  // Tooltip placement: start with the requested side, then auto-flip if it
  // would push the card off-screen. Reserve ~240px for the card body so the
  // explanation stays readable. `pinBottom` and `noSpotlight` modes both
  // anchor the card at a fixed bottom position so it doesn't jump between
  // sub-steps or cover the spotlighted target.
  const RESERVED_CARD_HEIGHT = 240;
  const VIEWPORT_MARGIN = 16;
  const NAV_CLEARANCE = 90; // bottom-nav + safe-area
  const requestedPos = currentTarget.tooltipPos ?? 'bottom';
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const roomBelow = viewportH - (spotTop + spotHeight + 12);
  const roomAbove = spotTop - 12;
  let tooltipPos: 'top' | 'bottom' = requestedPos;
  if (requestedPos === 'bottom' && roomBelow < RESERVED_CARD_HEIGHT && roomAbove > roomBelow) {
    tooltipPos = 'top';
  } else if (requestedPos === 'top' && roomAbove < RESERVED_CARD_HEIGHT && roomBelow > roomAbove) {
    tooltipPos = 'bottom';
  }
  let tooltipTop = tooltipPos === 'bottom' ? spotTop + spotHeight + 12 : spotTop - 12;
  let cardOverlapsTarget = false;
  if (celebrate) {
    // Vertically center the celebration bubble for "Nice work!" milestones.
    tooltipTop = Math.max(VIEWPORT_MARGIN, (viewportH - RESERVED_CARD_HEIGHT) / 2);
    tooltipPos = 'bottom';
    cardOverlapsTarget = true;
  } else if (pinBottom || noSpotlight) {
    // Pin the card to a fixed position above the bottom nav so it doesn't
    // move between sub-steps. The arrow gets hidden via cardOverlapsTarget.
    tooltipTop = viewportH - RESERVED_CARD_HEIGHT - NAV_CLEARANCE;
    tooltipPos = 'bottom';
    cardOverlapsTarget = true;
  } else if (tooltipPos === 'bottom') {
    const maxTop = viewportH - RESERVED_CARD_HEIGHT - VIEWPORT_MARGIN;
    if (tooltipTop > maxTop) {
      tooltipTop = Math.max(VIEWPORT_MARGIN, maxTop);
      cardOverlapsTarget = true;
    }
  } else {
    const minBottomY = RESERVED_CARD_HEIGHT + VIEWPORT_MARGIN;
    if (tooltipTop < minBottomY) {
      tooltipTop = Math.min(viewportH - VIEWPORT_MARGIN, minBottomY);
      cardOverlapsTarget = true;
    }
  }

  return (
    // Outer wrapper is click-through: `pointer-events: none` lets the user
    // tap the spotlighted element (e.g., scroll the AI panel's Your Move /
    // Best Move tabs) while the dim and arrow paint over the rest. The
    // tooltip card re-enables pointer events for itself below.
    <div className="fixed inset-0 z-[100]" style={{ pointerEvents: 'none' }}>
      {/* Dim+spotlight — only when this sub-step targets a real element.
          For noSpotlight intros, the bubble alone hovers above the page. */}
      {!noSpotlight && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: spotTop, left: spotLeft, width: spotWidth, height: spotHeight,
            borderRadius: 14,
            boxShadow:
              '0 0 0 9999px rgba(6,9,16,0.78), inset 0 0 0 2px rgb(74,222,128), 0 0 24px rgba(74,222,128,0.4), 0 0 0 6px rgba(74,222,128,0.18)',
            transition: 'all 200ms ease-out',
          }}
        />
      )}

      {/* Tooltip arrow — hidden when the card has been clamped away from the
          target (otherwise the arrow would point at empty space). */}
      {!cardOverlapsTarget && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: tooltipPos === 'bottom' ? tooltipTop - 7 : tooltipTop - 7,
            left: spotLeft + spotWidth / 2 - 7,
            width: 14, height: 14,
            background: 'rgb(var(--chess-surface))',
            border: '1px solid rgba(74,222,128,0.35)',
            borderBottom: tooltipPos === 'bottom' ? 'none' : undefined,
            borderRight: tooltipPos === 'bottom' ? 'none' : undefined,
            borderTop: tooltipPos === 'top' ? 'none' : undefined,
            borderLeft: tooltipPos === 'top' ? 'none' : undefined,
            transform: 'rotate(45deg)',
            zIndex: 1,
          }}
        />
      )}

      {/* Tooltip card — pointer-events re-enabled so Skip / Back / Next
          remain clickable even though the outer wrapper is pass-through. */}
      <div
        className="absolute"
        style={{
          left: 16,
          right: 16,
          top: tooltipPos === 'bottom' ? tooltipTop : 'auto',
          bottom: tooltipPos === 'top' ? `calc(100vh - ${tooltipTop}px)` : 'auto',
          background: 'rgb(var(--chess-surface))',
          borderRadius: 14,
          border: '1px solid rgba(74,222,128,0.35)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(74,222,128,0.05)',
          padding: '14px 14px 12px',
          maxWidth: 460,
          marginLeft: 'auto',
          marginRight: 'auto',
          pointerEvents: 'auto',
        }}
      >
        {/* Header: STEP X OF N + sub-step dots + Skip */}
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-[9px] font-extrabold tracking-[1.2px] px-2 py-1 rounded text-chess-accent"
            style={{ background: 'rgba(74,222,128,0.15)' }}
          >
            STEP {step} OF {TUTORIAL_TOTAL_STEPS}
          </span>
          {totalSubSteps > 1 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-chess-text-tertiary">
              {Array.from({ length: totalSubSteps }).map((_, i) => (
                <span
                  key={i}
                  className="rounded-full"
                  style={{
                    width: 5, height: 5,
                    background: i === subStep ? 'rgb(var(--chess-accent))' : 'rgb(var(--chess-muted))',
                    opacity: i === subStep ? 1 : 0.5,
                  }}
                />
              ))}
              <span className="ml-0.5 tabular-nums">{subStep + 1}/{totalSubSteps}</span>
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={skip}
            data-track="tutorial_skip"
            data-track-step={String(step)}
            className="text-[11px] text-chess-text-tertiary hover:text-chess-text transition-colors"
          >
            Skip tour
          </button>
        </div>

        {celebrate && (
          <div className="flex items-center justify-center mb-3 mt-1">
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 76, height: 76,
                background: 'radial-gradient(circle, rgba(74,222,128,0.35), rgba(74,222,128,0.08) 65%, transparent 75%)',
              }}
            >
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="rgb(74,222,128)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {/* Trophy */}
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
            </div>
          </div>
        )}
        <div className={`${celebrate ? 'text-center text-xl' : 'text-sm'} font-extrabold text-chess-text leading-tight mb-1.5`}>
          {currentTarget.title}
        </div>
        <p className={`${celebrate ? 'text-center text-[13px]' : 'text-[13px]'} text-chess-text leading-relaxed mb-3.5`} style={{ opacity: 0.92 }}>
          {currentTarget.body}
        </p>

        {/* Step dots + Back/Next buttons */}
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1 flex-1">
            {Array.from({ length: TUTORIAL_TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className="rounded-[3px] transition-all"
                style={{
                  width: i + 1 === step ? 22 : 6, height: 6,
                  background: i + 1 <= step ? 'rgb(var(--chess-accent))' : 'rgb(var(--chess-muted))',
                  opacity: i + 1 <= step ? 1 : 0.6,
                }}
              />
            ))}
          </div>
          {canGoBack && (
            <button
              onClick={handleBack}
              className="text-chess-text-tertiary hover:text-chess-text px-2 py-1.5 rounded-[7px] text-[11px] font-bold transition-colors"
              aria-label="Go back"
            >
              ← Back
            </button>
          )}
          <button
            onClick={handleAdvance}
            data-track="tutorial_next"
            data-track-step={String(step)}
            data-track-substep={String(subStep)}
            className="bg-chess-accent text-chess-bg px-4 py-2 rounded-[9px] text-xs font-extrabold hover:brightness-110 transition-all shadow-[0_0_12px_rgba(74,222,128,0.25)]"
          >
            {currentTarget.primary} →
          </button>
        </div>
      </div>
    </div>
  );
}
