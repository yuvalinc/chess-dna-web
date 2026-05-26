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

function buildPrompt(carryover = []) {
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
  return [
    `Today is ${today}. Run today's SEO/GEO analysis for ${SITE_URL}.`,
    ``,
    `Target keywords: ${KEYWORDS.join(', ')}`,
    `Keyword.com project: "${KEYWORDCOM_PROJECT}"`,
    carryoverBlock,
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
    `2. **List existing tracked keywords.** Call \`list_keywords\` with that project_id. ALSO call \`aiv_list_domains\` and \`aiv_list_search_terms\` for the chessdna.app AIV domain. You MUST consume the actual return values — do NOT invent or assume what's tracked. Mention the existing keyword/prompt count in your summary.`,
    `3. **Pull current SERP rankings.** Use \`get_keyword\` for each target that exists; for missing ones, surface them as proposed additions (don't suggest re-adding ones that already exist).`,
    `4. **Identify movement.** Call \`serp_movers_window\` (last 7 days) and \`serp_anomalies\`.`,
    `5. **Check AI Visibility.** Call \`aiv_metrics\` and \`aiv_citations\` for ${SITE_URL}.`,
    `6. **Pick 3-5 actionable improvements** to ship this week. For each, name specific files in the chess-dna codebase if you know them.`,
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
    `- **Never suggest tracking a keyword or AIV prompt that already exists.** Before proposing any "Add X to keyword.com" task, you MUST have called \`list_keywords\` and \`aiv_list_search_terms\` and confirmed X is absent. If the user already tracks "how to improve at chess" in SERP but it's missing from AIV, frame the task as "Mirror existing SERP keywords into AIV (already tracked: …; missing from AIV: …)" — not as a fresh suggestion.`,
    `- **Each task description must cite the kw.com tool calls that informed it.** Include a one-line "_Based on: list_keywords (N tracked), aiv_list_search_terms (M configured), serp_movers_window (K movers)_" reference in each task description. If you didn't call a tool, don't claim you did, but also don't propose a task that would have been answered by that call.`,
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

// Look at the previous seo-daily issue (excluding today's, if any). For each
// task that ended up marked `[x]` WITHOUT a matching ✅ Done comment from the
// executor, that task was skipped by the user. We return its title +
// description so today's agent can reconsider them.
async function fetchCarryoverTasks(todayDate) {
  const q = encodeURIComponent(`repo:${GH_REPO} is:issue label:seo-daily sort:created-desc`);
  const search = await gh(`/search/issues?q=${q}&per_page=10`);
  const recent = (search.items ?? []).filter(i => !i.title.includes(todayDate));
  if (recent.length === 0) return [];
  const prev = recent[0];
  const [bodyIssue, comments] = await Promise.all([
    gh(`/repos/${GH_REPO}/issues/${prev.number}`),
    gh(`/repos/${GH_REPO}/issues/${prev.number}/comments?per_page=100`),
  ]);
  const body = bodyIssue.body ?? '';
  const lines = body.split('\n');
  const skipped = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^- \[(x|X)\] \*\*(P[012])\*\* — (.+?)(?:\s*<!-- task-\d+ -->)?$/);
    if (!m) continue;
    const [, , priority, title] = m;
    const cleanTitle = title.trim();
    const wasDone = (comments ?? []).some(c => {
      const cb = c.body ?? '';
      return cb.startsWith('✅') && cb.includes(`**${cleanTitle}**`);
    });
    const wasFailed = (comments ?? []).some(c => {
      const cb = c.body ?? '';
      return cb.startsWith('❌') && cb.includes(`**${cleanTitle}**`);
    });
    if (wasDone || wasFailed) continue;
    const descLines = [];
    let j = i + 1;
    while (j < lines.length && /^\s+/.test(lines[j])) {
      const trimmed = lines[j].trim();
      if (trimmed.startsWith('>')) descLines.push(trimmed.replace(/^>\s?/, ''));
      j++;
    }
    skipped.push({
      title: cleanTitle,
      description: descLines.join(' ').slice(0, 240),
      priority,
      fromIssue: prev.number,
      fromDate: (prev.title.match(/SEO\s+(\d{4}-\d{2}-\d{2})/) || [])[1] ?? 'recent',
    });
  }
  return skipped;
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

  console.log(`[seo-daily] Looking up previously-skipped tasks…`);
  let carryover = [];
  try {
    carryover = await fetchCarryoverTasks(today);
    if (carryover.length > 0) {
      console.log(`[seo-daily] Carrying forward ${carryover.length} skipped task(s) from prior runs.`);
    }
  } catch (e) {
    console.warn(`[seo-daily] Carryover lookup failed (non-fatal):`, e.message);
  }

  console.log(`[seo-daily] Sending daily prompt (${KEYWORDS.length} keywords, ${carryover.length} carryover)...`);
  await sendPrompt(sessionId, buildPrompt(carryover));

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
