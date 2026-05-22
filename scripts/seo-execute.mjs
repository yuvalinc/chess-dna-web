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
    `  - **Chrome MCP** (mcp__Claude_in_Chrome__*) for browser tasks: Search Console, AlternativeTo, keyword.com web UI, etc. The user is already logged in.`,
    `  - **keyword.com MCP** (mcp__keyword_*) IF available locally. If a task needs keyword.com (add keywords, configure AIV, etc.) check whether these tools exist first. If they do, use them. If NOT, fall back to driving https://app.keyword.com via Chrome MCP using the user's already-logged-in browser session.`,
    ``,
    `## Rules`,
    `- Make the change. Don't ask, don't propose, just do.`,
    `- Follow chess-dna's CLAUDE.md conventions for any code edits.`,
    `- Do NOT run \`git commit\`, \`git push\`, npm run build, or npx base44 site deploy. The wrapper handles git and deploy. Just leave changes in the working tree.`,
    `- Do NOT create test files unless the task description says so.`,
    `- For browser tasks: stop short of irreversible "Submit / Publish" clicks unless the task explicitly authorizes it. Take a screenshot before the final click so it's auditable.`,
    `- Keep the change minimal and focused on this task only.`,
    `- **NEVER bluff.** If you couldn't actually make the change — because a required MCP isn't connected, a login is missing, or any other reason — say so clearly in your final message. Better to fail loudly than to silently pretend success. The user will catch the lie when they verify and that's worse than upfront honesty.`,
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

    const changed = gitChangedInDir(worktreeDir);
    if (changed.length === 0) {
      // No file changes (e.g. pure browser task). No PR to open.
      return { hadChanges: false };
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
    return { hadChanges: true, pr: prResult };
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
      const { hadChanges, pr } = await executeTaskAsPR(issue, task);

      // Mark the box checked so we don't re-attempt this task on the next
      // daemon tick. (Approval/merge happens via the PR, not the checkbox.)
      body = rewriteCheckedBox(body.split('\n'), task.lineIndex);
      await updateIssue(issue.number, { body });

      if (hadChanges && pr) {
        anyReady = true;
        const filesList = pr.files.slice(0, 8).map(f => `\`${f}\``).join(', ') + (pr.files.length > 8 ? `, +${pr.files.length - 8} more` : '');
        await commentOnIssue(
          issue.number,
          `📝 **${task.title}** — PR [#${pr.number}](${pr.url}) ready for review\n\n` +
          `${pr.diffStat || `${pr.files.length} file(s) changed`}\n\n` +
          `Files: ${filesList}\n\n` +
          `Branch: \`${pr.branch}\` · Commit: \`${pr.sha.slice(0, 7)}\`\n\n` +
          `[View full diff →](${pr.url}/files)  ·  Approve & merge from /seo to ship + deploy.`,
        );
      } else {
        // No file changes — e.g. a pure-browser task, or Claude couldn't do it.
        // Either way, we don't auto-mark "done" — the user has to verify it
        // actually happened (catches "bluff done" without any work).
        anyReady = true;
        await commentOnIssue(
          issue.number,
          `🔎 **${task.title}** — needs review (no file changes; verify the work happened then click "Mark reviewed" in /seo)`,
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
    const prs = prNums.length > 0 ? await Promise.all(prNums.map(getPr)) : [];
    const prsResolved = prs.every(p => p.state === 'closed'); // closed = merged OR rejected

    // Check needs-review tasks (browser/no-file-change tasks need explicit
    // human "Mark reviewed" before they count as complete).
    const comments = await gh(`/repos/${GH_REPO}/issues/${issueRef.number}/comments?per_page=100`);
    const reviewState = new Map();
    for (const c of comments) {
      const body = c.body ?? '';
      const titleM = body.match(/\*\*([^*]+?)\*\*/);
      if (!titleM) continue;
      const title = titleM[1].trim();
      if (body.startsWith('🔎')) {
        if (!reviewState.has(title)) reviewState.set(title, 'needs');
      } else if (body.startsWith('👁') || body.startsWith('✅')) {
        reviewState.set(title, 'reviewed');
      }
    }
    const unreviewed = [...reviewState.entries()].filter(([, s]) => s !== 'reviewed').map(([t]) => t);

    if (!prsResolved || unreviewed.length > 0) {
      const stillOpen = prs.filter(p => p.state === 'open').length;
      console.log(`[exec] Issue #${issueRef.number}: ${stillOpen} PR(s) open, ${unreviewed.length} task(s) unreviewed — skipping deploy.`);
      continue;
    }
    const anyMerged = prs.some(p => p.merged_at != null);
    console.log(`[exec] Issue #${issueRef.number}: all ${prs.length} PR(s) resolved + all reviews complete. ${anyMerged ? 'Deploying.' : 'No code changes; closing.'}`);

    if (anyMerged) {
      // Sanity check the main checkout BEFORE deploying. The risk we're
      // guarding against (per CLAUDE.md): deploying from a checkout that
      // doesn't have the latest origin/main, which would ship a stale
      // bundle and wipe in-flight server-side changes.
      sh('git', ['fetch', 'origin', 'main'], { stdio: 'inherit' });

      // 1. We must be on `main` (not a detached HEAD or feature branch).
      const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
      if (branch !== 'main') {
        await commentOnIssue(issueRef.number, `⚠️ Deploy aborted: main checkout is on branch \`${branch}\`, not main. Switch back to main and retry.`);
        continue;
      }

      // 2. Fast-forward to origin/main. If this fails, local main has
      // diverging commits — refuse to deploy.
      const merge = sh('git', ['merge', '--ff-only', 'origin/main'], { stdio: 'inherit' });
      if (merge.status !== 0) {
        await commentOnIssue(issueRef.number, `⚠️ Deploy aborted: \`git merge --ff-only origin/main\` failed in the main checkout. Local main has diverging commits or working-tree conflicts. Please reconcile (\`git status\` from /Users/yuval/Chess-dna), then re-trigger via /seo.`);
        continue;
      }

      // 3. After ff-merge, HEAD should be exactly at origin/main.
      const headSha = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
      const originSha = sh('git', ['rev-parse', 'origin/main']).stdout.trim();
      if (headSha !== originSha) {
        await commentOnIssue(issueRef.number, `⚠️ Deploy aborted: after \`git merge --ff-only\`, HEAD (${headSha.slice(0, 7)}) doesn't equal origin/main (${originSha.slice(0, 7)}). Something's off — please investigate.`);
        continue;
      }

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
