// GitHub-contributions-style activity grid.
// 13 columns × 7 rows = ~91 days. Each cell is one day, colored by count.
// Drop-in: pass a map of date-string ("YYYY-MM-DD") → count, plus optional
// label for the tooltip suffix.

interface ActivityCalendarProps {
  counts: Map<string, number>;
  daysBack?: number;
  label?: string; // e.g. "drafts" → tooltip reads "5 drafts on 2026-05-24"
  colorClass?: string; // tailwind color for the filled square (e.g. 'bg-chess-accent')
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function ActivityCalendar({
  counts,
  daysBack = 91,
  label = 'items',
  colorClass = 'bg-chess-accent',
}: ActivityCalendarProps) {
  // Build the day array ending today. We align the rightmost column on
  // today's day-of-week so the grid reads "this week is the last column".
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Walk backwards `daysBack` days, then pad to start of that week (Sunday).
  const days: Date[] = [];
  const start = new Date(today);
  start.setDate(start.getDate() - daysBack + 1);
  // Pad to Sunday so the columns align cleanly into weeks.
  while (start.getDay() !== 0) start.setDate(start.getDate() - 1);
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }

  // Compute max for intensity normalization. Cap at 4 buckets like GitHub.
  let max = 0;
  for (const n of counts.values()) if (n > max) max = n;
  const intensity = (n: number): number => {
    if (n <= 0) return 0;
    if (max <= 1) return 4;
    const ratio = n / max;
    if (ratio < 0.25) return 1;
    if (ratio < 0.5) return 2;
    if (ratio < 0.75) return 3;
    return 4;
  };

  // Split into 7-day columns.
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  // Month label row: a label above a week column when that week contains the
  // 1st of a new month (or the first week we see that month).
  let lastMonth = -1;
  const monthHeaders = weeks.map((w) => {
    const m = w[0].getMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      return MONTH_LABELS[m];
    }
    return '';
  });

  const totalCount = [...counts.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="bg-chess-surface rounded-xl border border-chess-border/40 p-3">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[12px] text-chess-text-tertiary">Activity</span>
        <span className="text-[11px] text-chess-text-tertiary">·</span>
        <span className="text-[12px] text-chess-text">{totalCount} {label} in {daysBack} days</span>
        <div className="ms-auto flex items-center gap-1 text-[10px] text-chess-text-tertiary">
          <span>Less</span>
          <Cell level={0} colorClass={colorClass} />
          <Cell level={1} colorClass={colorClass} />
          <Cell level={2} colorClass={colorClass} />
          <Cell level={3} colorClass={colorClass} />
          <Cell level={4} colorClass={colorClass} />
          <span>More</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="inline-flex flex-col gap-0.5 min-w-full">
          {/* Month label row */}
          <div className="flex gap-0.5 mb-0.5 text-[10px] text-chess-text-tertiary h-3">
            {monthHeaders.map((m, i) => (
              <div key={i} className="w-3 text-center" style={{ minWidth: 12 }}>{m}</div>
            ))}
          </div>
          {/* 7 rows × N cols grid */}
          {[0, 1, 2, 3, 4, 5, 6].map(row => (
            <div key={row} className="flex gap-0.5">
              {weeks.map((w, col) => {
                const d = w[row];
                if (!d || d > today) {
                  return <div key={col} className="w-3 h-3" />;
                }
                const k = dayKey(d);
                const count = counts.get(k) ?? 0;
                const level = intensity(count);
                const title = count === 0
                  ? `${k}: no ${label}`
                  : `${k}: ${count} ${label}`;
                return <Cell key={col} level={level} colorClass={colorClass} title={title} />;
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Cell({ level, colorClass, title }: { level: number; colorClass: string; title?: string }) {
  const opacities = ['opacity-10', 'opacity-30', 'opacity-50', 'opacity-75', 'opacity-100'];
  const base = level === 0 ? 'bg-chess-bg/40 border border-chess-border/20' : `${colorClass} ${opacities[level]}`;
  return (
    <div
      className={`w-3 h-3 rounded-sm ${base}`}
      title={title}
      aria-label={title}
    />
  );
}
