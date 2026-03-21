/**
 * Check if the current date is a different calendar day than the given timestamp.
 * Returns false if timestamp is null.
 */
export function isDifferentCalendarDay(timestamp: number | null): boolean {
  if (!timestamp) return false;

  const now = new Date();
  const then = new Date(timestamp);

  return (
    now.getFullYear() !== then.getFullYear() ||
    now.getMonth() !== then.getMonth() ||
    now.getDate() !== then.getDate()
  );
}

/**
 * Get hours remaining until the next calendar day (midnight).
 * Returns 0 if timestamp is null or already a different day.
 */
export function hoursUntilNextDay(timestamp: number | null): number {
  if (!timestamp) return 0;
  if (isDifferentCalendarDay(timestamp)) return 0;

  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);

  return Math.max(0, Math.ceil((midnight.getTime() - now.getTime()) / (1000 * 60 * 60)));
}
