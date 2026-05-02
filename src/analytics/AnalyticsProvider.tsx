/* ────────────────────────────────────────────────────────────────────────
 *  AnalyticsProvider — wires the analytics client to the app:
 *    1. Page views: emits on every route change.
 *    2. Identity: keeps `setAnalyticsContext` in sync with auth + journey
 *       stage so events carry the right userId/isGuest/stage.
 *    3. Signups: detects the guest→authenticated transition and emits
 *       a one-shot `signup` event (per anonymousId, debounced via storage).
 *    4. Analysis completion: subscribes to the existing analysis bus so we
 *       count completed analyses without manually instrumenting the engine.
 *    5. Onboarding stage: emits `onboarding_stage_<n>` whenever journeyStage
 *       advances, so we can build a funnel without per-screen wiring.
 *    6. Global click capture: a single document listener picks up any
 *       element with `data-track="<event-name>"` and fires a click event,
 *       so adding tracking to a button is one attribute, not a hook call.
 *
 *  This component renders nothing — it just attaches effects.
 * ──────────────────────────────────────────────────────────────────────── */
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useChessData } from '@/contexts/ChessDataContext';
import { analysisEvents } from '@/engine/analysis-events';
import {
  setAnalyticsContext,
  trackPageView,
  trackOnboarding,
  trackAnalysis,
  trackSignup,
  trackClick,
  track,
} from './client';

const SIGNUP_FIRED_KEY = 'chess-dna-signup-fired';

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { isAuthenticated, isGuest, userId, userEmail, authResolved } = useAuth();
  const { journeyStage } = useChessData();

  // Keep the client's identity context current so every event carries
  // accurate userId / stage / isGuest. Only push once auth is resolved
  // (avoid emitting events tagged as guest before we know better).
  useEffect(() => {
    if (!authResolved) return;
    setAnalyticsContext({
      userId: userId ?? '',
      userEmail: userEmail ?? '',
      isGuest,
      journeyStage,
    });
  }, [authResolved, userId, userEmail, isGuest, journeyStage]);

  // ── Page views ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authResolved) return;
    trackPageView(location.pathname, { search: location.search });
  }, [authResolved, location.pathname, location.search]);

  // ── Signup ────────────────────────────────────────────────────────────
  // Fire once per anonymousId when the user transitions to authenticated.
  // We rely on localStorage so a logout/login cycle doesn't double-count.
  useEffect(() => {
    if (!authResolved || !isAuthenticated || !userId) return;
    try {
      const already = localStorage.getItem(SIGNUP_FIRED_KEY);
      if (already) return;
      localStorage.setItem(SIGNUP_FIRED_KEY, '1');
      trackSignup({ userId });
    } catch {
      // No localStorage → just emit anyway. Worst case: a duplicate event
      // per visit, which we can de-dupe on read in the dashboard.
      trackSignup({ userId });
    }
  }, [authResolved, isAuthenticated, userId]);

  // ── Onboarding stage transitions ──────────────────────────────────────
  const lastStageRef = useRef<number | null>(null);
  useEffect(() => {
    if (!authResolved) return;
    const prev = lastStageRef.current;
    if (prev === journeyStage) return;
    lastStageRef.current = journeyStage;
    // Skip the initial "first observation" — only emit on actual movement.
    if (prev === null) return;
    trackOnboarding(`onboarding_stage_${journeyStage}`, {
      from: prev,
      to: journeyStage,
    });
  }, [authResolved, journeyStage]);

  // ── Analysis completion ──────────────────────────────────────────────
  useEffect(() => {
    const off = analysisEvents.on((event) => {
      if (event.type === 'complete') {
        trackAnalysis('analysis_complete', { gameId: event.gameId });
      } else if (event.type === 'all_complete') {
        trackAnalysis('analysis_batch_complete', {});
      } else if (event.type === 'error') {
        trackAnalysis('analysis_error', { gameId: event.gameId, error: event.error });
      }
    });
    return off;
  }, []);

  // ── Global click capture ─────────────────────────────────────────────
  // Walk up the DOM from the click target; the first ancestor with a
  // data-track attribute wins. This keeps instrumentation declarative —
  // a button just needs `data-track="continue_clicked"`.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tracked = target.closest<HTMLElement>('[data-track]');
      if (!tracked) return;
      const name = tracked.getAttribute('data-track');
      if (!name) return;
      // Optional inline metadata via data-track-* attributes.
      const meta: Record<string, string> = {};
      for (const attr of Array.from(tracked.attributes)) {
        if (attr.name.startsWith('data-track-') && attr.name !== 'data-track') {
          meta[attr.name.slice('data-track-'.length)] = attr.value;
        }
      }
      trackClick(name, Object.keys(meta).length ? meta : undefined);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Re-export `track` indirectly so child code can import { useAnalytics }
  // if it ever needs to fire ad-hoc events. For now nothing reads this.
  void track;

  return <>{children}</>;
}
