/* ────────────────────────────────────────────────────────────────────────
 *  Analytics types — shared between the client (writers) and the dashboard
 *  (readers). Kept narrow and stable so adding new event names doesn't
 *  break compilation across the app.
 * ──────────────────────────────────────────────────────────────────────── */

export type EventType =
  | 'page_view'
  | 'click'
  | 'signup'
  | 'onboarding'
  | 'analysis'
  | 'custom';

export interface AnalyticsEventRecord {
  id?: string;
  anonymousId: string;
  sessionId: string;
  userId: string;
  /** Base44 user email when authenticated; empty for guests. Lets the
   *  admin dashboard render a human-readable user list. */
  userEmail: string;
  eventType: EventType;
  eventName: string;
  path: string;
  referrer: string;
  /** Stringified JSON. Decode with safeParseProperties(). */
  properties: string;
  userAgent: string;
  platform: string;
  isGuest: boolean;
  journeyStage: number;
  timestamp: number;
  created_date?: string;
}

export interface AnalyticsContext {
  anonymousId: string;
  sessionId: string;
  userId: string;
  userEmail: string;
  isGuest: boolean;
  journeyStage: number;
}

export function safeParseProperties(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
