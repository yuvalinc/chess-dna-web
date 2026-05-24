/**
 * localStorage-backed cache for AI move explanations.
 *
 * Keyed by `${gameId}:${moveIdx}`. Survives page reload so revisiting an
 * already-explained move doesn't re-bill against the Claude key. Capped
 * at MAX_ENTRIES with LRU eviction and a TTL on each entry.
 */
const STORAGE_KEY = 'chess-dna:explanation-cache:v1';
const MAX_ENTRIES = 500;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface Entry {
  text: string;
  ts: number;
}

interface CacheShape {
  entries: Record<string, Entry>;
  order: string[];
}

function read(): CacheShape {
  if (typeof localStorage === 'undefined') return { entries: {}, order: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { entries: {}, order: [] };
    const parsed = JSON.parse(raw) as CacheShape;
    if (!parsed.entries || !parsed.order) return { entries: {}, order: [] };
    return parsed;
  } catch {
    return { entries: {}, order: [] };
  }
}

function write(cache: CacheShape) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Quota exceeded — drop oldest half and retry once.
    const half = Math.floor(cache.order.length / 2);
    for (let i = 0; i < half; i++) delete cache.entries[cache.order[i]];
    cache.order = cache.order.slice(half);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch { /* give up */ }
  }
}

function makeKey(gameId: string, moveIdx: number): string {
  return `${gameId}:${moveIdx}`;
}

export function getExplanation(gameId: string, moveIdx: number): string | null {
  const cache = read();
  const key = makeKey(gameId, moveIdx);
  const entry = cache.entries[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    delete cache.entries[key];
    cache.order = cache.order.filter(k => k !== key);
    write(cache);
    return null;
  }
  return entry.text;
}

export function setExplanation(gameId: string, moveIdx: number, text: string): void {
  const cache = read();
  const key = makeKey(gameId, moveIdx);
  if (cache.entries[key]) {
    cache.order = cache.order.filter(k => k !== key);
  }
  cache.entries[key] = { text, ts: Date.now() };
  cache.order.push(key);
  while (cache.order.length > MAX_ENTRIES) {
    const evicted = cache.order.shift();
    if (evicted) delete cache.entries[evicted];
  }
  write(cache);
}
