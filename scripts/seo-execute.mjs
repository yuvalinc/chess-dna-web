#!/usr/bin/env node
// Claude Code Executor — runs all unchecked tasks of any GitHub issue labeled
// `seo-approved` (and not `seo-done`).
//
// Required env:
//   ANTHROPIC_API_KEY - for the Claude Code CLI
//   GH_TOKEN          - GitHub PAT with `repo` scope
// Optional env:
//   FORCE_ISSUE       - issue number to process (skip the label scan)
//   GITHUB_RUN_URL    - link back to the workflow run, embedded in comments
//   SEO_GH_REPO       - default: yuvalinc/chess-dna-web
//
// For each approved issue, this script:
//   1. Parses unchecked task checklist items from the body.
//   2. For each task: runs `claude -p "<description>" --print --dangerously-skip-permissions`.
//   3. Captures git diff, commits per task, comments the commit SHA on the issue, checks the box.
//   4. When all tasks are processed (done or failed), swaps the label to `seo-done` and closes the issue.

import { spawnSync } from 'node:child_process';

const GH_BASE = 'https://api.github.com';
const GH_REPO = process.env.SEO_GH_REPO ?? 'yuvalinc/chess-dna-web';
const CLAUDE_TIMEOUT_MS = 15 * 60 * 1000;

const GH_HEADERS = () => ({
  'Authorization': `Bearer ${process.env.GH_TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
});

async function gh(path, init = {}) {
  const res = await fetch(`${GH_BASE}${path}`, {
    ...init,
    headers: { ...GH_HEADERS(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function gitChangedFiles() {
  const r = sh('git', ['diff', '--name-only', 'HEAD']);
  return (r.stdout ?? '').trim().split('\n').filter(Boolean);
}

function gitHasChanges() {
  return (sh('git', ['status', '--porcelain']).stdout ?? '').trim().length > 0;
}

// Task line format from seo-daily.mjs:
//   - [ ] **P1** — Title here <!-- task-1 -->
//     > description line 1
//     > description line 2
//     Files: `src/foo.tsx`, `src/bar.tsx`
//
// We match the checklist item plus the indented description block beneath it.
function parseTasks(body) {
  const lines = body.split('\n');
  const tasks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^- \[( |x|X)\] \*\*(P[012])\*\* — (.+?)(?:\s*<!-- (task-\d+) -->)?$/);
    if (!m) continue;
    const [, checked, priority, title, id] = m;
    const descLines = [];
    const fileLines = [];
    let j = i + 1;
    while (j < lines.length && /^\s+/.test(lines[j])) {
      const trimmed = lines[j].trim();
      if (trimmed.startsWith('>')) descLines.push(trimmed.replace(/^>\s?/, ''));
      else if (trimmed.toLowerCase().startsWith('files:')) {
        const matches = [...trimmed.matchAll(/`([^`]+)`/g)];
        for (const fm of matches) fileLines.push(fm[1]);
      }
      j++;
    }
    tasks.push({
      lineIndex: i,
      checked: checked.toLowerCase() === 'x',
      priority,
      title,
      id: id ?? `task-${tasks.length + 1}`,
      description: descLines.join('\n'),
      filesTouched: fileLines,
    });
  }
  return { tasks, lines };
}

function rewriteCheckedBox(lines, lineIndex) {
  lines[lineIndex] = lines[lineIndex].replace(/^- \[ \]/, '- [x]');
  return lines.join('\n');
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
      : ``,
    ``,
    `## How to execute`,
    ``,
    `Pick the right tool for the job:`,
    `  - **File edits** (Read/Edit/Write) for code changes, schema markup, new HTML, sitemap.xml.`,
    `  - **Chrome MCP** (mcp__Claude_in_Chrome__*) for browser tasks: Search Console, AlternativeTo, etc. The user is already logged in.`,
    ``,
    `## Rules`,
    `- Make the change. Don't ask, don't propose, just do.`,
    `- Follow chess-dna's CLAUDE.md conventions for any code edits.`,
    `- Do NOT run \`git commit\`, \`git push\`, npm run build, or npx base44 site deploy. The wrapper handles git and deploy. Just leave changes in the working tree.`,
    `- Do NOT create test files unless the task description says so.`,
    `- For browser tasks: stop short of irreversible "Submit / Publish" clicks unless the task explicitly authorizes it. Take a screenshot before the final click so it's auditable.`,
    `- Keep the change minimal and focused on this task only.`,
    `- If you cannot complete the task safely, exit without changes and explain why in your final message.`,
  ].filter(Boolean).join('\n');
}

function gitChangedInDir(dir) {
  const r = sh('git', ['-C', dir, 'status', '--porcelain']);
  return (r.stdout ?? '').trim().split('\n').filter(Boolean).map(l => l.slice(3).trim());
}

function gitDiffStat(dir, baseRef = 'origin/main') {
  const r = sh('git', ['-C', dir, 'diff', '--shortstat', baseRef]);
  return (r.stdout ?? '').trim(); // e.g. " 3 files changed, 42 insertions(+), 5 deletions(-)"
}

// Run a task on its own feature branch via a temporary git worktree so it
// doesn't pollute the user's main working tree (which usually has WIP changes).
// On success, push the branch and open a draft PR.
async function executeTaskAsPR(issue, task) {
  const branchName = `seo/${issue.number}-${task.id}`;
  const worktreeDir = `/tmp/seo-wt-${issue.number}-${task.id}`;
  const repoRoot = process.cwd();

  // Cleanup any stale worktree at this path.
  sh('git', ['worktree', 'remove', '-f', worktreeDir], { stdio: 'ignore' });
  // Delete any stale local branch with the same name.
  sh('git', ['branch', '-D', branchName], { stdio: 'ignore' });

  // Make sure we have latest main.
  sh('git', ['fetch', 'origin', 'main'], { stdio: 'inherit' });

  // Create worktree on a new branch off origin/main.
  const wt = sh('git', ['worktree', 'add', '-b', branchName, worktreeDir, 'origin/main']);
  if (wt.status !== 0) {
    throw new Error(`git worktree add failed: ${wt.stderr || wt.stdout}`);
  }

  let prResult = null;
  try {
    // Run claude in the worktree.
    const prompt = buildClaudePrompt(task);
    console.log(`[exec] → ${task.id}: ${task.title} (branch ${branchName})`);
    const r = sh(
      'claude',
      ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'],
      { stdio: ['ignore', 'pipe', 'inherit'], cwd: worktreeDir, timeout: CLAUDE_TIMEOUT_MS },
    );
    if (r.error) throw r.error;
    if (typeof r.status !== 'number' || r.status !== 0) {
      throw new Error(`claude exited ${r.status} (signal=${r.signal ?? 'none'})`);
    }

    // Parse Claude CLI's JSON output to extract per-task cost. The CLI
    // emits { total_cost_usd, usage: { input_tokens, output_tokens, ... } }
    // when --output-format json is set. We later embed this in the comment
    // body so the dashboard can sum executor cost per issue / per day.
    let costUsd = 0;
    let totalTokens = 0;
    try {
      const parsed = JSON.parse(r.stdout || '{}');
      if (typeof parsed.total_cost_usd === 'number') costUsd = parsed.total_cost_usd;
      if (parsed.usage) {
        totalTokens = (parsed.usage.input_tokens || 0)
          + (parsed.usage.cache_creation_input_tokens || 0)
          + (parsed.usage.cache_read_input_tokens || 0)
          + (parsed.usage.output_tokens || 0);
      }
    } catch {
      // Output wasn't JSON (older CLI version?) — leave cost at 0.
    }
    console.log(`[exec]   ${task.id}: ${totalTokens.toLocaleString()} tokens · $${costUsd.toFixed(4)}`);

    const changed = gitChangedInDir(worktreeDir);
    if (changed.length === 0) {
      // No file changes (e.g. pure browser task). No PR to open.
      return { hadChanges: false, costUsd, totalTokens };
    }

    // Commit + push.
    const title = `seo(${task.id}): ${task.title}`.slice(0, 72);
    const msg = `${title}\n\n${task.description.slice(0, 400)}\n\nCloses task ${task.id} of #${issue.number}.\nCo-Authored-By: Claude Code <claude-code-bot@users.noreply.github.com>`;
    sh('git', ['-C', worktreeDir, 'add', '-A']);
    const commit = sh('git', ['-C', worktreeDir, 'commit', '-m', msg]);
    if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);

    const push = sh('git', ['-C', worktreeDir, 'push', '-u', 'origin', branchName]);
    if (push.status !== 0) throw new Error(`git push failed: ${push.stderr || push.stdout}`);

    const diffStat = gitDiffStat(worktreeDir);
    const sha = sh('git', ['-C', worktreeDir, 'rev-parse', 'HEAD']).stdout.trim();

    // Open draft PR.
    const pr = await gh(`/repos/${GH_REPO}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: `[SEO] ${task.title}`.slice(0, 72),
        head: branchName,
        base: 'main',
        body: [
          `Closes task **${task.id}** of #${issue.number}.`,
          ``,
          `## Task description`,
          task.description,
          ``,
          `## Files touched`,
          changed.map(f => `- \`${f}\``).join('\n'),
          ``,
          `_Generated by \`seo:execute\` daemon. Approve & merge from the /seo dashboard to ship + auto-deploy._`,
        ].join('\n'),
        draft: true,
      }),
    });

    prResult = {
      number: pr.number,
      url: pr.html_url,
      branch: branchName,
      sha,
      diffStat,
      files: changed,
    };
    return { hadChanges: true, pr: prResult, costUsd, totalTokens };
  } finally {
    // Always cleanup the worktree, even on failure.
    sh('git', ['worktree', 'remove', '-f', worktreeDir], { stdio: 'ignore' });
    // Keep the branch if a PR was opened (PR needs it). If no PR, delete it.
    if (!prResult) sh('git', ['branch', '-D', branchName], { stdio: 'ignore' });
    process.chdir(repoRoot);
  }
}

async function listApprovedIssues() {
  const q = encodeURIComponent(`repo:${GH_REPO} is:issue is:open label:seo-approved -label:seo-done`);
  const res = await gh(`/search/issues?q=${q}`);
  return res.items ?? [];
}

async function commentOnIssue(issueNumber, body) {
  return gh(`/repos/${GH_REPO}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

async function updateIssue(issueNumber, patch) {
  return gh(`/repos/${GH_REPO}/issues/${issueNumber}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

async function setLabels(issueNumber, labels) {
  return gh(`/repos/${GH_REPO}/issues/${issueNumber}/labels`, {
    method: 'PUT',
    body: JSON.stringify({ labels }),
  });
}

async function processIssue(issueNumber) {
  const issue = await gh(`/repos/${GH_REPO}/issues/${issueNumber}`);
  console.log(`[exec] Issue #${issue.number}: "${issue.title}"`);

  const { tasks, lines } = parseTasks(issue.body ?? '');
  const pending = tasks.filter(t => !t.checked);
  if (pending.length === 0) {
    console.log('[exec] No unchecked tasks; closing.');
    await setLabels(issue.number, ['seo-daily', 'seo-done']);
    await updateIssue(issue.number, { state: 'closed' });
    return;
  }

  let body = lines.join('\n');
  let anyReady = false;
  let anyFailed = false;

  for (const task of pending) {
    await commentOnIssue(issue.number, `🔧 Working on **${task.title}**…`);

    try {
      const { hadChanges, pr, costUsd = 0, totalTokens = 0 } = await executeTaskAsPR(issue, task);

      // Mark the box checked so we don't re-attempt this task on the next
      // daemon tick. (Approval/merge happens via the PR, not the checkbox.)
      body = rewriteCheckedBox(body.split('\n'), task.lineIndex);
      await updateIssue(issue.number, { body });

      // Stable trailer the dashboard parses to compute the "Dev" cost pill.
      const costLine = `\n\n_Dev cost: $${costUsd.toFixed(4)} · ${totalTokens.toLocaleString()} tokens_`;

      if (hadChanges && pr) {
        anyReady = true;
        const filesList = pr.files.slice(0, 8).map(f => `\`${f}\``).join(', ') + (pr.files.length > 8 ? `, +${pr.files.length - 8} more` : '');
        await commentOnIssue(
          issue.number,
          `📝 **${task.title}** — PR [#${pr.number}](${pr.url}) ready for review\n\n` +
          `${pr.diffStat || `${pr.files.length} file(s) changed`}\n\n` +
          `Files: ${filesList}\n\n` +
          `Branch: \`${pr.branch}\` · Commit: \`${pr.sha.slice(0, 7)}\`\n\n` +
          `[View full diff →](${pr.url}/files)  ·  Approve & merge from /seo to ship + deploy.` +
          costLine,
        );
      } else {
        // No file changes — e.g. a pure-browser task. Mark done immediately,
        // since there's no PR to review.
        anyReady = true;
        await commentOnIssue(
          issue.number,
          `✅ **${task.title}** — done (no file changes; browser-only task)` + costLine,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[exec]   ✗ ${task.id} failed: ${msg}`);
      anyFailed = true;
      await commentOnIssue(issue.number, `❌ **${task.title}** — failed\n\n\`\`\`\n${msg.slice(0, 1500)}\n\`\`\``);
    }
  }

  // The issue now sits in "awaiting-review" until the user merges the PRs in
  // /seo (or rejects them). We don't close the issue here — the daemon's
  // separate merge-and-deploy step closes it once all PRs are resolved.
  if (anyReady && !anyFailed) {
    await setLabels(issue.number, ['seo-daily', 'seo-awaiting-review']);
  } else if (anyReady && anyFailed) {
    await setLabels(issue.number, ['seo-daily', 'seo-awaiting-review', 'seo-partial']);
  } else {
    await setLabels(issue.number, ['seo-daily', 'seo-failed']);
  }
  console.log(`[exec] Issue #${issue.number} → ${anyFailed ? (anyReady ? 'partial' : 'failed') : 'awaiting-review'}`);
}

// Find all PRs linked to a given issue. We search the issue's comments for
// `PR #<N>` references emitted by executeTaskAsPR.
async function findIssuePRs(issueNumber) {
  const comments = await gh(`/repos/${GH_REPO}/issues/${issueNumber}/comments?per_page=100`);
  const numbers = new Set();
  for (const c of comments) {
    const matches = [...(c.body ?? '').matchAll(/PR\s+\[?#(\d+)\]?/g)];
    for (const m of matches) numbers.add(Number(m[1]));
  }
  return [...numbers];
}

async function getPr(prNumber) {
  return gh(`/repos/${GH_REPO}/pulls/${prNumber}`);
}

// Scan issues labeled "seo-awaiting-review" with all their PRs resolved
// (merged or closed). If any PR was merged, run `npx base44 site deploy`,
// then close the issue with the "seo-deployed" label.
async function deployResolvedIssues() {
  const q = encodeURIComponent(`repo:${GH_REPO} is:issue is:open label:seo-awaiting-review`);
  const search = await gh(`/search/issues?q=${q}`);
  const candidates = search.items ?? [];
  if (candidates.length === 0) return;

  for (const issueRef of candidates) {
    const prNums = await findIssuePRs(issueRef.number);
    if (prNums.length === 0) continue;
    const prs = await Promise.all(prNums.map(getPr));
    const allResolved = prs.every(p => p.state === 'closed'); // closed = merged OR rejected
    if (!allResolved) {
      console.log(`[exec] Issue #${issueRef.number}: ${prs.filter(p => p.state === 'open').length}/${prs.length} PR(s) still open — skipping deploy.`);
      continue;
    }
    const anyMerged = prs.some(p => p.merged_at != null);
    console.log(`[exec] Issue #${issueRef.number}: all ${prs.length} PR(s) resolved. ${anyMerged ? 'Deploying.' : 'No merges; closing.'}`);

    if (anyMerged) {
      // Pull latest main into the local checkout, then deploy.
      sh('git', ['fetch', 'origin', 'main'], { stdio: 'inherit' });
      sh('git', ['merge', '--ff-only', 'origin/main'], { stdio: 'inherit' });

      const deploy = sh('npx', ['base44', 'site', 'deploy', '-y'], { stdio: 'inherit', timeout: 10 * 60 * 1000 });
      const deployOk = deploy.status === 0;
      const mergedShas = prs.filter(p => p.merged_at).map(p => p.merge_commit_sha?.slice(0, 7)).filter(Boolean);
      await commentOnIssue(
        issueRef.number,
        deployOk
          ? `🚀 Deployed ${prs.filter(p => p.merged_at).length} merged PR(s) to chessdna.app. Commits: ${mergedShas.map(s => `\`${s}\``).join(', ')}.`
          : `❌ Deploy failed (\`npx base44 site deploy\` exited ${deploy.status}). The merged PRs are on main; deploy manually when ready.`,
      );
      if (deployOk) {
        await setLabels(issueRef.number, ['seo-daily', 'seo-deployed']);
        await updateIssue(issueRef.number, { state: 'closed' });
      }
    } else {
      // All PRs rejected — nothing to deploy, just close the issue.
      await setLabels(issueRef.number, ['seo-daily', 'seo-closed']);
      await updateIssue(issueRef.number, { state: 'closed' });
    }
  }
}

async function main() {
  // ANTHROPIC_API_KEY is optional locally — `claude -p` uses the user's
  // `claude login` session if no env var is set. It's only required in
  // unattended environments (GHA), but we don't enforce that here.
  if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required');

  // Step 1: deploy any issue whose PRs are all resolved.
  try {
    await deployResolvedIssues();
  } catch (e) {
    console.error('[exec] deployResolvedIssues error (non-fatal):', e.message);
  }

  // Step 2: pick up newly-approved issues and open PRs for their tasks.
  if (process.env.FORCE_ISSUE) {
    await processIssue(Number(process.env.FORCE_ISSUE));
    return;
  }

  const issues = await listApprovedIssues();
  if (issues.length === 0) {
    console.log('[exec] No approved issues found. Exiting.');
    return;
  }
  for (const issue of issues) {
    await processIssue(issue.number);
  }
}

main().catch(e => {
  console.error('[exec] FATAL:', e);
  process.exit(1);
});
