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
    `Pick the right tool for the job — this is run from the user's Mac so you have:`,
    `  - **File edits** (Read/Edit/Write) for code changes, schema markup, new HTML files, sitemap.xml, etc.`,
    `  - **Chrome MCP** (mcp__Claude_in_Chrome__*) for browser tasks: submitting sitemaps to Search Console / Bing Webmaster Tools, filling directory listings (AlternativeTo, Slant, BetaList), etc. The user is already logged into their accounts in this browser — use that session.`,
    `  - **Bash / git** for committing the file changes after they're made.`,
    ``,
    `## Rules`,
    `- Make the change. Don't ask, don't propose, just do.`,
    `- Follow chess-dna's CLAUDE.md conventions for any code edits.`,
    `- Do NOT run npm run build, do NOT run npx base44 site deploy.`,
    `- Do NOT create test files unless the task description says so.`,
    `- For browser tasks: stop short of irreversible "Submit / Publish" clicks unless the task explicitly authorizes it (it usually will). Take a screenshot before the final click so it's auditable.`,
    `- Keep the change minimal and focused on this task only.`,
    `- If you cannot complete the task safely, exit without changes and explain why in your final message.`,
  ].filter(Boolean).join('\n');
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
  return { changed: gitChangedFiles() };
}

function commitTaskChanges(task) {
  if (!gitHasChanges()) return null;
  sh('git', ['add', '-A']);
  const title = `seo(${task.id}): ${task.title}`.slice(0, 72);
  const msg = `${title}\n\n${task.description.slice(0, 500)}\n\nCo-Authored-By: Claude Code <claude-code-bot@users.noreply.github.com>`;
  const r = sh('git', ['commit', '-m', msg]);
  if (r.status !== 0) throw new Error(`git commit failed: ${r.stderr}`);
  return sh('git', ['rev-parse', 'HEAD']).stdout.trim();
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
  let anyDone = false;
  let anyFailed = false;

  for (const task of pending) {
    const startLink = process.env.GITHUB_RUN_URL ? ` ([workflow](${process.env.GITHUB_RUN_URL}))` : '';
    await commentOnIssue(issue.number, `🔧 Working on **${task.title}**${startLink}…`);

    try {
      const { changed } = await executeTask(task);
      const sha = changed.length > 0 ? commitTaskChanges(task) : null;
      anyDone = true;

      body = rewriteCheckedBox(body.split('\n'), task.lineIndex);
      await updateIssue(issue.number, { body });

      const filesSummary = changed.length > 0 ? `\n\nFiles: \`${changed.join('`, `')}\`` : '\n\n(no file changes)';
      const shaSummary = sha ? `\n\nCommit: \`${sha.slice(0, 7)}\`` : '';
      await commentOnIssue(issue.number, `✅ **${task.title}** — done${shaSummary}${filesSummary}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[exec]   ✗ ${task.id} failed: ${msg}`);
      anyFailed = true;
      await commentOnIssue(issue.number, `❌ **${task.title}** — failed\n\n\`\`\`\n${msg.slice(0, 1500)}\n\`\`\``);
    }
  }

  if (anyDone && !anyFailed) {
    await setLabels(issue.number, ['seo-daily', 'seo-done']);
    await updateIssue(issue.number, { state: 'closed' });
  } else if (anyDone && anyFailed) {
    await setLabels(issue.number, ['seo-daily', 'seo-partial']);
  } else {
    await setLabels(issue.number, ['seo-daily', 'seo-failed']);
  }
  console.log(`[exec] Issue #${issue.number} → ${anyFailed ? (anyDone ? 'partial' : 'failed') : 'done'}`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
  if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required');

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
