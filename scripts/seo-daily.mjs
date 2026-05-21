#!/usr/bin/env node
// Daily SEO agent run. Invokes the managed agent on Anthropic, parses output,
// writes a SeoRun to Base44. Idempotent per runDate.
//
// Required env:
//   ANTHROPIC_API_KEY   - Anthropic API key with Managed Agents access
//   BASE44_TOKEN        - Base44 JWT with apps:write (see ~/.base44/auth/auth.json)
//
// Optional env (defaults baked in for the chess-dna SEO/GEO Agent):
//   SEO_AGENT_ID        - default: agent_01FF7U9ms15noELzXPDGk8cX
//   SEO_ENV_ID          - default: env_01XnkgKT2C35kgoGqQSWNisG
//   SEO_SITE_URL        - default: https://chess-dna-fdd5fbde.base44.app
//   SEO_KEYWORDS        - comma-separated; defaults to a starter set
//   SEO_POLL_MAX_SEC    - default: 600 (10 min)
//
// Usage:
//   node scripts/seo-daily.mjs

import { createClient } from '@base44/sdk';

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const APP_ID = '69a04516fd2be6e9fdd5fbde';
const AGENT_ID = process.env.SEO_AGENT_ID ?? 'agent_01FF7U9ms15noELzXPDGk8cX';
const ENV_ID = process.env.SEO_ENV_ID ?? 'env_01XnkgKT2C35kgoGqQSWNisG';
const SITE_URL = process.env.SEO_SITE_URL ?? 'https://chess-dna-fdd5fbde.base44.app';
const KEYWORDS = (
  process.env.SEO_KEYWORDS ??
  'how to improve at chess, chess analysis app, chess pattern recognition, chess weakness analysis'
)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const POLL_MAX_SEC = Number(process.env.SEO_POLL_MAX_SEC ?? 600);
const POLL_INTERVAL_SEC = 5;

const ANTHROPIC_HEADERS = () => ({
  'Content-Type': 'application/json',
  'x-api-key': process.env.ANTHROPIC_API_KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
});

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function api(path, init = {}) {
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

async function createSession() {
  return api('/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({
      environment_id: ENV_ID,
      agent: { type: 'agent', id: AGENT_ID },
    }),
  });
}

async function sendPrompt(sessionId, text) {
  return api(`/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({ events: [{ type: 'user', text }] }),
  });
}

async function pollSession(sessionId) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < POLL_MAX_SEC) {
    const sess = await api(`/v1/sessions/${sessionId}`);
    const status = sess.status ?? sess.state ?? 'unknown';
    if (status === 'idle' || status === 'completed' || status === 'done') return sess;
    if (status === 'failed' || status === 'errored' || status === 'error') {
      throw new Error(`Session ${sessionId} ended with status ${status}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_SEC * 1000));
  }
  throw new Error(`Session ${sessionId} did not reach idle within ${POLL_MAX_SEC}s`);
}

async function fetchEvents(sessionId) {
  return api(`/v1/sessions/${sessionId}/events`);
}

function extractFinalAgentText(eventsPayload) {
  const events = eventsPayload.events ?? eventsPayload.data ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'agent' || ev.type === 'assistant' || ev.role === 'assistant') {
      if (typeof ev.text === 'string') return ev.text;
      if (Array.isArray(ev.content)) {
        return ev.content
          .filter(c => c.type === 'text' && typeof c.text === 'string')
          .map(c => c.text)
          .join('');
      }
      if (Array.isArray(ev.message?.content)) {
        return ev.message.content
          .filter(c => c.type === 'text' && typeof c.text === 'string')
          .map(c => c.text)
          .join('');
      }
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
    ``,
    `Steps:`,
    `1. Check current rankings at https://trakkr.ai/dashboard if accessible.`,
    `2. Do live SERP searches in Google + Bing + ChatGPT + Perplexity + Claude + Gemini for each target keyword. Capture positions for ${SITE_URL}.`,
    `3. Identify the top 3-5 actionable improvements I can ship to chess-dna THIS WEEK to move on these rankings.`,
    `4. For each improvement, name specific files in the chess-dna codebase if you know them (e.g. src/pages/Overview.tsx, index.html, base44/entities/*.jsonc).`,
    ``,
    `Output requirement: at the very end of your reply, include a valid JSON code block matching this exact schema:`,
    ``,
    '```json',
    `{`,
    `  "summary": "2-3 sentence TL;DR of today's findings and what tasks matter most.",`,
    `  "rankings": [`,
    `    {"keyword": "string", "engine": "google|bing|chatgpt|perplexity|claude|gemini", "position": 1, "url": "string", "notes": "string"}`,
    `  ],`,
    `  "tasks": [`,
    `    {"title": "Short imperative title", "description": "Detailed instructions Claude Code can follow.", "priority": "P0|P1|P2", "filesTouched": ["src/..."]}`,
    `  ]`,
    `}`,
    '```',
    ``,
    `Rules for the JSON:`,
    `- If a ranking is not in the top 20, set position to null.`,
    `- Use P0 only for urgent / blocking. P1 = ship this week. P2 = nice to have.`,
    `- Maximum 5 tasks. Quality over quantity.`,
    `- Each task description must be specific enough that Claude Code can execute it without re-research.`,
  ].join('\n');
}

async function main() {
  const today = todayIso();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
  if (!process.env.BASE44_TOKEN) throw new Error('BASE44_TOKEN is required');

  console.log(`[seo-daily] ${today} — checking for existing run...`);
  const base44 = createClient({ appId: APP_ID, token: process.env.BASE44_TOKEN });

  const existing = await base44.entities.SeoRun.filter({ runDate: today });
  const reusable = existing.find(r => r.status !== 'failed');
  if (reusable) {
    console.log(`[seo-daily] Run already exists for ${today} (id=${reusable.id}, status=${reusable.status}). Exiting.`);
    return;
  }

  console.log(`[seo-daily] Creating SeoRun (status=running)...`);
  const run = await base44.entities.SeoRun.create({ runDate: today, status: 'running' });

  try {
    console.log(`[seo-daily] Creating Anthropic session...`);
    const session = await createSession();
    const sessionId = session.id;
    console.log(`[seo-daily] Session ${sessionId} created.`);

    await base44.entities.SeoRun.update(run.id, { agentSessionId: sessionId });

    console.log(`[seo-daily] Sending daily prompt (${KEYWORDS.length} keywords)...`);
    await sendPrompt(sessionId, buildPrompt());

    console.log(`[seo-daily] Polling session until idle (max ${POLL_MAX_SEC}s)...`);
    const finished = await pollSession(sessionId);

    console.log(`[seo-daily] Fetching events...`);
    const eventsPayload = await fetchEvents(sessionId);
    const finalText = extractFinalAgentText(eventsPayload);

    const parsed = parseAgentJson(finalText) ?? {};
    const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const tasksWithIds = rawTasks.map((t, i) => ({
      id: `t${i + 1}`,
      title: String(t.title ?? `Task ${i + 1}`),
      description: String(t.description ?? ''),
      priority: ['P0', 'P1', 'P2'].includes(t.priority) ? t.priority : 'P2',
      status: 'pending',
      filesTouched: Array.isArray(t.filesTouched) ? t.filesTouched : [],
    }));
    const rankings = Array.isArray(parsed.rankings) ? parsed.rankings : [];
    const summary = typeof parsed.summary === 'string' ? parsed.summary : finalText.slice(0, 400);

    const tokensUsed = sumTokensFromSession(finished);

    await base44.entities.SeoRun.update(run.id, {
      status: 'completed',
      rawOutput: finalText,
      summary,
      rankings,
      tasks: tasksWithIds,
      tokensUsed,
    });

    console.log(`[seo-daily] Done. ${tasksWithIds.length} tasks extracted. tokens=${tokensUsed}`);
  } catch (err) {
    console.error(`[seo-daily] FAILED:`, err);
    await base44.entities.SeoRun.update(run.id, {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

main();
