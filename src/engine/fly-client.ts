/**
 * Fly engine client. Drop-in replacement for `analyzeGame()` from
 * `./game-analyzer.ts` that POSTs the PGN to the Fly engine service and
 * consumes its SSE stream.
 *
 * Same signature as `analyzeGame`, so `analysis-pipeline.ts` can swap them
 * behind a feature flag without other changes.
 *
 * Auth: reads the Base44 JWT from localStorage (same convention as
 * useEntity.ts) and sends it as a Bearer token. The Fly service validates
 * it via the auth bridge (see engine-service/src/auth.ts).
 */
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import { FLY_ENGINE_URL } from './backend-config';

type ProgressCallback = (moveIndex: number, totalMoves: number) => void;

interface SubmitResponse {
  jobId: string;
  streamUrl: string;
  statusUrl: string;
}

/**
 * Analyze a game by submitting it to the Fly engine service.
 * Mirrors `analyzeGame(game, depth, onProgress)` from `game-analyzer.ts`.
 */
export async function analyzeGameRemote(
  game: GameRecord,
  depth: number,
  onProgress?: ProgressCallback,
): Promise<GameAnalysis> {
  if (!FLY_ENGINE_URL) {
    throw new Error('VITE_FLY_ENGINE_URL not configured — cannot use Fly engine backend');
  }

  const token = getAuthToken();
  if (!token) {
    throw new Error('No auth token available — Fly engine requires authentication');
  }

  const submitRes = await fetch(`${FLY_ENGINE_URL}/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      gameId: game.id,
      pgn: game.pgn,
      depth,
      playerColor: game.player.color,
    }),
  });

  if (!submitRes.ok) {
    const detail = await submitRes.text().catch(() => '');
    throw new Error(`Fly engine submit failed: ${submitRes.status} ${detail}`);
  }

  const { streamUrl } = (await submitRes.json()) as SubmitResponse;

  return streamJobResult(streamUrl, token, onProgress);
}

/**
 * Open an SSE stream and pump events until we get a `complete` or `error`.
 *
 * Uses fetch + ReadableStream rather than EventSource so we can send the
 * Authorization header — EventSource doesn't support custom headers in the
 * standard API.
 */
async function streamJobResult(
  streamPath: string,
  token: string,
  onProgress?: ProgressCallback,
): Promise<GameAnalysis> {
  const url = `${FLY_ENGINE_URL}${streamPath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
    },
  });

  if (!res.ok || !res.body) {
    throw new Error(`Fly engine stream failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE: events are separated by a blank line ("\n\n").
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const event = parseSSE(rawEvent);
        if (!event) continue;

        if (event.event === 'ping') continue;

        if (event.event === 'progress') {
          try {
            const data = JSON.parse(event.data) as {
              progress?: { moveIndex: number; totalMoves: number };
            };
            if (data.progress && onProgress) {
              onProgress(data.progress.moveIndex, data.progress.totalMoves);
            }
          } catch (err) {
            console.warn('[fly-client] Failed to parse progress event:', err);
          }
        } else if (event.event === 'complete') {
          const data = JSON.parse(event.data) as { result: GameAnalysis };
          return data.result;
        } else if (event.event === 'error') {
          const data = JSON.parse(event.data) as { error: string };
          throw new Error(`Fly engine error: ${data.error}`);
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }

  throw new Error('Fly engine stream ended without complete event');
}

/**
 * Parse a single SSE event block (lines like `event: foo\ndata: {...}`).
 */
function parseSSE(raw: string): { event: string; data: string } | null {
  const lines = raw.split('\n');
  let event = 'message';
  let data = '';
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      // Per spec, multiple `data:` lines join with newlines.
      data += (data ? '\n' : '') + line.slice(5).trim();
    }
  }
  if (!data) return null;
  return { event, data };
}

function getAuthToken(): string | null {
  try {
    return (
      localStorage.getItem('base44_access_token') ??
      localStorage.getItem('token') ??
      null
    );
  } catch {
    return null;
  }
}
