#!/usr/bin/env node
// Daily Reddit outreach scanner — finds chess threads where chess-dna.app is
// genuinely useful, scores them by relevance, and generates copy-paste-ready
// AI draft comments in casual Reddit voice. Opens a GitHub issue with the
// daily batch so the /reddit dashboard can show them.
//
// Mirrors scripts/seo-daily.mjs in style + GH-issue control-plane pattern,
// but talks directly to the Anthropic Messages API instead of going through
// a managed agent session — cheaper for per-thread one-shot generations.
//
// Required env:
//   ANTHROPIC_API_KEY - Anthropic API key
//   GH_TOKEN          - GitHub PAT with `repo` scope
//
// Optional env:
//   REDDIT_GH_REPO      - default: yuvalinc/chess-dna-web
//   REDDIT_USER_AGENT   - default: chess-dna:reddit-scanner:1.0 (by /u/Inside-Essay-617)
//   REDDIT_MODEL        - default: claude-sonnet-4-5-20250929
//   REDDIT_MAX_DRAFTS   - default: 12 (max threads to draft per day)
//   REDDIT_MIN_SCORE    - default: 50 (out of 100 — filter cutoff)
//   REDDIT_SUBREDDITS   - comma-separated; defaults to the 10 chess subs
//   REDDIT_LOOKBACK_HRS - default: 48 (only consider threads newer than this)

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const GH_BASE = 'https://api.github.com';
const REDDIT_BASE = 'https://www.reddit.com';

const GH_REPO = process.env.REDDIT_GH_REPO ?? 'yuvalinc/chess-dna-web';
const USER_AGENT = process.env.REDDIT_USER_AGENT ?? 'chess-dna:reddit-scanner:1.0 (by /u/Inside-Essay-617)';
const MODEL = process.env.REDDIT_MODEL ?? 'claude-sonnet-4-5-20250929';
const MAX_DRAFTS = Number(process.env.REDDIT_MAX_DRAFTS ?? 12);
const MIN_SCORE = Number(process.env.REDDIT_MIN_SCORE ?? 50);
const LOOKBACK_HRS = Number(process.env.REDDIT_LOOKBACK_HRS ?? 48);

const SUBREDDITS = (
  process.env.REDDIT_SUBREDDITS ??
  'chess,chessbeginners,Chesscom,ChessPuzzles,ChessBooks,chessclub,chessopenings,chessimprovement,LearnChess,blunder'
).split(',').map(s => s.trim()).filter(Boolean);

// Relevance keyword weights. Higher weight = stronger signal that chess-dna.app
// is a genuinely helpful suggestion for this thread.
const KEYWORDS = {
  // High-signal: directly describes the pain chess-dna solves.
  'analyze': 3, 'analysis': 3, 'analyse': 3,
  'weakness': 4, 'weaknesses': 4,
  'pattern': 3, 'patterns': 3, 'recurring': 3,
  'blunder': 3, 'blunders': 3, 'mistake': 2, 'mistakes': 2,
  'plateau': 4, 'stuck': 3, 'stagnant': 3,
  'improve': 2, 'improvement': 2, 'improving': 2,
  'review': 2, 'reviewing': 2,
  // Medium: implies competitor surface or relevant context.
  'chess.com': 2, 'lichess': 2, 'chesscom': 2,
  'engine': 1, 'stockfish': 1, 'evaluation': 1, 'eval': 1,
  'rapid': 1, 'blitz': 1, 'daily': 1, 'classical': 1,
  'rating': 1, 'elo': 1, 'rated': 1,
  // Low: chess-general but useful to confirm topic.
  'opening': 1, 'endgame': 1, 'middlegame': 1, 'tactics': 1,
  'training': 2, 'study': 2, 'studying': 2, 'coach': 2, 'coaching': 2,
  'app': 1, 'tool': 1, 'software': 1, 'website': 1,
};

const ANTHROPIC_HEADERS = () => ({
  'Content-Type': 'application/json',
  'x-api-key': process.env.ANTHROPIC_API_KEY,
  'anthropic-version': '2023-06-01',
});
const GH_HEADERS = () => ({
  'Authorization': `Bearer ${process.env.GH_TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
});
const REDDIT_HEADERS = () => ({ 'User-Agent': USER_AGENT });

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchJson(url, headers, label) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${label} ${url} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ─── Reddit ────────────────────────────────────────────────────────────────
async function fetchSubreddit(sub) {
  // Pull both hot and new for breadth — hot surfaces active discussions,
  // new surfaces opportunities to comment early before threads saturate.
  const [hot, fresh] = await Promise.all([
    fetchJson(`${REDDIT_BASE}/r/${sub}/hot.json?limit=25`, REDDIT_HEADERS(), `[reddit:hot/${sub}]`),
    fetchJson(`${REDDIT_BASE}/r/${sub}/new.json?limit=25`, REDDIT_HEADERS(), `[reddit:new/${sub}]`),
  ]);
  const posts = [...(hot.data?.children ?? []), ...(fresh.data?.children ?? [])]
    .map(c => c.data)
    .filter(p => p && !p.stickied && !p.over_18);
  // Deduplicate by post id (hot + new often overlap).
  const seen = new Set();
  return posts.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// ─── Scoring ───────────────────────────────────────────────────────────────
function scoreThread(post) {
  const ageHrs = (Date.now() / 1000 - post.created_utc) / 3600;
  if (ageHrs > LOOKBACK_HRS) return { score: 0, reasons: ['too old'] };
  if (ageHrs < 0.25) return { score: 0, reasons: ['too fresh (< 15 min)'] };

  const text = `${post.title}\n${post.selftext ?? ''}`.toLowerCase();

  let keywordScore = 0;
  const matched = [];
  for (const [kw, weight] of Object.entries(KEYWORDS)) {
    const re = new RegExp(`\\b${kw.replace('.', '\\.')}\\b`, 'g');
    const hits = (text.match(re) ?? []).length;
    if (hits > 0) {
      keywordScore += weight * Math.min(hits, 2); // cap to 2 hits per keyword
      matched.push(kw);
    }
  }
  // Normalize: empirically a strong thread hits ~12–20 weighted points.
  const keywordNorm = Math.min(keywordScore / 18, 1);

  // Engagement: a sweet spot of 2–25 comments — enough activity to be seen,
  // not so saturated that another reply gets buried.
  const c = post.num_comments;
  const engagement = c < 2 ? 0.2 : c <= 25 ? 1.0 : c <= 80 ? 0.6 : 0.3;

  // Freshness: prefer threads still on the front page of /new.
  const freshness = ageHrs < 6 ? 1.0 : ageHrs < 24 ? 0.85 : ageHrs < 48 ? 0.55 : 0.2;

  // Upvote ratio: low ratio = controversy, skip.
  const ratio = post.upvote_ratio ?? 1;
  if (ratio < 0.5) return { score: 0, reasons: ['low upvote ratio'] };

  const score = Math.round((keywordNorm * 0.6 + engagement * 0.2 + freshness * 0.2) * 100);

  const reasons = [];
  if (matched.length) reasons.push(`matched: ${matched.slice(0, 6).join(', ')}`);
  reasons.push(`age ${ageHrs.toFixed(1)}h`);
  reasons.push(`${c} comments`);
  reasons.push(`upvote ratio ${(ratio * 100).toFixed(0)}%`);

  return { score, reasons, matched };
}

// ─── Draft generation ──────────────────────────────────────────────────────
const SYSTEM_PROMPT = `you are drafting a reddit comment for the chess-dna.app team.

chess-dna is a free web app that takes a user's chess.com or lichess games, runs them through stockfish, and surfaces their recurring patterns + weaknesses (e.g. "you blunder back-rank tactics in time pressure"). it then drills them on their actual past mistakes. it's designed for 600–1800 elo improvers stuck on a plateau.

voice rules (these matter — drafts get rejected if they read like ads):
- lowercase, conversational, like a regular redditor typing fast
- 2–4 sentences max, no walls of text
- no em-dashes, no bullet lists, no markdown, no emojis
- speak from personal experience — "i used to / what worked for me / i tried"
- mention chess-dna ONCE, naturally, only if the thread actually benefits from it
- if the thread doesn't genuinely benefit from chess-dna, mention it not at all and just be a helpful redditor
- never say "you should check out / try / use chess dna" — that's advertising. instead describe what you do and let chess-dna be one detail among several
- disclose nothing — assume the reader knows nothing about your affiliation. the comment must sound like a peer

output ONLY the comment text, no preamble or quotes around it.`;

function buildUserPrompt(post) {
  const body = (post.selftext ?? '').slice(0, 1500);
  return `subreddit: r/${post.subreddit}
title: ${post.title}
${body ? `\nbody:\n${body}\n` : ''}
draft a comment.`;
}

async function generateDraft(post) {
  const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
    method: 'POST',
    headers: ANTHROPIC_HEADERS(),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(post) }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`messages ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text?.trim() ?? '';
  const tokens = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
  return { text, tokens };
}

// ─── Concurrency limiter ───────────────────────────────────────────────────
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = { error: e instanceof Error ? e.message : String(e) }; }
    }
  });
  await Promise.all(workers);
  return out;
}

// ─── Issue body ────────────────────────────────────────────────────────────
function buildIssueBody({ scanned, totalCandidates, drafted, tokens }) {
  const lines = [
    `_Daily Reddit outreach scan — ${todayIso()}_`,
    '',
    `## Summary`,
    `Scanned **${scanned.length}** subreddit${scanned.length === 1 ? '' : 's'}, found **${totalCandidates}** thread${totalCandidates === 1 ? '' : 's'} above the ${MIN_SCORE}% relevance threshold. Drafted **${drafted.length}** comments.`,
    '',
    `### Subreddits scanned`,
    scanned.map(s => `- r/${s.sub} — ${s.total} posts, ${s.qualified} qualified`).join('\n'),
    '',
    `## Drafts`,
    '',
  ];

  for (let i = 0; i < drafted.length; i++) {
    const d = drafted[i];
    const id = `draft-${i + 1}`;
    const ageHrs = ((Date.now() / 1000 - d.post.created_utc) / 3600).toFixed(1);
    const bodyExcerpt = (d.post.selftext ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
    lines.push(
      `### [r/${d.post.subreddit}] ${d.post.title.replace(/[\[\]]/g, '')}  <!-- ${id} -->`,
      `- **Match**: ${d.score}%${d.reasons?.length ? ` · _${d.reasons.join(' · ')}_` : ''}`,
      `- **Posted**: ${ageHrs}h ago · ${d.post.score}↑ · ${d.post.num_comments} comments`,
      `- **URL**: https://www.reddit.com${d.post.permalink}`,
      '',
      `**Original post**:`,
      `> ${bodyExcerpt || '_(link post, no body text)_'}${(d.post.selftext ?? '').length > 240 ? '…' : ''}`,
      '',
      `**AI draft**:`,
      '```',
      d.draft,
      '```',
      '',
      '---',
      '',
    );
  }

  lines.push(
    '',
    `_Tokens used: ${tokens.toLocaleString()} · Model: \`${MODEL}\` · Generated by \`scripts/reddit-daily.mjs\`_`,
  );
  return lines.join('\n');
}

// ─── GitHub ────────────────────────────────────────────────────────────────
async function findTodayIssue(today) {
  const q = encodeURIComponent(`repo:${GH_REPO} is:issue label:reddit-daily in:title ${today}`);
  const res = await fetch(`${GH_BASE}/search/issues?q=${q}`, { headers: GH_HEADERS() });
  if (!res.ok) return null;
  const data = await res.json();
  return data.items?.[0] ?? null;
}

async function createIssue(body, draftCount) {
  const res = await fetch(`${GH_BASE}/repos/${GH_REPO}/issues`, {
    method: 'POST',
    headers: GH_HEADERS(),
    body: JSON.stringify({
      title: `Reddit ${todayIso()} — ${draftCount} draft${draftCount === 1 ? '' : 's'}`,
      body,
      labels: ['reddit-daily', 'reddit-pending'],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`gh create issue ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY required');
  if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN required');

  const today = todayIso();
  const existing = await findTodayIssue(today);
  if (existing) {
    console.log(`[reddit-daily] Issue already exists for ${today}: #${existing.number}. Exiting.`);
    return;
  }

  console.log(`[reddit-daily] Scanning ${SUBREDDITS.length} subreddit(s)…`);
  const subResults = await mapLimit(SUBREDDITS, 4, async sub => {
    try {
      const posts = await fetchSubreddit(sub);
      const scored = posts.map(p => ({ post: p, ...scoreThread(p) }));
      const qualified = scored.filter(s => s.score >= MIN_SCORE);
      return { sub, total: posts.length, qualified: qualified.length, scored };
    } catch (e) {
      console.warn(`[reddit-daily] r/${sub} failed: ${e.message}`);
      return { sub, total: 0, qualified: 0, scored: [], error: e.message };
    }
  });

  const allScored = subResults.flatMap(r => r.scored ?? []);
  const top = allScored
    .filter(s => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DRAFTS);

  console.log(`[reddit-daily] ${top.length} thread(s) qualified — generating drafts…`);

  let tokens = 0;
  const drafted = await mapLimit(top, 3, async candidate => {
    try {
      const { text, tokens: t } = await generateDraft(candidate.post);
      tokens += t;
      return { post: candidate.post, score: candidate.score, reasons: candidate.reasons, draft: text };
    } catch (e) {
      console.warn(`[reddit-daily] draft failed for ${candidate.post.id}: ${e.message}`);
      return null;
    }
  });
  const drafts = drafted.filter(Boolean);

  if (drafts.length === 0) {
    console.log('[reddit-daily] No drafts generated. Skipping issue creation.');
    return;
  }

  const body = buildIssueBody({
    scanned: subResults,
    totalCandidates: allScored.filter(s => s.score >= MIN_SCORE).length,
    drafted: drafts,
    tokens,
  });

  const issue = await createIssue(body, drafts.length);
  console.log(`[reddit-daily] Created issue #${issue.number} with ${drafts.length} draft(s). ${tokens.toLocaleString()} tokens.`);
}

main().catch(err => {
  console.error('[reddit-daily] FAILED:', err);
  process.exit(1);
});
