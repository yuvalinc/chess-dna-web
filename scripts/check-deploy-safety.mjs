#!/usr/bin/env node
/**
 * Pre-build safety check for Chess DNA deploys.
 *
 * Aborts the build with a clear message when both:
 *   1. The current working directory is a worktree under `.claude/worktrees/`.
 *   2. The main checkout (`/Users/yuval/Chess-dna`) has uncommitted tracked
 *      changes that the worktree's HEAD does NOT contain.
 *
 * Rationale: builds inside worktrees that miss main's in-progress work have
 * twice been deployed and wiped production (WaitlistGate, beta-testers,
 * new nav, new radar). See CLAUDE.md → "NEVER deploy from a worktree".
 *
 * To bypass intentionally (rare): `SKIP_DEPLOY_SAFETY=1 npm run build`.
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

if (process.env.SKIP_DEPLOY_SAFETY === '1') {
  console.log('[deploy-safety] SKIP_DEPLOY_SAFETY=1 set — skipping check.');
  process.exit(0);
}

const cwd = process.cwd();
const MAIN_REPO = '/Users/yuval/Chess-dna';

const inWorktree = cwd.includes('/.claude/worktrees/');
if (!inWorktree) {
  // Building from main is the supported path — nothing to check.
  process.exit(0);
}

// In a worktree. Check main's tracked-files status.
let mainStatus = '';
try {
  mainStatus = execSync(`git -C ${MAIN_REPO} status --porcelain`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
} catch (err) {
  console.error(`[deploy-safety] Could not read git status of ${MAIN_REPO}:`, err.message);
  console.error('[deploy-safety] Refusing to build from a worktree without confirmation.');
  process.exit(1);
}

// Count only tracked (modified/added/deleted) lines — ignore untracked (??).
const dirtyLines = mainStatus
  .split('\n')
  .filter(line => line && !line.startsWith('??'));

if (dirtyLines.length === 0) {
  // Main is clean — the worktree's tree is a valid candidate. Allow.
  process.exit(0);
}

// Main has uncommitted tracked changes that the worktree does not contain.
console.error('');
console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.error('  🛑  DEPLOY-SAFETY GUARD: build aborted');
console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.error('');
console.error(`  You are building inside a worktree:`);
console.error(`    ${cwd}`);
console.error('');
console.error(`  ...but the main checkout has ${dirtyLines.length} uncommitted tracked file(s):`);
console.error(`    ${MAIN_REPO}`);
console.error('');
for (const line of dirtyLines.slice(0, 10)) {
  console.error(`    ${line}`);
}
if (dirtyLines.length > 10) {
  console.error(`    ... and ${dirtyLines.length - 10} more`);
}
console.error('');
console.error('  Building+deploying from this worktree would ship a bundle that is MISSING');
console.error('  those in-progress changes — production would lose work that is currently live.');
console.error('');
console.error('  To deploy correctly:');
console.error(`    cd ${MAIN_REPO} && npm run build && npx base44 site deploy -y`);
console.error('');
console.error('  To deliberately bypass (rare, only when you are SURE this is safe):');
console.error('    SKIP_DEPLOY_SAFETY=1 npm run build');
console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.error('');
process.exit(1);
