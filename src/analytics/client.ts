/* ────────────────────────────────────────────────────────────────────────
 *  Analytics client — fire-and-forget event tracking backed by the Base44
 *  AnalyticsEvent entity. Identity is a persistent localStorage UUID so
 *  guests get counted; per-visit sessionId enables session reconstruction.
 *
 *  Events are queued in memory and flushed in small batches to avoid
 *  pummeling the API on chatty pages. Failures are dropped silently (this
 *  is observability, not business logic — never block the user flow).
 * ──────────────────────────────────────────────────────────────────────── */
import { base44 } from '@/api/base44Client';
import type { AnalyticsContext, AnalyticsEventRecord, EventType } from './types';

const ANON_KEY = 'chess-dna-anon-id';
const SESSION_KEY = 'chess-dna-session-id';

let cachedContext: AnalyticsContext | null = null;
const queue: AnalyticsEventRecord[] = [];
let flushHandle: number | null = null;
const FLUSH_INTERVAL_MS = 4000;
const FLUSH_BATCH_SIZE = 12;

function uuid(): string {
  // Crypto.randomUUID is available everywhere we run, but fall back just in
  // case (e.g. older webviews). The id is opaque and never user-visible.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadAnonymousId(): string {
  try {
    const existing = localStorage.getItem(ANON_KEY);
    if (existing) return existing;
    const fresh = uuid();
    localStorage.setItem(ANON_KEY, fresh);
    return fresh;
  } catch {
    return uuid();
  }
}

function loadSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = uuid();
    sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return uuid();
  }
}

/** Update the live context — called by the AnalyticsProvider whenever the
 *  user logs in/out, journey stage changes, etc. */
export function setAnalyticsContext(ctx: Partial<AnalyticsContext>): void {
  cachedContext = {
    anonymousId: cachedContext?.anonymousId ?? loadAnonymousId(),
    sessionId: cachedContext?.sessionId ?? loadSessionId(),
    userId: cachedContext?.userId ?? '',
    userEmail: cachedContext?.userEmail ?? '',
    isGuest: cachedContext?.isGuest ?? true,
    journeyStage: cachedContext?.journeyStage ?? -1,
    ...ctx,
  };
}

function ensureContext(): AnalyticsContext {
  if (!cachedContext) {
    cachedContext = {
      anonymousId: loadAnonymousId(),
      sessionId: loadSessionId(),
      userId: '',
      userEmail: '',
      isGuest: true,
      journeyStage: -1,
    };
  }
  return cachedContext;
}

let lastPath = '';

/** External document.referrer captured at module init. Only set on the
 *  user's very first navigation in a tab — after that, in-app navigation
 *  rewrites the referrer to the previous page. We snapshot it once and
 *  attach to the first page_view of the session so the dashboard can see
 *  "this visitor arrived from chatgpt.com" even though the URL has long
 *  since rolled forward. */
const initialDocReferrer: string =
  typeof document !== 'undefined' && typeof document.referrer === 'string'
    ? document.referrer
    : '';
let docReferrerAttached = false;

function buildEvent(
  eventType: EventType,
  eventName: string,
  properties?: Record<string, unknown>,
): AnalyticsEventRecord {
  const ctx = ensureContext();
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const referrer = lastPath;
  if (eventType === 'page_view') lastPath = path;

  // Attach the external referrer to the first page_view of the session
  // (and only if it's actually cross-site — same-origin navigations are
  // uninteresting and would just be noise). The flag prevents repeating
  // it on every subsequent event in this tab.
  let props: Record<string, unknown> | undefined = properties;
  if (eventType === 'page_view' && !docReferrerAttached && initialDocReferrer) {
    const ownOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    let external = false;
    try {
      external = new URL(initialDocReferrer).origin !== ownOrigin;
    } catch {
      external = false;
    }
    if (external) {
      props = { ...(props ?? {}), _docReferrer: initialDocReferrer };
    }
    docReferrerAttached = true;
  }

  return {
    anonymousId: ctx.anonymousId,
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    userEmail: ctx.userEmail,
    eventType,
    eventName,
    path,
    referrer,
    properties: props ? JSON.stringify(props) : '{}',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    platform: 'web',
    isGuest: ctx.isGuest,
    journeyStage: ctx.journeyStage,
    timestamp: Date.now(),
  };
}

function scheduleFlush(): void {
  if (flushHandle !== null) return;
  flushHandle = window.setTimeout(() => {
    flushHandle = null;
    void flushQueue();
  }, FLUSH_INTERVAL_MS);
}

async function flushQueue(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, FLUSH_BATCH_SIZE);
  const entities = base44.entities as Record<string, { create: (e: AnalyticsEventRecord) => Promise<unknown> }>;
  const Entity = entities.AnalyticsEvent;
  if (!Entity) {
    // Schema not deployed yet — silently drop.
    if (queue.length > 0) scheduleFlush();
    return;
  }
  // Fire all creates in parallel; any failure is logged at debug level only.
  await Promise.allSettled(
    batch.map((evt) =>
      Entity.create(evt).catch((err: unknown) => {
        if (typeof console !== 'undefined') {
          // eslint-disable-next-line no-console
          console.debug('[analytics] drop event', evt.eventName, err);
        }
      }),
    ),
  );
  if (queue.length > 0) scheduleFlush();
}

/** Public API: enqueue an event. Returns immediately; never throws. */
export function track(
  eventType: EventType,
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  try {
    queue.push(buildEvent(eventType, eventName, properties));
    if (queue.length >= FLUSH_BATCH_SIZE) {
      void flushQueue();
    } else {
      scheduleFlush();
    }
  } catch {
    // Swallow — observability must never break the app.
  }
}

/** Convenience helpers — same as track() but with the type pinned. */
export const trackPageView = (path: string, props?: Record<string, unknown>) =>
  track('page_view', 'page_view', { path, ...props });
export const trackClick = (name: string, props?: Record<string, unknown>) =>
  track('click', name, props);
export const trackOnboarding = (name: string, props?: Record<string, unknown>) =>
  track('onboarding', name, props);
export const trackAnalysis = (name: string, props?: Record<string, unknown>) =>
  track('analysis', name, props);
export const trackSignup = (props?: Record<string, unknown>) =>
  track('signup', 'signup', props);

/** Force a flush — wired to beforeunload so we don't lose tail events. */
export function flushNow(): Promise<void> {
  if (flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
  return flushQueue();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { void flushNow(); });
  // Visibility change is more reliable than beforeunload on mobile.
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushNow();
  });
}
