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

  // Completed-work memory: explicit list of tasks that already shipped or
  // were marked done in recent runs. Prevents the agent from proposing
  // "Add JSON-LD to /learn/" when /learn/ already has JSON-LD, or
  // "Configure AIV prompts" after the user manually configured them.
  const completedBlock = completed.length === 0
    ? ''
    : [
        ``,
        `## Already shipped — do NOT re-suggest`,
        ``,
        `The following tasks have been completed in recent runs. They are either:`,
        `  • _done_   — executor completed (no PR needed, e.g. browser-only task)`,
        `  • _pr-open_  — executor opened a PR; the work is in motion`,
        `  • _merged_   — PR merged + deployed`,
        `  • _manually-done_ — user marked it done in the /seo dashboard (handled outside the agent)`,
        ``,
        `**Never propose a task whose title is substantially similar to anything in this list** unless you have specific evidence the underlying problem has regressed. If you propose follow-up work that builds on something here, reference the original task title so the user can trace the lineage.`,
        ``,
        ...completed.map(t => `- _${t.marker}_ (${t.fromDate}, #${t.fromIssue}) — **${t.title}**`),
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
    `2. **List existing tracked keywords.** Call \`list_keywords\` with that project_id. ALSO call \`aiv_list_domains\` and \`aiv_list_search_terms\` for the chessdna.app AIV domain. You MUST consume the actual return values — do NOT invent or assume what's tracked. Mention the existing keyword/prompt count in your summary.`,
    `3. **Pull current SERP rankings.** Use \`get_keyword\` for each target that exists; for missing ones, surface them as proposed additions (don't suggest re-adding ones that already exist).`,
    `4. **Identify movement.** Call \`serp_movers_window\` (last 7 days) and \`serp_anomalies\`.`,
    `5. **Check AI Visibility — and harvest the citation list.** Call \`aiv_metrics\` AND \`aiv_citations\` for the chessdna.app AIV domain. The \`aiv_citations\` response is the most actionable single piece of data in this entire run — it returns:`,
    `   - \`domainSummary.topDomainsOverall\` — the 85 domains AI engines (ChatGPT / Perplexity / Gemini / Claude) actually cite when asked about chess apps. Today's top 16: reddit.com (53), chess.com (31), houseofstaunton.com (14), chessworld.net (13), chessnboards.com (12), youtube.com (8), support.chess.com (7), aa-chess.com (6), facebook.com (6), chessable.com (6), apps.apple.com (6), chessdir.app (5), chessiverse.com (5), lichess.org (5), chesssolve.com (4), cassandrachess.com (4). These are the places we MUST be mentioned to get cited by LLMs.`,
    `   - Per-domain \`urls\` — the SPECIFIC thread/page URLs that AI engines pull from. Especially for reddit.com: e.g. \`/r/chess/comments/.../what_is_your_favourite_chess_training_app\`, \`/r/chess/comments/.../chess_tactics_apps\`, \`/r/chess/comments/.../chess_app_recommendations\`. Treat these as priority Reddit outreach targets — a comment here gets cited 2-3× by LLMs compared to a random thread.`,
    `6. **Translate citation data into tasks.** For each high-value domain we're NOT yet mentioned in, propose:`,
    `   - **Reddit outreach**: pick the top-cited Reddit URLs from \`aiv_citations\` and propose specific comments. Use \`lane: browser\` + \`scope: external\` and quote the exact URL in the task description.`,
    `   - **Directory submissions**: if a directory-style domain (chessdir.app, chessable.com, alternativeto.net, apps.apple.com) shows up with ≥3 citations, propose a submission task. Use \`lane: browser\` + \`scope: external\`.`,
    `   - **Authority backlinks**: if an editorial site (chess.com, chessable.com, houseofstaunton.com, lichess.org) shows up, propose a guest-post / mention-outreach task with a draft pitch email. Use \`lane: code\` (drafting the email) and the user follows through via browser.`,
    `   - **AIV topic expansion**: if you spot a citation theme that's NOT covered by current AIV search terms, propose adding it via the kw.com web UI. Frame it as: "Add AIV topic 'X' targeting these subreddits/communities: [list]". Lane: browser. Scope: external. (The agent can't write AIV config via MCP today — \`aiv_*\` is read-only.)`,
    `7. **Pick 3-5 actionable improvements** to ship this week. At least 2 should leverage the citation-list insight (outreach to top-cited surfaces).`,
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
    `- **Keyword.com write tools — what you may and may not call.** You have the kw.com MCP fully attached. You MAY call:`,
    `   - \`add_keywords\` when you propose a new task that targets a new search query. Add it to the chessdna.app project (id 3821625) with the tracking_url pointing at the existing or proposed /learn/ page. This means tracking is live the moment you propose the task, not a day later when the user manually adds it. Up to 10 new keywords per run — anything more is noise.`,
    `   - \`add_project\` if the user mentions a new domain to track (rare).`,
    `   - \`attach_tag\` / \`create_tag\` to organise the keyword set.`,
    `   You MUST NOT call: \`update_keywords\` (could change existing URLs the user trusts), \`delete_keywords\` (destructive), \`delete_project\` / \`archive_project\` (destructive), \`refresh_individual_keywords\` / \`refresh_keywords_by_project\` (eats quota). \`aiv_*\` is read-only at the MCP layer — to add a new AIV search-term prompt you must propose it as a manual task with lane: browser, scope: external.`,
    `- **When you call add_keywords, mention the keyword IDs you got back in the task description's "Based on:" trailer** so the user can verify the tracking exists.`,
    `- **Never suggest tracking a keyword or AIV prompt that already exists.** Before proposing any "Add X to keyword.com" task, you MUST have called \`list_keywords\` and \`aiv_list_search_terms\` and confirmed X is absent. If the user already tracks "how to improve at chess" in SERP but it's missing from AIV, frame the task as "Mirror existing SERP keywords into AIV (already tracked: …; missing from AIV: …)" — not as a fresh suggestion.`,
    `- **Each task description must cite the kw.com tool calls that informed it.** Include a one-line "_Based on: list_keywords (N tracked), aiv_list_search_terms (M configured), aiv_citations (X cited domains), serp_movers_window (K movers)_" reference in each task description. If you didn't call a tool, don't claim you did, but also don't propose a task that would have been answered by that call.`,
    `- **Cite specific URLs from aiv_citations**, not generic platforms. "Comment on r/chess" is rejected; "Comment on https://reddit.com/r/chess/comments/.../chess_app_recommendations — AI engines cite this thread 3× when asked about chess apps" is accepted. The user can verify the citation count from the same MCP response.`,
    `- **Reddit tasks belong to ReddGrow, not the Claude Code executor.** When proposing Reddit outreach, set \`lane: browser\` and \`scope: external\` and write the task description as "Suggested comment per URL: …" so the dashboard surfaces a "→ Open ReddGrow" route. The Claude Code executor cannot reliably post on Reddit (Reddit ToS forbids automated posting, the daemon's --dangerously-skip-permissions flag doesn't fix that, and aggressive posting from a logged-in account triggers shadowbans). The user has a separate ReddGrow side panel + Chrome extension that handles Reddit posting with a 9:1 ratio gate, karma tracking, and human-in-the-loop submit. ALWAYS route Reddit work there.`,
    `- **Reddit comments AND new posts both belong in ReddGrow.** Reddit-outreach tasks can be EITHER (a) comments on existing threads — the most common — or (b) new standalone posts you submit to a subreddit (text post in r/chessbeginners describing a personal chess journey, AMA-style post, etc.). For a new post, write the task description as: \`Subreddit: r/X · Post title: "…" · Post body: """ multi-line text """\` so the executor can inject it as a post-type draft (the Chrome extension's overlay then offers a submit-page flow). New posts are higher-effort + higher-reward — only propose 1 per run, and only for subs with ≤10% self-promo rules (r/chessbeginners, r/chessimprovement are usually OK; r/chess is strict). Cite the karma threshold needed for the target sub if known.`,
    `- **Skip archived Reddit threads.** Threads older than 6 months are archived by Reddit (no new comments or votes accepted). The aiv_citations data surfaces these because LLMs still cite them, but they're useless as outreach targets. If a URL you'd otherwise propose is older than ~180 days based on aiv_citations occurrence dates or URL slugs (Reddit URLs don't expose dates directly — your best signal is created_utc if you can fetch the JSON, otherwise be cautious with anything that has "1eaht3p"-style old short IDs vs current 7+ char IDs). The executor double-checks via Reddit JSON and drops archived ones automatically, but don't waste a task slot proposing them.`,
    `- **Mimic the AI-citation leaders' playbook.** Two competitors dominate AI citations despite being small:`,
    `  • **cassandrachess.com** — ranked 4× by ChatGPT despite minimal Reddit presence. Their single "/learn/best-chess-apps-2026" page gets 11 ChatGPT/Gemini/AI-Mode citations. The page is structured as: (a) JSON-LD Article schema with datePublished + dateModified + author + wordCount + timeRequired, (b) Honest-comparison framing ranking competitors openly (Lichess first, Chess.com second, their own product third), (c) "Best for / Strengths / Weaknesses" per app, (d) 7-language hreflang alternates (en/fr/es/de/pt/ru/x-default). When chess-dna gets cited, it'll likely be from a page like this — propose creating one (lane: code, scope: website) targeting "best chess analysis app 2026" or "best chess training app 2026" if we don't have one yet.`,
    `  • **chesssolve.com** — explicitly allowlists 14 AI bot user-agents in robots.txt (GPTBot, OAI-SearchBot, ChatGPT-User, anthropic-ai, ClaudeBot, Claude-Web, PerplexityBot, YouBot, cohere-ai, Google-Extended, Amazonbot, Bytespider, Applebot-Extended, FacebookBot). And serves a structured \`/llms.txt\` with 28+ question-style blog posts, each with a one-line description that's exactly what AI engines want to summarize. Sample titles: "How to Get From 1000 to 1500 Elo: The Honest Roadmap", "Why You Keep Throwing Away Won Games (And How to Stop)", "Chess Tactics Training: Why You Keep Blundering". Chess DNA's robots.txt now matches this allowlist (already shipped). The remaining gap is the blog volume — propose 1 question-style /learn/ article per daily run, with the title phrased as an exact AI query.`,
    `- **Title patterns that get AI-cited.** When proposing /learn/ pages, prefer titles that match natural-language AI queries verbatim. Examples that work: "How to Improve at Chess from 1200 to 1600", "Why You Keep Losing in the Endgame", "Best Chess Analysis App for Improvement 2026". Examples that don't: "Chess Pattern Analysis", "Improve Your Chess" (too generic, no question framing).`,
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

// Walk the last 10 SEO daily issues for tasks that were completed — by the
// executor (✅), shipped via PR (📝 / 🚀), or marked manually done (🏁).
// Returned as a flat list of titles + dates so the agent can avoid re-
// suggesting work that's already done. Replaces the reverted commit
// d09810f's "memory of shipped work" feature.
async function fetchCompletedTasks() {
  const q = encodeURIComponent(`repo:${GH_REPO} is:issue label:seo-daily sort:created-desc`);
  const search = await gh(`/search/issues?q=${q}&per_page=10`);
  const recent = search.items ?? [];
  if (recent.length === 0) return [];

  const completed = [];
  // Fan out comment fetches for the recent issues with a small concurrency
  // bound — search returns titles only, completion state lives in comments.
  for (const issue of recent.slice(0, 10)) {
    let comments;
    try {
      comments = await gh(`/repos/${GH_REPO}/issues/${issue.number}/comments?per_page=100`);
    } catch { continue; }
    const dateLabel = (issue.title.match(/SEO\s+(\d{4}-\d{2}-\d{2})/) || [])[1] ?? 'recent';
    const seenTitles = new Set();
    for (const c of comments ?? []) {
      const body = c.body ?? '';
      // ✅ = executor finished a no-PR task (e.g. browser-only).
      // 📝 = executor opened a PR — counts as "in motion / done" so we don't re-suggest.
      // 🚀 = PR merged.
      // 🏁 = user manually marked done outside the dashboard.
      if (!/^[✅📝🚀🏁]/.test(body)) continue;
      const titleM = body.match(/\*\*([^*]+?)\*\*/);
      if (!titleM) continue;
      const title = titleM[1].trim();
      if (seenTitles.has(title)) continue;
      seenTitles.add(title);
      const marker = body.startsWith('🏁') ? 'manually-done'
        : body.startsWith('🚀') ? 'merged'
        : body.startsWith('📝') ? 'pr-open'
        : 'done';
      completed.push({ title, marker, fromIssue: issue.number, fromDate: dateLabel });
    }
  }
  return completed;
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

  console.log(`[seo-daily] Looking up shipped tasks (do-not-re-suggest list)…`);
  let completed = [];
  try {
    completed = await fetchCompletedTasks();
    if (completed.length > 0) {
      console.log(`[seo-daily] Tracking ${completed.length} previously-completed task(s) across last 10 runs.`);
    }
  } catch (e) {
    console.warn(`[seo-daily] Completed-tasks lookup failed (non-fatal):`, e.message);
  }

  console.log(`[seo-daily] Sending daily prompt (${KEYWORDS.length} keywords, ${carryover.length} carryover, ${completed.length} shipped)...`);
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
