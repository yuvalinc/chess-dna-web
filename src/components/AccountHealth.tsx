// Account Health diagnostic strip. Reads existing dashboard state (issue list,
// drafts, posted/skipped tallies) and runs a small rules engine — surfaces
// account-level risks BEFORE they sink the campaign.
//
// Each rule is a function: (ctx) -> { ok: boolean; severity: 'warn'|'fail';
// title: string; detail: string }. Final score = passed / total * 100.

interface HealthContext {
  draftsLast7: number;
  draftsLast30: number;
  runsLast7: number;
  postedByType: { warmup: number; promotional: number; brand_monitor: number };
  totalPostedAcrossHistory: number;
}

interface Check {
  id: string;
  ok: boolean;
  severity: 'warn' | 'fail';
  title: string;
  detail: string;
}

function runChecks(ctx: HealthContext): Check[] {
  const out: Check[] = [];
  const totalPosted = ctx.postedByType.warmup + ctx.postedByType.promotional + ctx.postedByType.brand_monitor;

  // 1. Draft volume — at least one run in the last 7d.
  out.push({
    id: 'recent-run',
    ok: ctx.runsLast7 >= 1,
    severity: 'fail',
    title: 'Daily scan running',
    detail: ctx.runsLast7 >= 1
      ? `${ctx.runsLast7} run${ctx.runsLast7 === 1 ? '' : 's'} in last 7d`
      : 'No scans in 7 days — run npm run reddit:daily',
  });

  // 2. Healthy draft volume.
  out.push({
    id: 'volume',
    ok: ctx.draftsLast7 >= 30,
    severity: 'warn',
    title: 'Healthy draft volume',
    detail: `${(ctx.draftsLast7 / 7).toFixed(1)}/day, target ~10+/day`,
  });

  // 3. At least some posting activity.
  out.push({
    id: 'posting',
    ok: totalPosted >= 1,
    severity: ctx.draftsLast7 > 0 ? 'warn' : 'fail',
    title: 'Posting activity',
    detail: totalPosted >= 1
      ? `${totalPosted} draft${totalPosted === 1 ? '' : 's'} posted in this batch`
      : 'No drafts marked posted yet — copy a Warmup draft to start',
  });

  // 4. 9:1 ratio respected.
  const ratioOK = ctx.postedByType.promotional === 0
    || ctx.postedByType.warmup >= ctx.postedByType.promotional * 9;
  out.push({
    id: 'ratio',
    ok: ratioOK,
    severity: 'fail',
    title: '9:1 warmup-to-promo ratio',
    detail: ratioOK
      ? `${ctx.postedByType.warmup}W / ${ctx.postedByType.promotional}P — healthy`
      : `${ctx.postedByType.warmup}W / ${ctx.postedByType.promotional}P — Reddit may flag`,
  });

  // 5. Variety — not posting only Warmup or only Promotional.
  const allWarmup = totalPosted >= 5 && ctx.postedByType.promotional === 0 && ctx.postedByType.brand_monitor === 0;
  out.push({
    id: 'variety',
    ok: !allWarmup,
    severity: 'warn',
    title: 'Post type variety',
    detail: allWarmup
      ? 'All posts are Warmup — try mixing in 1 Promotional once ratio allows'
      : 'Mix of post types',
  });

  // 6. Brand mention coverage — at least one this period for active monitoring.
  out.push({
    id: 'brand-tracking',
    ok: ctx.postedByType.brand_monitor >= 0, // always passes, informational
    severity: 'warn',
    title: 'Brand mentions tracked',
    detail: `${ctx.postedByType.brand_monitor} brand-monitor reply this batch`,
  });

  return out;
}

export default function AccountHealth(ctx: HealthContext) {
  const checks = runChecks(ctx);
  const passed = checks.filter(c => c.ok).length;
  const failed = checks.filter(c => !c.ok && c.severity === 'fail');
  const warned = checks.filter(c => !c.ok && c.severity === 'warn');
  const score = Math.round((passed / checks.length) * 100);
  const statusLabel = failed.length > 0 ? 'Needs attention' : warned.length > 1 ? 'Watch' : 'Healthy';
  const statusCls = failed.length > 0 ? 'bg-chess-blunder/15 text-chess-blunder border-chess-blunder/30'
    : warned.length > 1 ? 'bg-chess-mistake/15 text-chess-mistake border-chess-mistake/30'
    : 'bg-chess-best/15 text-chess-best border-chess-best/30';

  return (
    <div className="bg-chess-surface rounded-xl border border-chess-border/40 p-4 mb-3">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-bold text-chess-text">Account Health</h3>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded border ${statusCls}`}>
            {statusLabel}
          </span>
          <span className="text-[12px] text-chess-text-tertiary">
            {passed}/{checks.length} checks passed · score <strong className="text-chess-text">{score}/100</strong>
          </span>
        </div>
      </div>
      <div className="h-1.5 bg-chess-bg/40 rounded overflow-hidden mb-3">
        <div
          className={`h-full transition-all ${
            score >= 80 ? 'bg-chess-best' : score >= 60 ? 'bg-chess-accent' : score >= 40 ? 'bg-chess-mistake' : 'bg-chess-blunder'
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {checks.map(c => (
          <div
            key={c.id}
            className={`flex items-start gap-2 text-[12px] p-2 rounded border ${
              c.ok
                ? 'border-chess-border/20 bg-chess-bg/20'
                : c.severity === 'fail'
                  ? 'border-chess-blunder/30 bg-chess-blunder/5'
                  : 'border-chess-mistake/30 bg-chess-mistake/5'
            }`}
          >
            <span className={`mt-0.5 ${c.ok ? 'text-chess-best' : c.severity === 'fail' ? 'text-chess-blunder' : 'text-chess-mistake'}`}>
              {c.ok ? '✓' : c.severity === 'fail' ? '✕' : '⚠'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-chess-text">{c.title}</div>
              <div className="text-chess-text-tertiary text-[11px]">{c.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
