#!/usr/bin/env node
/**
 * Pre-build safety check for Chess DNA deploys.
 *
 * Catches scenarios that have wiped production work before:
 *
 *   A. Building from a worktree while main has uncommitted tracked changes.
 *      → the worktree tree is missing those changes; deploying ships a bundle
 *        that wipes them from production.
 *
 *   B. Building from a worktree whose HEAD differs from main's HEAD.
 *      → the worktree is sitting at an older commit; even if main is clean,
 *        deploying from the worktree ships an older tree than main.
 *
 *   C. Building from main while main is AHEAD of origin/main with un-pushed
 *      commits. → if any future `git reset --hard origin/main` (or the SEO
 *      daemon's sync logic) runs, those local commits will be orphaned. This
 *      is exactly what wiped WaitlistGate / 250-games-cap / beta-tester work
 *      on 2026-05-23 02:32 — 6 local commits got reset away.
 *
 * Scenario A blocks. Scenario B blocks. Scenario C warns + offers to push
 * (controlled by AUTO_PUSH=1; default is warn-only so we don't surprise the
 * user with a remote write).
 *
 * To bypass intentionally (rare): `SKIP_DEPLOY_SAFETY=1 npm run build`.
 */
import { execSync } from 'node:child_process';

if (process.env.SKIP_DEPLOY_SAFETY === '1') {
  console.log('[deploy-safety] SKIP_DEPLOY_SAFETY=1 set — skipping check.');
  process.exit(0);
}

const cwd = process.cwd();
const MAIN_REPO = '/Users/yuval/Chess-dna';

function git(args, repo = MAIN_REPO) {
  try {
    return execSync(`git -C ${repo} ${args}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function abort(title, lines) {
  console.error('');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error(`  🛑  DEPLOY-SAFETY GUARD: ${title}`);
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('');
  for (const line of lines) console.error(`  ${line}`);
  console.error('');
  console.error('  To deliberately bypass (rare, only when you are SURE):');
  console.error('    SKIP_DEPLOY_SAFETY=1 npm run build');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('');
  process.exit(1);
}

const inWorktree = cwd.includes('/.claude/worktrees/');

if (inWorktree) {
  // ── Scenario A: main has uncommitted tracked changes ─────────────────────
  const mainStatus = git('status --porcelain');
  if (mainStatus === null) {
    abort('cannot read main repo status', [
      `Failed to run \`git status\` in ${MAIN_REPO}.`,
      'Refusing to build from a worktree without confirmation.',
    ]);
  }
  const dirtyLines = mainStatus
    .split('\n')
    .filter(line => line && !line.startsWith('??'));

  if (dirtyLines.length > 0) {
    abort('worktree build blocked — main has uncommitted work', [
      `You are building inside a worktree:`,
      `  ${cwd}`,
      ``,
      `...but the main checkout has ${dirtyLines.length} uncommitted tracked file(s):`,
      `  ${MAIN_REPO}`,
      ``,
      ...dirtyLines.slice(0, 10).map(l => `  ${l}`),
      ...(dirtyLines.length > 10 ? [`  ... and ${dirtyLines.length - 10} more`] : []),
      ``,
      `Building+deploying from this worktree would ship a bundle that is MISSING`,
      `those in-progress changes — production would lose work that is currently live.`,
      ``,
      `To deploy correctly:`,
      `  cd ${MAIN_REPO} && npm run build && npx base44 site deploy -y`,
    ]);
  }

  // ── Scenario B: worktree HEAD differs from main HEAD ─────────────────────
  // Even with a clean main, if the worktree sits at an older commit than main,
  // shipping the worktree's tree rolls production back to that older state.
  const mainHead = git('rev-parse HEAD');
  const worktreeHead = git('rev-parse HEAD', cwd);
  if (mainHead && worktreeHead && mainHead !== worktreeHead) {
    // Is worktree an ancestor of main? (worktree is older) Or a descendant?
    // Or are they on diverging branches? Block in all non-equal cases.
    const isAncestor = git(`merge-base --is-ancestor ${worktreeHead} ${mainHead}; echo $?`);
    const direction = isAncestor === '0'
      ? `worktree is BEHIND main by ${git(`rev-list --count ${worktreeHead}..${mainHead}`) || '?'} commit(s)`
      : `worktree has diverged from main`;
    abort('worktree build blocked — tree mismatch with main', [
      `You are building inside a worktree:`,
      `  ${cwd}  @ ${worktreeHead.slice(0, 7)}`,
      ``,
      `But main is at a different commit:`,
      `  ${MAIN_REPO}  @ ${mainHead.slice(0, 7)}`,
      ``,
      `  → ${direction}.`,
      ``,
      `Deploying from this worktree would ship that older/different tree to`,
      `production — silently overwriting newer work that's on main.`,
      ``,
      `To deploy correctly:`,
      `  cd ${MAIN_REPO} && npm run build && npx base44 site deploy -y`,
    ]);
  }

  process.exit(0);
}

// ── Building from main (or some other non-worktree dir) ──────────────────
// Scenario C: main is ahead of origin/main with un-pushed commits.
// If main gets reset to origin/main (intentionally or by a script), those
// local commits become orphans and the work is lost. We saw this happen
// on 2026-05-23 02:32 — 6 commits with WaitlistGate / 250-cap / beta-testers
// were orphaned by a `branch: Reset to origin/main` and stayed lost for
// ~24 hours until recovered via `git fsck --unreachable`.
//
// Block by default — push first, then deploy. Soft-fail to a warning when
// `git fetch` itself fails (offline; can't tell if we're ahead).

const fetchOk = git('fetch origin main --quiet') !== null;
if (fetchOk) {
  const ahead = git('rev-list --count origin/main..HEAD');
  if (ahead && Number(ahead) > 0) {
    const aheadLines = git(`log --format="%h %s" origin/main..HEAD`)?.split('\n') ?? [];
    abort('main is ahead of origin — push before deploying', [
      `Local main is ${ahead} commit(s) ahead of origin/main:`,
      ``,
      ...aheadLines.slice(0, 10).map(l => `  ${l}`),
      ...(aheadLines.length > 10 ? [`  ... and ${aheadLines.length - 10} more`] : []),
      ``,
      `These commits exist ONLY in your local repo. If anything resets main`,
      `to origin/main (the SEO daemon, a "clean up" rebase, a sync script),`,
      `they get orphaned and the work is lost — this exact pattern wiped`,
      `~16k lines of WaitlistGate / 250-cap / beta-tester work on 2026-05-23.`,
      ``,
      `Push first, then deploy:`,
      `  git push origin main && npm run build && npx base44 site deploy -y`,
    ]);
  }
} else {
  console.warn('[deploy-safety] could not fetch origin (offline?) — skipping un-pushed-commits check.');
}

process.exit(0);
