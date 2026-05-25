#!/usr/bin/env node
// Brand mention monitor — searches Reddit for mentions of the chess-dna brand
// across all subreddits (not just the ones we engage with) and writes a daily
// GitHub issue the /seo Insights dashboard consumes.
//
// Required env:
//   GH_TOKEN          - GitHub PAT with `repo` scope
//
// Optional env:
//   BRAND_GH_REPO     - default: yuvalinc/chess-dna-web
//   BRAND_QUERIES     - comma-separated; default: chessdna, "chess dna", chessdna.app
//   BRAND_USER_AGENT  - default: chess-dna:brand-monitor:1.0 (by /u/Inside-Essay-617)
//   BRAND_LOOKBACK_HRS- default: 720 (30 days)
//   BRAND_MAX_RESULTS - default: 50 (per query)
//
// Reddit search is unauthenticated — public JSON endpoint, ~60 req/min limit.

const GH_BASE = 'https://api.github.com';
const REDDIT_BASE = 'https://www.reddit.com';

const GH_REPO = process.env.BRAND_GH_REPO ?? 'yuvalinc/chess-dna-web';
const USER_AGENT = process.env.BRAND_USER_AGENT ?? 'chess-dna:brand-monitor:1.0 (by /u/Inside-Essay-617)';
const LOOKBACK_HRS = Number(process.env.BRAND_LOOKBACK_HRS ?? 720);
const MAX_RESULTS = Number(process.env.BRAND_MAX_RESULTS ?? 50);
const QUERIES = (process.env.BRAND_QUERIES ?? 'chessdna,"chess dna",chessdna.app')
  .split(',').map(s => s.trim()).filter(Boolean);

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

// ─── Reddit search ─────────────────────────────────────────────────────────
async function searchReddit(query) {
  const url = `${REDDIT_BASE}/search.json?q=${encodeURIComponent(query)}&sort=new&limit=${MAX_RESULTS}&restrict_sr=0`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    console.warn(`[brand-monitor] search "${query}" → ${res.status}`);
    return [];
  }
  const data = await res.json();
  return (data.data?.children ?? []).map(c => c.data);
}

// Very rough sentiment heuristic — keyword bag. Good enough for a daily
// dashboard signal; we can swap for a real model later if it matters.
const POSITIVE = ['great', 'amazing', 'love', 'love it', 'helpful', 'useful', 'recommend', 'awesome', 'thanks', 'fantastic', 'best', 'perfect', 'excellent', 'wonderful', 'cool', 'nice', 'wow'];
const NEGATIVE = ['bad', 'terrible', 'awful', 'hate', 'useless', 'worst', 'broken', 'sucks', 'crap', 'bug', 'doesn\'t work', 'not working', 'disappointing', 'waste', 'spam', 'shill', 'fake'];

function classifySentiment(text) {
  const lower = text.toLowerCase();
  let pos = 0, neg = 0;
  for (const w of POSITIVE) if (lower.includes(w)) pos++;
  for (const w of NEGATIVE) if (lower.includes(w)) neg++;
  if (pos > neg + 1) return 'positive';
  if (neg > pos + 1) return 'negative';
  return 'neutral';
}

function isHighIntent(post) {
  // High-intent = a question or recommendation-seeking thread where the
  // brand mention is genuinely actionable (we could reply or thank them).
  const text = `${post.title} ${post.selftext ?? ''}`.toLowerCase();
  const intentMarkers = ['recommend', 'looking for', 'what app', 'best app', 'any apps', 'any tool', 'has anyone', 'tried', 'help me', 'thoughts on', 'is it worth', 'should i'];
  return intentMarkers.some(m => text.includes(m));
}

// ─── Aggregation ───────────────────────────────────────────────────────────
function dedupeAndFilter(allPosts) {
  const cutoff = (Date.now() / 1000) - LOOKBACK_HRS * 3600;
  const seen = new Set();
  const out = [];
  for (const p of allPosts) {
    if (!p || seen.has(p.id)) continue;
    if (p.created_utc < cutoff) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out.sort((a, b) => b.created_utc - a.created_utc);
}

function buildIssueBody(mentions) {
  const bySubreddit = new Map();
  const bySentiment = { positive: 0, neutral: 0, negative: 0 };
  let highIntent = 0;
  for (const m of mentions) {
    bySubreddit.set(m.subreddit, (bySubreddit.get(m.subreddit) ?? 0) + 1);
    bySentiment[m.sentiment] = (bySentiment[m.sentiment] ?? 0) + 1;
    if (m.highIntent) highIntent++;
  }
  const topSubs = [...bySubreddit.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const positiveRatio = mentions.length > 0
    ? Math.round((bySentiment.positive / mentions.length) * 100)
    : 0;

  const lines = [
    `_Brand mention scan — ${todayIso()}_`,
    '',
    '## Summary',
    `Found **${mentions.length}** mention${mentions.length === 1 ? '' : 's'} across Reddit in the last ${LOOKBACK_HRS}h. **${highIntent}** high-intent. Sentiment: ${bySentiment.positive}+ · ${bySentiment.neutral}~ · ${bySentiment.negative}-. Health: **${positiveRatio}%** positive.`,
    '',
    '## Stats',
    `- TotalMentions: ${mentions.length}`,
    `- HighIntent: ${highIntent}`,
    `- Positive: ${bySentiment.positive}`,
    `- Neutral: ${bySentiment.neutral}`,
    `- Negative: ${bySentiment.negative}`,
    `- HealthPercent: ${positiveRatio}`,
    '',
    '## Top subreddits',
    topSubs.length
      ? topSubs.map(([s, c]) => `- r/${s} — ${c} mention${c === 1 ? '' : 's'}`).join('\n')
      : '_(none)_',
    '',
    '## Mentions',
    '',
  ];

  for (let i = 0; i < mentions.length; i++) {
    const m = mentions[i];
    const ageHrs = ((Date.now() / 1000 - m.created_utc) / 3600).toFixed(1);
    const excerpt = (m.selftext ?? m.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const sentimentBadge = m.sentiment === 'positive' ? '🟢 positive'
      : m.sentiment === 'negative' ? '🔴 negative' : '⚪ neutral';
    const intentBadge = m.highIntent ? ' · 🎯 high-intent' : '';
    lines.push(
      `### [r/${m.subreddit}] ${m.title.replace(/[\[\]]/g, '')}  <!-- mention-${i + 1} -->`,
      `- **Sentiment**: ${sentimentBadge}${intentBadge}`,
      `- **Posted**: ${ageHrs}h ago · ${m.score}↑ · ${m.num_comments} comments · by u/${m.author}`,
      `- **URL**: https://www.reddit.com${m.permalink}`,
      '',
      excerpt ? `> ${excerpt}${(m.selftext ?? '').length > 300 ? '…' : ''}` : '_(link post, no body text)_',
      '',
      '---',
      '',
    );
  }

  return lines.join('\n');
}

// ─── GitHub ────────────────────────────────────────────────────────────────
async function findTodayIssue(today) {
  const q = encodeURIComponent(`repo:${GH_REPO} is:issue label:brand-monitor in:title ${today}`);
  const res = await fetch(`${GH_BASE}/search/issues?q=${q}`, { headers: GH_HEADERS() });
  if (!res.ok) return null;
  const data = await res.json();
  return data.items?.[0] ?? null;
}

async function createIssue(body, count) {
  const res = await fetch(`${GH_BASE}/repos/${GH_REPO}/issues`, {
    method: 'POST',
    headers: GH_HEADERS(),
    body: JSON.stringify({
      title: `Brand ${todayIso()} — ${count} mention${count === 1 ? '' : 's'}`,
      body,
      labels: ['brand-monitor'],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`gh create issue ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

async function updateIssue(number, body, count) {
  const res = await fetch(`${GH_BASE}/repos/${GH_REPO}/issues/${number}`, {
    method: 'PATCH',
    headers: GH_HEADERS(),
    body: JSON.stringify({
      title: `Brand ${todayIso()} — ${count} mention${count === 1 ? '' : 's'}`,
      body,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`gh update issue ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN required');

  console.log(`[brand-monitor] Querying Reddit for: ${QUERIES.join(', ')}`);
  const allResults = [];
  for (const q of QUERIES) {
    const results = await searchReddit(q);
    allResults.push(...results);
    // Spread requests politely — Reddit rate limits unauthenticated calls.
    await new Promise(r => setTimeout(r, 750));
  }
  const dedup = dedupeAndFilter(allResults);
  const mentions = dedup.map(p => ({
    ...p,
    sentiment: classifySentiment(`${p.title}\n${p.selftext ?? ''}`),
    highIntent: isHighIntent(p),
  }));

  console.log(`[brand-monitor] ${mentions.length} unique mention(s) in last ${LOOKBACK_HRS}h.`);

  const body = buildIssueBody(mentions);
  const today = todayIso();
  const existing = await findTodayIssue(today);

  if (existing) {
    await updateIssue(existing.number, body, mentions.length);
    console.log(`[brand-monitor] Updated issue #${existing.number} (${mentions.length} mentions).`);
  } else {
    const issue = await createIssue(body, mentions.length);
    console.log(`[brand-monitor] Created issue #${issue.number} (${mentions.length} mentions).`);
  }
}

main().catch(err => {
  console.error('[brand-monitor] FAILED:', err);
  process.exit(1);
});
