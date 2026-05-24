#!/usr/bin/env node
// Daily SEO agent run. Invokes the managed agent on Anthropic, parses output,
// opens a GitHub Issue with today's SEO digest + tasks. Idempotent per day.
//
// Required env:
//   ANTHROPIC_API_KEY - Anthropic API key with Managed Agents access
//   GH_TOKEN          - GitHub PAT with `repo` scope (creates and reads issues)
//
// Optional env:
//   SEO_AGENT_ID           - default: agent_01FF7U9ms15noELzXPDGk8cX
//   SEO_ENV_ID             - default: env_01XnkgKT2C35kgoGqQSWNisG
//   SEO_SITE_URL           - default: https://chess-dna-fdd5fbde.base44.app
//   SEO_KEYWORDS           - comma-separated; defaults to a starter set
//   SEO_KEYWORDCOM_PROJECT - default: chess-dna
//   SEO_GH_REPO            - default: yuvalinc/chess-dna-web
//   SEO_POLL_MAX_SEC       - default: 600 (10 min)
//
// Data source: this script assumes the keyword.com MCP server
// (https://app.keyword.com/mcp) is attached to the managed agent's environment.
// See docs/seo-agent.md → "Connect the keyword.com MCP".

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const GH_BASE = 'https://api.github.com';
const AGENT_ID = process.env.SEO_AGENT_ID ?? 'agent_01FF7U9ms15noELzXPDGk8cX';
const ENV_ID = process.env.SEO_ENV_ID ?? 'env_01MaCqWUQ4V56YXrwBXWcZG9';
const VAULT_IDS = (process.env.SEO_VAULT_IDS ?? 'vlt_011CbHjLyhN98b2FHPVd8obw')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const SITE_URL = process.env.SEO_SITE_URL ?? 'https://chess-dna-fdd5fbde.base44.app';
const KEYWORDS = (
  process.env.SEO_KEYWORDS ??
  'how to improve at chess, chess analysis app, chess pattern recognition, chess weakness analysis'
)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const KEYWORDCOM_PROJECT = process.env.SEO_KEYWORDCOM_PROJECT ?? 'chess-dna';
const GH_REPO = process.env.SEO_GH_REPO ?? 'yuvalinc/chess-dna-web';
const POLL_MAX_SEC = Number(process.env.SEO_POLL_MAX_SEC ?? 600);
const POLL_INTERVAL_SEC = 5;

const ANTHROPIC_HEADERS = () => ({
  'Content-Type': 'application/json',
  'x-api-key': process.env.ANTHROPIC_API_KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
});

const GH_HEADERS = () => ({
  'Authorization': `Bearer ${process.env.GH_TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
});

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function anthropic(path, init = {}) {
  const res = await fetch(`${ANTHROPIC_BASE}${path}`, {
    ...init,
    headers: { ...ANTHROPIC_HEADERS(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

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

async function createSession() {
  const body = {
    environment_id: ENV_ID,
    agent: { type: 'agent', id: AGENT_ID },
  };
  if (VAULT_IDS.length > 0) body.vault_ids = VAULT_IDS;
  return anthropic('/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function sendPrompt(sessionId, text) {
  return anthropic(`/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({
      events: [{
        type: 'user.message',
        content: [{ type: 'text', text }],
      }],
    }),
  });
}

async function pollSession(sessionId) {
  // The session begins in "idle", transitions to "running" once the agent
  // picks up the prompt, then returns to "idle" when finished. Polling
  // status alone has a race condition — we'd accept the initial idle.
  // Treat the session as done only when status is idle AND at least one
  // agent.message event exists.
  const start = Date.now();
  while ((Date.now() - start) / 1000 < POLL_MAX_SEC) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_SEC * 1000));
    const [sess, eventsPayload] = await Promise.all([
      anthropic(`/v1/sessions/${sessionId}`),
      anthropic(`/v1/sessions/${sessionId}/events`),
    ]);
    const status = sess.status ?? sess.state ?? 'unknown';
    if (status === 'failed' || status === 'errored' || status === 'error') {
      throw new Error(`Session ${sessionId} ended with status ${status}`);
    }
    const evList = eventsPayload.events ?? eventsPayload.data ?? [];
    const hasAgentMessage = evList.some(
      e => e.type === 'agent.message' || e.type === 'assistant.message',
    );
    const isIdle = status === 'idle' || status === 'completed' || status === 'done';
    if (isIdle && hasAgentMessage) return { session: sess, events: eventsPayload };
  }
  throw new Error(`Session ${sessionId} did not finish within ${POLL_MAX_SEC}s`);
}

async function fetchEvents(sessionId) {
  return anthropic(`/v1/sessions/${sessionId}/events`);
}

function extractFinalAgentText(eventsPayload) {
  const events = eventsPayload.events ?? eventsPayload.data ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const isAgentMsg =
      ev.type === 'agent.message' ||
      ev.type === 'assistant.message' ||
      ev.type === 'agent' ||
      ev.type === 'assistant';
    if (!isAgentMsg) continue;
    if (Array.isArray(ev.content)) {
      const text = ev.content
        .filter(c => c.type === 'text' && typeof c.text === 'string')
        .map(c => c.text)
        .join('');
      if (text) return text;
    }
    if (typeof ev.text === 'string') return ev.text;
    if (Array.isArray(ev.message?.content)) {
      return ev.message.content
        .filter(c => c.type === 'text' && typeof c.text === 'string')
        .map(c => c.text)
        .join('');
    }
  }
  throw new Error('No agent text event found in session');
}

function parseAgentJson(text) {
  const match = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    console.warn('[seo-daily] JSON block found but failed to parse:', e.message);
    return null;
  }
}

function sumTokensFromSession(sess) {
  const u = sess.usage ?? {};
  return (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
}

function buildPrompt(carryover = [], completed = []) {
  const today = todayIso();
  const carryoverBlock = carryover.length === 0
    ? ''
    : [
        ``,
        `## Previously skipped tasks (from #${carryover[0].fromIssue}, ${carryover[0].fromDate})`,
        ``,
        `These tasks were proposed in a recent run but the user chose to **skip** them — they neither approved them nor letting them execute. Reconsider for today:`,
        `  - If a task is still relevant and the underlying problem persists, **include it again** in your tasks list (refine the description if helpful).`,
        `  - If the situation has changed (e.g. the user fixed it manually, or context shifted), drop it.`,
        ``,
        ...carryover.map(t => `- **${t.priority}** — ${t.title}: ${t.description}`),
        ``,
      ].join('\n');
  const completedBlock = completed.length === 0
    ? ''
    : [
        ``,
        `## Already shipped (do NOT propose again)`,
        ``,
        `These tasks were proposed and either executed by Claude Code, merged via PR, or manually reviewed-and-confirmed in prior runs. The underlying changes are LIVE on ${SITE_URL}. Do not re-propose anything semantically equivalent — find different opportunities:`,
        ``,
        ...completed.slice(0, 40).map(t => `- ${t.title}  _(shipped ${t.fromDate}, #${t.fromIssue})_`),
        ``,
        `If you genuinely believe one of these needs further follow-up work, propose it with a clearly *different* title that explains the increment (e.g. "Extend JSON-LD to /learn/* article pages" rather than "Add JSON-LD structured data").`,
        ``,
      ].join('\n');
  return [
    `Today is ${today}. Run today's SEO/GEO analysis for ${SITE_URL}.`,
    ``,
    `Target keywords: ${KEYWORDS.join(', ')}`,
    `Keyword.com project: "${KEYWORDCOM_PROJECT}"`,
    carryoverBlock,
    completedBlock,
    ``,
    `## Data source`,
    ``,
    `Use the **keyword.com MCP** as the primary source of truth for rankings and AI`,
    `visibility. The server is connected to this environment at`,
    `https://app.keyword.com/mcp and exposes 60+ tools. Prefer its structured data`,
    `over generic web search — only fall back to web search if a tool fails or the`,
    `project is missing data.`,
    ``,
    `## Steps`,
    ``,
    `1. **Locate the project.** Call \`search_projects\` with name "${KEYWORDCOM_PROJECT}".`,
    `2. **Pull current SERP rankings.** Use \`list_keywords\` and \`get_keyword\` for each target.`,
    `3. **Identify movement.** Call \`serp_movers_window\` (last 7 days) and \`serp_anomalies\`.`,
    `4. **Check AI Visibility.** Call \`aiv_metrics\` and \`aiv_citations\` for ${SITE_URL}.`,
    `5. **Pick 3-5 actionable improvements** to ship this week. For each, name specific files in the chess-dna codebase if you know them.`,
    ``,
    `## Output`,
    ``,
    `At the very end of your reply, include a valid JSON code block matching this exact schema:`,
    ``,
    '```json',
    `{`,
    `  "summary": "2-3 sentence TL;DR.",`,
    `  "rankings": [`,
    `    {"keyword": "string", "engine": "google|bing|chatgpt|perplexity|claude|gemini", "position": 1, "url": "string", "notes": "string"}`,
    `  ],`,
    `  "tasks": [`,
    `    {`,
    `      "title": "Short imperative title",`,
    `      "description": "Detailed, specific instructions Claude Code can execute without re-research.",`,
    `      "priority": "P0|P1|P2",`,
    `      "filesTouched": ["src/..."],`,
    `      "timeEstimate": "5m|15m|30m|1h|2h+",`,
    `      "impact": "critical|high|medium|low",`,
    `      "effort": "low|medium|high",`,
    `      "lane": "code|browser",`,
    `      "scope": "website|external"`,
    `    }`,
    `  ]`,
    `}`,
    '```',
    ``,
    `Rules:`,
    `- If a ranking is not in the top 20, set position to null.`,
    `- Maximum 5 tasks. Quality over quantity.`,
    `- Each task description must be specific enough for Claude Code to execute without re-research.`,
    `- Do NOT call any keyword.com write tool (\`add_*\`, \`update_*\`, \`delete_*\`, \`refresh_*\`).`,
    ``,
    `Task field definitions:`,
    `- **timeEstimate**: realistic execution time for a competent operator (Claude Code or you).`,
    `- **impact**: "critical" = unblocks SEO entirely (e.g. removing homepage noindex), "high" = measurable rank lift expected, "medium" = incremental gain, "low" = cleanup / hygiene.`,
    `- **effort**: from the executor's perspective. "low" = 1-2 file edits or one form submission. "medium" = new file + cross-links. "high" = significant content creation or multi-step browser flow.`,
    `- **lane**: "code" = file edits in the chess-dna repo (Claude Code SDK). "browser" = needs Chrome MCP to drive a real browser logged into the user's accounts (Google Search Console, AlternativeTo, etc.).`,
    `- **scope**: "website" = changes the user's own site/repo. "external" = submission to an external platform / directory.`,
  ].join('\n');
}

function renderRankingsTable(rankings) {
  if (!Array.isArray(rankings) || rankings.length === 0) return '_No rankings captured._';
  const rows = rankings.map(r => {
    const pos = r.position == null ? '—' : String(r.position);
    const url = r.url ? `[link](${r.url})` : '';
    return `| ${r.keyword ?? ''} | ${r.engine ?? ''} | ${pos} | ${url} | ${(r.notes ?? '').replace(/\|/g, '\\|')} |`;
  });
  return [
    '| Keyword | Engine | Position | URL | Notes |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function renderTaskMeta(t) {
  const parts = [];
  if (t.timeEstimate) parts.push(`⏱ ${t.timeEstimate}`);
  if (t.impact) parts.push(`🎯 ${t.impact} impact`);
  if (t.effort) parts.push(`⚡ ${t.effort} effort`);
  if (t.lane) parts.push(t.lane === 'browser' ? '🌐 browser' : '💻 code');
  if (t.scope) parts.push(t.scope === 'external' ? '🌍 external' : '📍 website');
  return parts.length ? `  ${parts.join(' · ')}` : '';
}

function renderTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return '_No tasks proposed today._';
  return tasks
    .map((t, i) => {
      const id = `task-${i + 1}`;
      const meta = renderTaskMeta(t);
      const files = t.filesTouched?.length ? `\n  Files: \`${t.filesTouched.join('`, `')}\`` : '';
      const desc = String(t.description ?? '').split('\n').map(line => `  > ${line}`).join('\n');
      const head = `- [ ] **${t.priority ?? 'P2'}** — ${t.title ?? `Task ${i + 1}`} <!-- ${id} -->`;
      return [head, meta, desc, files].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

function buildIssueBody({ summary, rankings, tasks, sessionId, tokensUsed, rawOutput }) {
  return [
    `## Summary`,
    ``,
    summary ?? '_(no summary)_',
    ``,
    `## Rankings`,
    ``,
    renderRankingsTable(rankings),
    ``,
    `## Tasks`,
    ``,
    `Add the \`seo-approved\` label to approve all tasks for Claude Code execution. Uncheck any task to skip.`,
    ``,
    renderTasks(tasks),
    ``,
    `---`,
    ``,
    `<details>`,
    `<summary>Raw agent output</summary>`,
    ``,
    rawOutput ?? '',
    ``,
    `</details>`,
    ``,
    `_Anthropic session: \`${sessionId ?? '?'}\` · Tokens: ${tokensUsed ?? '?'} · Generated by \`scripts/seo-daily.mjs\`_`,
  ].join('\n');
}

async function findExistingIssue(runDate) {
  // Only block re-runs against OPEN issues. Once an issue is closed (manually
  // or by the executor), it stops blocking — useful for re-running today
  // after a script fix.
  const q = encodeURIComponent(`repo:${GH_REPO} is:issue is:open label:seo-daily in:title "${runDate}"`);
  const res = await gh(`/search/issues?q=${q}`);
  return res.items?.find(i => i.title.includes(runDate)) ?? null;
}

// Walks recent seo-daily issues (excluding today's) and partitions their tasks
// into three buckets the prompt can use:
//
//   carryover: user-skipped tasks from the *most recent* prior issue —
//     present to the agent as candidates to reconsider for today.
//   completed: tasks across the last N issues that the executor marked
//     ✅ done / 🔎 needs-review / 👁 reviewed / 🚀 merged. The agent must
//     NOT propose these again — that's how it "knows what we already did".
//   removed:   tasks the user explicitly 🗑 removed. Excluded everywhere
//     (no carryover, no need to inform the agent — they don't exist).
//
// Only the most-recent issue contributes to `carryover` (otherwise old
// proposals would loop forever). Completed/removed are aggregated across
// the last 10 issues to give the agent a wider memory of shipped work.
async function fetchPriorWork(todayDate) {
  const q = encodeURIComponent(`repo:${GH_REPO} is:issue label:seo-daily sort:created-desc`);
  const search = await gh(`/search/issues?q=${q}&per_page=10`);
  const recent = (search.items ?? []).filter(i => !i.title.includes(todayDate));
  if (recent.length === 0) return { carryover: [], completed: [] };

  const issues = await Promise.all(
    recent.slice(0, 10).map(async i => {
      const [bodyIssue, comments] = await Promise.all([
        gh(`/repos/${GH_REPO}/issues/${i.number}`),
        gh(`/repos/${GH_REPO}/issues/${i.number}/comments?per_page=100`),
      ]);
      return { issueMeta: i, body: bodyIssue.body ?? '', comments: comments ?? [] };
    }),
  );

  const completed = [];
  const carryover = [];

  issues.forEach((bundle, idx) => {
    const { issueMeta, body, comments } = bundle;
    const fromDate = (issueMeta.title.match(/SEO\s+(\d{4}-\d{2}-\d{2})/) || [])[1] ?? 'recent';
    const lines = body.split('\n');
    const isMostRecent = idx === 0;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^- \[( |x|X)\] \*\*(P[012])\*\* — (.+?)(?:\s*<!-- task-\d+ -->)?$/);
      if (!m) continue;
      const [, checkboxChar, priority, title] = m;
      const cleanTitle = title.trim();
      const checked = checkboxChar.toLowerCase() === 'x';

      const wasRemoved = comments.some(c => (c.body ?? '').startsWith('🗑') && (c.body ?? '').includes(`**${cleanTitle}**`));
      if (wasRemoved) continue; // gone — pretend it never existed

      const wasDone = comments.some(c => (c.body ?? '').startsWith('✅') && (c.body ?? '').includes(`**${cleanTitle}**`));
      const wasReviewed = comments.some(c => (c.body ?? '').startsWith('👁') && (c.body ?? '').includes(`**${cleanTitle}**`));
      const wasNeedsReview = comments.some(c => (c.body ?? '').startsWith('🔎') && (c.body ?? '').includes(`**${cleanTitle}**`));
      const wasMerged = comments.some(c => (c.body ?? '').startsWith('🚀') && (c.body ?? '').includes(`**${cleanTitle}**`));
      const wasFailed = comments.some(c => (c.body ?? '').startsWith('❌') && (c.body ?? '').includes(`**${cleanTitle}**`));

      if (wasDone || wasReviewed || wasMerged) {
        completed.push({ title: cleanTitle, fromDate, fromIssue: issueMeta.number });
        continue;
      }

      // Skipped-by-user candidate: only from the most recent issue, only if
      // checkbox is checked (= user unchecked → re-checked = skip) AND no
      // executor activity at all (no needs-review, no failure).
      if (isMostRecent && checked && !wasNeedsReview && !wasFailed) {
        const descLines = [];
        let j = i + 1;
        while (j < lines.length && /^\s+/.test(lines[j])) {
          const trimmed = lines[j].trim();
          if (trimmed.startsWith('>')) descLines.push(trimmed.replace(/^>\s?/, ''));
          j++;
        }
        carryover.push({
          title: cleanTitle,
          description: descLines.join(' ').slice(0, 240),
          priority,
          fromIssue: issueMeta.number,
          fromDate,
        });
      }
    }
  });

  // De-dupe completed by title (latest wins, but we just keep first occurrence
  // since `issues` is already newest-first).
  const seen = new Set();
  const uniqueCompleted = completed.filter(t => {
    const key = t.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { carryover, completed: uniqueCompleted };
}

async function main() {
  const today = todayIso();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
  if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required');

  console.log(`[seo-daily] ${today} — checking for existing issue...`);
  const existing = await findExistingIssue(today);
  if (existing) {
    console.log(`[seo-daily] Issue #${existing.number} already exists for ${today} (state=${existing.state}). Exiting.`);
    return;
  }

  console.log(`[seo-daily] Creating Anthropic session...`);
  const session = await createSession();
  const sessionId = session.id;
  console.log(`[seo-daily] Session ${sessionId} created.`);

  console.log(`[seo-daily] Looking up prior work (carryover + completed)…`);
  let carryover = [];
  let completed = [];
  try {
    ({ carryover, completed } = await fetchPriorWork(today));
    if (carryover.length > 0) {
      console.log(`[seo-daily] Carrying forward ${carryover.length} skipped task(s) from prior runs.`);
    }
    if (completed.length > 0) {
      console.log(`[seo-daily] Informing agent of ${completed.length} already-shipped task(s) to avoid duplicates.`);
    }
  } catch (e) {
    console.warn(`[seo-daily] Prior-work lookup failed (non-fatal):`, e.message);
  }

  console.log(`[seo-daily] Sending daily prompt (${KEYWORDS.length} keywords, ${carryover.length} carryover, ${completed.length} completed)...`);
  await sendPrompt(sessionId, buildPrompt(carryover, completed));

  console.log(`[seo-daily] Polling session until idle (max ${POLL_MAX_SEC}s)...`);
  const { session: finished, events: eventsPayload } = await pollSession(sessionId);

  const finalText = extractFinalAgentText(eventsPayload);

  const parsed = parseAgentJson(finalText) ?? {};
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, 5) : [];
  const rankings = Array.isArray(parsed.rankings) ? parsed.rankings : [];
  const summary = typeof parsed.summary === 'string' ? parsed.summary : finalText.slice(0, 400);
  const tokensUsed = sumTokensFromSession(finished);

  console.log(`[seo-daily] Creating GitHub issue (${tasks.length} tasks)...`);
  const issue = await gh(`/repos/${GH_REPO}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title: `SEO ${today} — ${tasks.length} task${tasks.length === 1 ? '' : 's'}`,
      body: buildIssueBody({ summary, rankings, tasks, sessionId, tokensUsed, rawOutput: finalText }),
      labels: ['seo-daily', 'seo-pending'],
    }),
  });

  console.log(`[seo-daily] Done. Issue #${issue.number}: ${issue.html_url}`);
}

main().catch(e => {
  console.error('[seo-daily] FAILED:', e);
  process.exit(1);
});
