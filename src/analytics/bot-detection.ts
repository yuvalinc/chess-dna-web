/* ────────────────────────────────────────────────────────────────────────
 *  Bot & AI-traffic detection — pure helpers shared by the analytics
 *  client (writer) and the admin dashboard (reader).
 *
 *  Two distinct signals:
 *
 *    1. detectBot(userAgent)  — User-Agent string indicates a known
 *       crawler or AI agent. Most LLM training crawlers (GPTBot,
 *       ClaudeBot, ...) DON'T execute JavaScript, so they never reach
 *       our analytics in a pure SPA — but on-demand browsing agents
 *       (Perplexity-User, ChatGPT-User, Claude-User, agentic browsers)
 *       increasingly DO, and those we can see.
 *
 *    2. detectAiReferrer(referrer) — the user arrived from an AI chat
 *       surface (chatgpt.com, claude.ai, perplexity.ai, ...). This is
 *       human traffic that originated in an AI tool, which is the more
 *       business-relevant signal: "are people discovering us through
 *       LLMs?".
 * ──────────────────────────────────────────────────────────────────── */

export type BotCategory =
  | 'llm-crawler'   // training-data crawlers
  | 'llm-agent'     // user-initiated browsing through an AI surface
  | 'search-engine' // classic search crawlers (also fed into AI features)
  | 'other-bot';    // generic crawlers we recognise

export interface BotMatch {
  /** Canonical bot name (the token we matched in the UA). */
  name: string;
  /** Vendor / surface, e.g. 'openai', 'anthropic', 'perplexity'. */
  vendor: string;
  category: BotCategory;
}

interface BotPattern {
  /** Substring to match against the User-Agent (case-insensitive). */
  needle: string;
  name: string;
  vendor: string;
  category: BotCategory;
}

/* Order matters: more-specific patterns (Perplexity-User) come before
 * less-specific ones (PerplexityBot) so we keep the precise label. */
const BOT_PATTERNS: BotPattern[] = [
  // OpenAI
  { needle: 'oai-searchbot',     name: 'OAI-SearchBot',     vendor: 'openai',     category: 'llm-crawler' },
  { needle: 'chatgpt-user',      name: 'ChatGPT-User',      vendor: 'openai',     category: 'llm-agent' },
  { needle: 'gptbot',            name: 'GPTBot',            vendor: 'openai',     category: 'llm-crawler' },
  // Anthropic
  { needle: 'claude-user',       name: 'Claude-User',       vendor: 'anthropic',  category: 'llm-agent' },
  { needle: 'claude-web',        name: 'Claude-Web',        vendor: 'anthropic',  category: 'llm-agent' },
  { needle: 'claudebot',         name: 'ClaudeBot',         vendor: 'anthropic',  category: 'llm-crawler' },
  { needle: 'anthropic-ai',      name: 'anthropic-ai',      vendor: 'anthropic',  category: 'llm-crawler' },
  // Perplexity
  { needle: 'perplexity-user',   name: 'Perplexity-User',   vendor: 'perplexity', category: 'llm-agent' },
  { needle: 'perplexitybot',     name: 'PerplexityBot',     vendor: 'perplexity', category: 'llm-crawler' },
  // Google
  { needle: 'google-extended',   name: 'Google-Extended',   vendor: 'google',     category: 'llm-crawler' },
  { needle: 'googleother',       name: 'GoogleOther',       vendor: 'google',     category: 'llm-crawler' },
  { needle: 'googlebot',         name: 'Googlebot',         vendor: 'google',     category: 'search-engine' },
  // Apple
  { needle: 'applebot-extended', name: 'Applebot-Extended', vendor: 'apple',      category: 'llm-crawler' },
  { needle: 'applebot',          name: 'Applebot',          vendor: 'apple',      category: 'search-engine' },
  // Meta
  { needle: 'meta-externalagent',   name: 'Meta-ExternalAgent',   vendor: 'meta', category: 'llm-crawler' },
  { needle: 'meta-externalfetcher', name: 'Meta-ExternalFetcher', vendor: 'meta', category: 'llm-agent' },
  { needle: 'facebookbot',       name: 'FacebookBot',       vendor: 'meta',       category: 'llm-crawler' },
  // ByteDance / Doubao
  { needle: 'bytespider',        name: 'Bytespider',        vendor: 'bytedance',  category: 'llm-crawler' },
  // Common Crawl (training data for nearly every LLM)
  { needle: 'ccbot',             name: 'CCBot',             vendor: 'commoncrawl',category: 'llm-crawler' },
  // Cohere
  { needle: 'cohere-training-data-crawler', name: 'cohere-training-data-crawler', vendor: 'cohere', category: 'llm-crawler' },
  { needle: 'cohere-ai',         name: 'cohere-ai',         vendor: 'cohere',     category: 'llm-crawler' },
  // Mistral
  { needle: 'mistralai-user',    name: 'MistralAI-User',    vendor: 'mistral',    category: 'llm-agent' },
  // You.com / Phind / Kagi / DuckDuckGo / Komo / iAsk
  { needle: 'youbot',            name: 'YouBot',            vendor: 'you',        category: 'llm-crawler' },
  { needle: 'phindbot',          name: 'PhindBot',          vendor: 'phind',      category: 'llm-crawler' },
  { needle: 'kagibot',           name: 'Kagibot',           vendor: 'kagi',       category: 'search-engine' },
  { needle: 'duckassistbot',     name: 'DuckAssistBot',     vendor: 'duckduckgo', category: 'llm-agent' },
  { needle: 'komo-bot',          name: 'KomoBot',           vendor: 'komo',       category: 'llm-crawler' },
  { needle: 'iaskspider',        name: 'iAskSpider',        vendor: 'iask',       category: 'llm-crawler' },
  { needle: 'linerbot',          name: 'Linerbot',          vendor: 'liner',      category: 'llm-crawler' },
  // Microsoft (Bing powers Copilot)
  { needle: 'bingbot',           name: 'Bingbot',           vendor: 'microsoft',  category: 'search-engine' },
  // Diffbot, Webz, Amazon, Timpi (mixed LLM-training infrastructure)
  { needle: 'diffbot',           name: 'Diffbot',           vendor: 'diffbot',    category: 'llm-crawler' },
  { needle: 'omgilibot',         name: 'Omgilibot',         vendor: 'webz',       category: 'llm-crawler' },
  { needle: 'amazonbot',         name: 'Amazonbot',         vendor: 'amazon',     category: 'llm-crawler' },
  { needle: 'timpibot',          name: 'Timpibot',          vendor: 'timpi',      category: 'llm-crawler' },
  { needle: 'imagesiftbot',      name: 'ImagesiftBot',      vendor: 'hive',       category: 'llm-crawler' },
  { needle: 'velen.io',          name: 'Velen',             vendor: 'velen',      category: 'llm-crawler' },
  // Other classic search crawlers (worth surfacing even if not LLM-specific)
  { needle: 'yandex',            name: 'YandexBot',         vendor: 'yandex',     category: 'search-engine' },
  { needle: 'duckduckbot',       name: 'DuckDuckBot',       vendor: 'duckduckgo', category: 'search-engine' },
  { needle: 'slurp',             name: 'Yahoo Slurp',       vendor: 'yahoo',      category: 'search-engine' },
  // Generic fallback — anything self-identifying as "bot" / "crawler" / "spider" we haven't named.
  { needle: 'headlesschrome',    name: 'HeadlessChrome',    vendor: 'unknown',    category: 'other-bot' },
];

const GENERIC_BOT_HINTS = ['bot/', 'bot ', 'crawler', 'spider', 'scraper', 'http-client', 'python-requests', 'curl/', 'wget/', 'go-http-client', 'okhttp/', 'java/'];

/**
 * Match a User-Agent string against the known-bot table. Returns the
 * first specific match, or a generic `{ name: 'unknown-bot' }` if the UA
 * smells botty but isn't in our table.
 */
export function detectBot(userAgent: string | undefined): BotMatch | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  for (const pat of BOT_PATTERNS) {
    if (ua.includes(pat.needle)) {
      return { name: pat.name, vendor: pat.vendor, category: pat.category };
    }
  }
  for (const hint of GENERIC_BOT_HINTS) {
    if (ua.includes(hint)) {
      return { name: 'unknown-bot', vendor: 'unknown', category: 'other-bot' };
    }
  }
  return null;
}

export interface AiReferrerMatch {
  /** Canonical short name we use throughout the dashboard. */
  source: string;
  /** Human-readable label for UI. */
  label: string;
}

interface AiReferrerPattern {
  /** Substring to match against the referrer URL (case-insensitive). */
  needle: string;
  source: string;
  label: string;
}

const AI_REFERRER_PATTERNS: AiReferrerPattern[] = [
  { needle: 'chatgpt.com',           source: 'chatgpt',    label: 'ChatGPT' },
  { needle: 'chat.openai.com',       source: 'chatgpt',    label: 'ChatGPT' },
  { needle: 'claude.ai',             source: 'claude',     label: 'Claude' },
  { needle: 'perplexity.ai',         source: 'perplexity', label: 'Perplexity' },
  { needle: 'copilot.microsoft.com', source: 'copilot',    label: 'Copilot' },
  { needle: 'bing.com/chat',         source: 'copilot',    label: 'Bing Chat' },
  { needle: 'gemini.google.com',     source: 'gemini',     label: 'Gemini' },
  { needle: 'bard.google.com',       source: 'gemini',     label: 'Gemini (Bard)' },
  { needle: 'you.com',               source: 'you',        label: 'You.com' },
  { needle: 'phind.com',             source: 'phind',      label: 'Phind' },
  { needle: 'chat.mistral.ai',       source: 'mistral',    label: 'Mistral' },
  { needle: 'poe.com',               source: 'poe',        label: 'Poe' },
  { needle: 'meta.ai',               source: 'meta',       label: 'Meta AI' },
  { needle: 'character.ai',          source: 'character',  label: 'Character.AI' },
  { needle: 'kagi.com/assistant',    source: 'kagi',       label: 'Kagi Assistant' },
  { needle: 'duckduckgo.com/?q=',    source: 'ddg',        label: 'DuckDuckGo' }, // matches both AI mode and regular
];

/**
 * Match a referrer URL against the known-AI-surface table. Returns the
 * first specific match, or null otherwise.
 */
export function detectAiReferrer(referrer: string | undefined): AiReferrerMatch | null {
  if (!referrer) return null;
  const r = referrer.toLowerCase();
  for (const pat of AI_REFERRER_PATTERNS) {
    if (r.includes(pat.needle)) {
      return { source: pat.source, label: pat.label };
    }
  }
  return null;
}

/** True iff the referrer is a cross-origin URL (not us, not empty). Used
 *  to decide whether to surface the document.referrer at all — same-site
 *  navigations are uninteresting for traffic-source analysis. */
export function isExternalReferrer(referrer: string | undefined, ownOrigin: string): boolean {
  if (!referrer) return false;
  try {
    const u = new URL(referrer);
    return u.origin !== ownOrigin;
  } catch {
    return false;
  }
}
