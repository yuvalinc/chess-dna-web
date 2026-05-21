#!/usr/bin/env node
// Claude Code Executor — runs all pending tasks of any approved SeoRun.
//
// Required env: ANTHROPIC_API_KEY, BASE44_TOKEN
// Optional env: FORCE_RUN_ID, GITHUB_RUN_URL
//
// For each candidate SeoRun (status="approved"), this script:
//   1. Marks the run as "executing".
//   2. For each task with status="pending", invokes the Claude Code CLI
//      headless with the task description. Captures any file changes via
//      git diff and commits them as one commit per task.
//   3. Updates task status in Base44 as it goes (in_progress -> done|failed).
//   4. Sets run.status to "done", "partial", or "failed" at the end.
//
// The workflow itself handles `git push` after this script exits.

import { createClient } from '@base44/sdk';
import { spawnSync } from 'node:child_process';

const APP_ID = '69a04516fd2be6e9fdd5fbde';
const CLAUDE_TIMEOUT_MS = 15 * 60 * 1000;

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function gitChangedFiles() {
  const r = sh('git', ['diff', '--name-only', 'HEAD']);
  return (r.stdout ?? '').trim().split('\n').filter(Boolean);
}

function gitHasStagedOrUnstaged() {
  const r = sh('git', ['status', '--porcelain']);
  return (r.stdout ?? '').trim().length > 0;
}

function buildClaudePrompt(task) {
  return [
    `Task: ${task.title}`,
    ``,
    `Description:`,
    task.description,
    ``,
    task.filesTouched && task.filesTouched.length > 0
      ? `Likely files to edit (the agent's best guess — verify before editing): ${task.filesTouched.join(', ')}`
      : `Find and edit the right files yourself.`,
    ``,
    `Rules:`,
    `- Make the change. Don't ask, don't propose, just do.`,
    `- Follow chess-dna's CLAUDE.md conventions.`,
    `- Do NOT run npm run build, do NOT run npx base44 site deploy.`,
    `- Do NOT create test files unless the task description says so.`,
    `- Keep the change minimal and focused on this task only.`,
    `- If you cannot complete the task safely, exit without changes and explain why in your final message.`,
  ].join('\n');
}

async function executeTask(task) {
  const prompt = buildClaudePrompt(task);
  console.log(`[exec] → ${task.id}: ${task.title}`);
  const r = sh(
    'claude',
    ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'],
    { stdio: ['ignore', 'pipe', 'inherit'], timeout: CLAUDE_TIMEOUT_MS },
  );
  if (r.error) throw r.error;
  if (typeof r.status !== 'number' || r.status !== 0) {
    throw new Error(`claude exited ${r.status} (signal=${r.signal ?? 'none'})`);
  }
  const changed = gitChangedFiles();
  return { changed, claudeStdout: r.stdout ?? '' };
}

function commitTaskChanges(task) {
  if (!gitHasStagedOrUnstaged()) return null;
  sh('git', ['add', '-A']);
  const title = `seo(${task.id}): ${task.title}`.slice(0, 72);
  const body = task.description.slice(0, 500);
  const msg = `${title}\n\n${body}\n\nCo-Authored-By: Claude Code <claude-code-bot@users.noreply.github.com>`;
  const r = sh('git', ['commit', '-m', msg]);
  if (r.status !== 0) throw new Error(`git commit failed: ${r.stderr}`);
  const sha = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  return sha;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
  if (!process.env.BASE44_TOKEN) throw new Error('BASE44_TOKEN is required');

  const base44 = createClient({ appId: APP_ID, token: process.env.BASE44_TOKEN });

  let candidates;
  if (process.env.FORCE_RUN_ID) {
    candidates = [await base44.entities.SeoRun.get(process.env.FORCE_RUN_ID)];
  } else {
    const all = await base44.entities.SeoRun.filter({ status: 'approved' });
    candidates = all;
  }

  if (candidates.length === 0) {
    console.log('[exec] No approved runs found. Exiting.');
    return;
  }

  for (const run of candidates) {
    if (!run || run.status !== 'approved') {
      console.log(`[exec] Skipping run ${run?.id} (status=${run?.status})`);
      continue;
    }

    console.log(`[exec] Run ${run.id} (${run.runDate}) → executing`);
    await base44.entities.SeoRun.update(run.id, {
      status: 'executing',
      workflowRunUrl: process.env.GITHUB_RUN_URL ?? '',
    });

    const tasks = Array.isArray(run.tasks) ? [...run.tasks] : [];
    let anyDone = false;
    let anyFailed = false;

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (t.status !== 'pending') continue;

      tasks[i] = { ...t, status: 'in_progress', startedAt: Date.now() };
      await base44.entities.SeoRun.update(run.id, { tasks });

      try {
        const { changed } = await executeTask(t);
        const sha = changed.length > 0 ? commitTaskChanges(t) : null;
        tasks[i] = {
          ...tasks[i],
          status: 'done',
          completedAt: Date.now(),
          filesTouched: changed.length > 0 ? changed : (t.filesTouched ?? []),
          commitSha: sha ?? undefined,
        };
        anyDone = true;
        console.log(`[exec]   ✓ done${sha ? ` @ ${sha.slice(0, 7)}` : ' (no changes)'}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[exec]   ✗ failed: ${msg}`);
        tasks[i] = {
          ...tasks[i],
          status: 'failed',
          completedAt: Date.now(),
          errorMessage: msg,
        };
        anyFailed = true;
      }

      await base44.entities.SeoRun.update(run.id, { tasks });
    }

    const finalStatus = anyFailed ? (anyDone ? 'partial' : 'failed') : 'done';
    await base44.entities.SeoRun.update(run.id, {
      status: finalStatus,
      completedAt: Date.now(),
    });
    console.log(`[exec] Run ${run.id} → ${finalStatus}`);
  }
}

main().catch(e => {
  console.error('[exec] FATAL:', e);
  process.exit(1);
});
