/**
 * Lightweight analytics — logs key events to localStorage.
 * No external SDK, just simple event tracking for alpha.
 */

interface AnalyticsEvent {
  event: string;
  data?: Record<string, unknown>;
  page: string;
  timestamp: number;
}

const STORAGE_KEY = 'chess-dna-analytics';
const MAX_EVENTS = 500;

export function trackEvent(event: string, data?: Record<string, unknown>) {
  try {
    const entry: AnalyticsEvent = {
      event,
      data,
      page: window.location.pathname,
      timestamp: Date.now(),
    };

    const existing: AnalyticsEvent[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    existing.push(entry);

    // Keep only the last N events
    if (existing.length > MAX_EVENTS) {
      existing.splice(0, existing.length - MAX_EVENTS);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // noop — don't break the app for analytics
  }
}

export function getAnalyticsEvents(): AnalyticsEvent[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** Pre-defined event names for consistency */
export const Events = {
  GAMES_IMPORTED: 'games_imported',
  ANALYSIS_COMPLETED: 'analysis_completed',
  PUZZLE_ATTEMPTED: 'puzzle_attempted',
  PUZZLE_SOLVED: 'puzzle_solved',
  TRAINING_STARTED: 'training_started',
  TRAINING_COMPLETED: 'training_completed',
  AUDIO_LISTENED: 'audio_listened',
  FRIEND_COMPARED: 'friend_compared',
  FEEDBACK_SENT: 'feedback_sent',
  SHARE_CLICKED: 'share_clicked',
  PAGE_VIEW: 'page_view',
} as const;
