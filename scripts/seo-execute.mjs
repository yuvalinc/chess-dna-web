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

    // Capture Claude Code's actual response text so the executor can surface
    // what the agent THOUGHT it did. For tasks Claude can't physically
    // execute (browser visits, sending emails, posting on Reddit, etc.) the
    // response usually explains the limitation + provides a draft for the
    // user to do manually. We use this to write an honest "needs review"
    // comment instead of pretending the task was done.
    let claudeResponse = '';
    try {
      const parsed = JSON.parse(r.stdout || '{}');
      claudeResponse = String(parsed.result ?? '').slice(0, 2400);
    } catch {}

    const changed = gitChangedInDir(worktreeDir);
    if (changed.length === 0) {
      // No file changes (e.g. pure browser task, email, manual outreach).
      // No PR to open. Return the response text so the caller can surface it
      // for verification — Claude Code can't physically visit sites, send
      // emails, or post on social media from this environment.
      return { hadChanges: false, costUsd, totalTokens, claudeResponse };
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

// ─── ReddGrow injection ────────────────────────────────────────────────────
// When a SEO task contains Reddit URLs (with optional suggested comments),
// we don't try to post them ourselves — we hand them off to the ReddGrow
// pipeline by appending draft blocks to today's reddit-daily issue. The
// /seo dashboard's ReddGrow tab + the Chrome extension take over from there.

const REDDIT_USER_AGENT = process.env.REDDIT_USER_AGENT
  ?? 'chess-dna:seo-executor:1.0 (by /u/Inside-Essay-617)';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Parse one of two shapes from a SEO task description:
//   (a) Comments: "1. <reddit-url> — … Suggested comment: '…'"
//   (b) Posts:    "Subreddit: r/X · Post title: '…' · Post body: \"\"\" … \"\"\""
// Returns a unified list of injection items with kind: 'comment' | 'post'.
//
// SEO daily renders task descriptions as markdown blockquotes (every line
// gets a "  > " prefix), so we strip those before tokenizing. Quote chars
// can be straight or typographic depending on the model's output.
function parseUrlCommentPairs(description) {
  if (!description) return [];
  const flat = description
    .split('\n')
    .map(line => line.replace(/^\s*>\s?/, ''))
    .join('\n');

  const items = [];

  // (a) Per-URL comments
  const blocks = flat.split(/\n(?=\s*\d+\.\s+https?:\/\/(?:www\.|old\.|sh\.|new\.)?reddit\.com\/)/);
  for (const block of blocks) {
    const urlM = block.match(/(https?:\/\/(?:www\.|old\.|sh\.|new\.)?reddit\.com\/r\/[^\s)\]'"<>]+)/);
    if (!urlM) continue;
    const url = urlM[1].replace(/[.,;]+$/, '');
    const commentM = block.match(/Suggested(?:\s+comment)?\s*:\s*['"‘’“”]([^'"‘’“”]+)['"‘’“”]/i);
    items.push({ kind: 'comment', url, suggestedComment: commentM?.[1] ?? null });
  }

  // (b) Standalone post drafts — "Subreddit: r/X · Post title: '…' · Post body: '…'"
  // Body can be a single-quoted string OR a triple-quoted multi-line block.
  const postRegex = /Subreddit:\s*r\/([\w-]+)[\s·\.,]*Post\s+title:\s*['"‘’“”]([^'"‘’“”\n]+)['"‘’“”][\s·\.,]*Post\s+body:\s*(?:"{3}([\s\S]+?)"{3}|['"‘’“”]([\s\S]+?)['"‘’“”])/gi;
  let m;
  while ((m = postRegex.exec(flat)) !== null) {
    const [, sub, title, bodyTriple, bodySingle] = m;
    items.push({
      kind: 'post',
      subreddit: sub,
      postTitle: title.trim(),
      postBody: (bodyTriple ?? bodySingle ?? '').trim(),
    });
  }
  return items;
}

async function fetchRedditThread(url) {
  const base = url.replace(/[?#].*$/, '').replace(/\/$/, '');
  const jsonUrl = `${base}.json`;
  const res = await fetch(jsonUrl, { headers: { 'User-Agent': REDDIT_USER_AGENT } });
  if (!res.ok) return null;
  const data = await res.json();
  const post = data?.[0]?.data?.children?.[0]?.data;
  if (!post) return null;
  // Note: we used to drop archived/locked threads here, but the user wants
  // ALL agent-suggested copy visible in ReddGrow — the suggested comments
  // are reusable on similar live threads, and silent drops caused "agent
  // promised 4 drafts, only 1 landed" frustration. Pass the archived flag
  // through; buildDraftBlock renders an ⚠ ARCHIVED marker for those.
  if (post.archived || post.locked) {
    console.log(`[exec]   archived/locked (still injecting with marker): ${url}`);
  }
  return {
    subreddit: post.subreddit,
    title: post.title ?? '',
    score: post.score ?? 0,
    num_comments: post.num_comments ?? 0,
    selftext: post.selftext ?? '',
    created_utc: post.created_utc ?? Math.floor(Date.now() / 1000),
    permalink: post.permalink ?? new URL(url).pathname,
    archived: post.archived ?? false,
    locked: post.locked ?? false,
  };
}

function buildDraftBlock(draft, idx) {
  // Two shapes: (a) commenting on an existing thread, (b) creating a new
  // standalone post. Posts have no `created_utc`/`score`/`num_comments`
  // because the thread doesn't exist yet; URL points at the subreddit's
  // /submit endpoint instead of an existing /comments/<id>/ permalink.
  if (draft.kind === 'post') {
    return [
      `### [r/${draft.subreddit}] ${draft.postTitle.replace(/[\[\]]/g, '')}  <!-- draft-${idx} -->`,
      `- **Type**: post`,
      `- **Match**: 100% _· seeded by SEO executor from ${draft.fromSeoIssue} (new post, not a comment)_`,
      `- **Subreddit**: r/${draft.subreddit}`,
      `- **URL**: https://www.reddit.com/r/${draft.subreddit}/submit`,
      ``,
      `**Post title**:`,
      `> ${draft.postTitle}`,
      ``,
      `**Post body**:`,
      '```',
      draft.postBody || '_(no body — write your own; this is a link-post template)_',
      '```',
      ``,
      '---',
      '',
    ].join('\n');
  }
  // Comment-on-existing-thread shape (the original path).
  // Archived/locked threads still get injected so the user has visibility
  // into the agent's suggested copy — they can reuse the text on a similar
  // live thread. The header carries an explicit ⚠ ARCHIVED marker so the
  // user doesn't waste a click trying to post.
  const archived = draft.archived || draft.locked;
  const ageHrs = ((Date.now() / 1000 - draft.created_utc) / 3600);
  const ageDisplay = ageHrs < 24
    ? `${ageHrs.toFixed(1)}h ago`
    : `${Math.round(ageHrs / 24)}d old`;
  const excerpt = (draft.selftext ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const matchSuffix = archived
    ? ' · ⚠ ARCHIVED — cannot comment, reuse copy on similar live thread'
    : '';
  const archivedTag = archived ? ' · 🔒 archived' : '';
  const archivedNote = archived
    ? [
        ``,
        `**⚠ ARCHIVED — Reddit blocks new comments on threads >6mo old.**`,
        `The suggested copy below is reusable on a similar live thread (search r/${draft.subreddit} for current discussions on the same topic).`,
      ].join('\n')
    : '';
  return [
    `### [r/${draft.subreddit}] ${draft.title.replace(/[\[\]]/g, '')}  <!-- draft-${idx} -->`,
    `- **Type**: promotional`,
    `- **Match**: 100% _· seeded by SEO executor from ${draft.fromSeoIssue} (AI-citation target)${matchSuffix}_`,
    `- **Posted**: ${ageDisplay} · ${draft.score}↑ · ${draft.num_comments} comments${archivedTag}`,
    `- **URL**: https://www.reddit.com${draft.permalink}`,
    ``,
    `**Original post**:`,
    `> ${excerpt || '_(link post, no body text)_'}${(draft.selftext ?? '').length > 240 ? '…' : ''}`,
    archivedNote,
    ``,
    `**AI draft**:`,
    '```',
    draft.suggestedComment ?? '_(no suggested comment from SEO agent — write your own to follow the warmup/promotional ratio)_',
    '```',
    ``,
    '---',
    '',
  ].filter(l => l !== '' || true).join('\n');
}

// Find the most recent OPEN reddit-daily issue regardless of date. Earlier
// code only looked for today's issue and created a fresh one if none — but
// that orphaned yesterday's still-unhandled drafts in a separate issue the
// dashboard wouldn't show by default. Preferring the most-recent-open issue
// means all pending drafts (today's daily scan + SEO-injected URLs + any
// stragglers from yesterday) accumulate in one place.
async function findOrCreateRedditIssue() {
  const today = todayIso();
  // Sort by created descending — newest open issue wins.
  const q = encodeURIComponent(`repo:${GH_REPO} is:issue is:open label:reddit-daily sort:created-desc`);
  const search = await gh(`/search/issues?q=${q}`);
  const existing = search.items?.[0];
  if (existing) return gh(`/repos/${GH_REPO}/issues/${existing.number}`);
  // Only create a new issue if absolutely nothing open exists.
  return gh(`/repos/${GH_REPO}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title: `Reddit ${today} — 0 drafts`,
      body: [
        `_Daily Reddit outreach — ${today}_`,
        ``,
        `## Summary`,
        `Created by the SEO executor on demand. The reddit-daily scan may add more drafts later.`,
        ``,
        `## Drafts`,
        ``,
      ].join('\n'),
      labels: ['reddit-daily', 'reddit-pending'],
    }),
  });
}

async function injectIntoReddGrow(task, seoIssueNumber) {
  const items = parseUrlCommentPairs(task.description);
  if (items.length === 0) return 0;

  const enriched = [];
  for (const item of items) {
    if (item.kind === 'post') {
      // Posts don't need Reddit-thread enrichment (the thread doesn't exist
      // yet — the user submits it via r/<sub>/submit). Pass through with
      // the SEO-supplied title + body verbatim.
      enriched.push({ ...item, fromSeoIssue: `#${seoIssueNumber}` });
      continue;
    }
    // Comments — fetch the existing thread so the draft block has accurate
    // metadata (title, age, score, archived?). fetchRedditThread() drops
    // archived/locked threads so they never reach ReddGrow.
    try {
      const meta = await fetchRedditThread(item.url);
      if (!meta) continue;
      enriched.push({ kind: 'comment', ...meta, ...item, fromSeoIssue: `#${seoIssueNumber}` });
      await new Promise(r => setTimeout(r, 600));
    } catch (e) {
      console.warn(`[exec]   reddit fetch failed for ${item.url}:`, e.message);
    }
  }
  if (enriched.length === 0) return 0;

  // Append to today's reddit-daily issue, re-numbering drafts so IDs don't
  // collide with existing ones. Deduplicate against existing drafts by Reddit
  // post ID (the 6-8 char base36 segment in /comments/<id>/) — same target
  // URL across multiple SEO runs would otherwise double-inject and clutter
  // the ReddGrow queue with the same thread twice.
  const target = await findOrCreateRedditIssue();
  const body = target.body ?? '';
  const existingCount = (body.match(/<!--\s*draft-\d+\s*-->/g) ?? []).length;
  const existingPostIds = new Set(
    [...body.matchAll(/\*\*URL\*\*:\s*\S*?\/comments\/([a-z0-9]+)/gi)].map(m => m[1])
  );
  // No auto-prune of archived drafts. The user wants ALL agent-suggested
  // copy visible in ReddGrow even when the target thread is archived —
  // the suggested comments are reusable on similar live threads, and
  // hiding them silently caused "didnt follow anymore" frustration earlier.
  // Archived drafts are clearly marked with ⚠ ARCHIVED in their block;
  // the user can ✕ Remove any they don't want via the dashboard.
  const liveBody = body;
  const liveExistingCount = (liveBody.match(/<!--\s*draft-\d+\s*-->/g) ?? []).length;
  const beforeDedup = enriched.length;
  const newDrafts = enriched.filter(d => {
    const id = (d.permalink || d.url || '').match(/\/comments\/([a-z0-9]+)/i)?.[1];
    if (id && existingPostIds.has(id)) {
      console.log(`[exec]   skip duplicate: already in #${target.number} — ${d.url || d.permalink}`);
      return false;
    }
    return true;
  });
  if (newDrafts.length === 0) {
    console.log(`[exec]   all ${beforeDedup} drafts already in #${target.number}, nothing to inject`);
    return 0;
  }
  const newBlocks = newDrafts
    .map((d, i) => buildDraftBlock(d, liveExistingCount + i + 1))
    .join('\n');

  // If there's no "## Drafts" heading (legacy issue body), add one.
  let newBody;
  if (/^##\s+Drafts\s*$/m.test(liveBody)) {
    newBody = liveBody.trimEnd() + '\n\n' + newBlocks;
  } else {
    newBody = liveBody.trimEnd() + '\n\n## Drafts\n\n' + newBlocks;
  }
  // Update the title to reflect the new count.
  const totalDrafts = liveExistingCount + newDrafts.length;
  await gh(`/repos/${GH_REPO}/issues/${target.number}`, {
    method: 'PATCH',
    body: JSON.stringify({
      body: newBody,
      title: `Reddit ${todayIso()} — ${totalDrafts} draft${totalDrafts === 1 ? '' : 's'}`,
    }),
  });
  const dupes = beforeDedup - newDrafts.length;
  console.log(`[exec]   → injected ${newDrafts.length} reddit draft(s) into #${target.number}${dupes > 0 ? ` (${dupes} duplicate${dupes === 1 ? '' : 's'} skipped)` : ''}`);
  return newDrafts.length;
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
  // Reddit tasks have a separate pipeline (ReddGrow tab + Chrome extension).
  // The Claude Code executor cannot reliably post on Reddit and shouldn't
  // try — running --dangerously-skip-permissions in a browser context against
  // a logged-in Reddit session is exactly the pattern that gets accounts
  // shadowbanned. Skip them with a one-time comment so the user knows.
  const isReddit = (t) =>
    /\bhttps?:\/\/(?:www\.|old\.|sh\.|new\.)?reddit\.com\b/i.test(t.description ?? '');
  const allPending = tasks.filter(t => !t.checked);
  const reddit = allPending.filter(isReddit);
  const pending = allPending.filter(t => !isReddit(t));

  // Local mutable body; gets rewritten when we flip task checkboxes.
  let body = lines.join('\n');

  // For each Reddit task: parse out the (URL, suggested-comment) pairs from
  // the task description, enrich each with Reddit thread metadata, and
  // append draft blocks to today's reddit-daily issue so they show up in
  // the ReddGrow tab immediately. Then mark the SEO task as routed.
  for (const t of reddit) {
    let injected = 0;
    try {
      injected = await injectIntoReddGrow(t, issue.number);
    } catch (e) {
      console.warn(`[exec]   ReddGrow injection failed for ${t.id}:`, e.message);
    }
    const note = injected > 0
      ? `${injected} draft${injected === 1 ? '' : 's'} injected into today's reddit-daily queue. Open /seo?tab=reddit to handle them with the Chrome extension.`
      : `No URLs could be injected (URL parsing failed or Reddit fetch errored). Handle manually via /seo?tab=reddit.`;
    await commentOnIssue(
      issue.number,
      `🔀 **${t.title}** — routed to ReddGrow.\n\n${note}`,
    );
    body = rewriteCheckedBox(body.split('\n'), t.lineIndex);
  }
  if (reddit.length > 0) {
    await updateIssue(issue.number, { body });
    console.log(`[exec] Skipped ${reddit.length} Reddit task(s) — routed to ReddGrow`);
  }

  if (pending.length === 0) {
    console.log('[exec] No unchecked code/non-Reddit tasks; closing.');
    await setLabels(issue.number, ['seo-daily', 'seo-done']);
    await updateIssue(issue.number, { state: 'closed' });
    return;
  }

  let anyReady = false;
  let anyFailed = false;

  for (const task of pending) {
    await commentOnIssue(issue.number, `🔧 Working on **${task.title}**…`);

    try {
      const { hadChanges, pr, costUsd = 0, totalTokens = 0, claudeResponse = '' } = await executeTaskAsPR(issue, task);

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
        // No file changes means Claude Code couldn't physically execute the
        // task (browser task, email send, social post). We previously marked
        // these as ✅ done which was misleading — nothing actually happened.
        // Post 🔎 needs-review instead, with Claude's actual response so the
        // user can see what was drafted vs what was claimed, and prompt them
        // to do the manual step + provide proof.
        anyReady = true;
        const responseExcerpt = claudeResponse
          ? `\n\n<details><summary>What Claude Code produced (no file changes were made)</summary>\n\n\`\`\`\n${claudeResponse.slice(0, 2000)}${claudeResponse.length > 2000 ? '\n…(truncated)' : ''}\n\`\`\`\n\n</details>`
          : '\n\n_Claude Code produced no output._';
        await commentOnIssue(
          issue.number,
          `🔎 **${task.title}** — needs your verification\n\n` +
          `**The executor cannot physically execute this task** — it has no browser, can't send emails, and can't post on external sites. Claude Code spent ${totalTokens.toLocaleString()} tokens reasoning about it but made zero file changes.\n\n` +
          `**You need to:**\n` +
          `1. Do the steps listed in the task description (visit the site / send the email / submit the form).\n` +
          `2. Capture a screenshot or save a copy of what you submitted.\n` +
          `3. Reply to this comment with the proof attached.\n` +
          `4. Click **Mark reviewed** (👁) in /seo so the agent knows it's done.\n\n` +
          `Until reviewed, the next daily agent run will assume this task is unfinished and may re-propose it.` +
          responseExcerpt +
          costLine,
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
