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

function buildPrompt() {
  const today = todayIso();
  return [
    `Today is ${today}. Run today's SEO/GEO analysis for ${SITE_URL}.`,
    ``,
    `Target keywords: ${KEYWORDS.join(', ')}`,
    `Keyword.com project: "${KEYWORDCOM_PROJECT}"`,
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
    `    {"title": "Short imperative title", "description": "Detailed instructions Claude Code can follow.", "priority": "P0|P1|P2", "filesTouched": ["src/..."]}`,
    `  ]`,
    `}`,
    '```',
    ``,
    `Rules:`,
    `- If a ranking is not in the top 20, set position to null.`,
    `- Maximum 5 tasks. Quality over quantity.`,
    `- Each task description must be specific enough for Claude Code to execute without re-research.`,
    `- Do NOT call any keyword.com write tool (\`add_*\`, \`update_*\`, \`delete_*\`, \`refresh_*\`).`,
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

function renderTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return '_No tasks proposed today._';
  return tasks
    .map((t, i) => {
      const id = `task-${i + 1}`;
      const files = t.filesTouched?.length ? `\n  Files: \`${t.filesTouched.join('`, `')}\`` : '';
      const desc = String(t.description ?? '').split('\n').map(line => `  > ${line}`).join('\n');
      return `- [ ] **${t.priority ?? 'P2'}** — ${t.title ?? `Task ${i + 1}`} <!-- ${id} -->\n${desc}${files}`;
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

  console.log(`[seo-daily] Sending daily prompt (${KEYWORDS.length} keywords)...`);
  await sendPrompt(sessionId, buildPrompt());

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
