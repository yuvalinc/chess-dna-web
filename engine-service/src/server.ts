/**
 * Engine service HTTP server.
 *
 * Endpoints:
 *   POST /analyze              — submit a PGN for analysis, returns { jobId }
 *   GET  /analyze/:id/stream   — SSE stream of progress + result
 *   GET  /analyze/:id          — poll status (fallback for SSE-incapable clients)
 *   GET  /health               — liveness check
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { requireAuth, getUser, type AuthedUser } from './auth.js';
import { jobs, type JobEvent } from './jobs.js';
import { analyzeGame } from './analyzer.js';
import { recordJob } from './telemetry.js';

const PORT = Number(process.env.PORT ?? '8080');
const MAX_CONCURRENT_JOBS = Number(process.env.MAX_CONCURRENT_JOBS ?? '4');
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS ?? '300000');

// Semaphore for concurrency control.
let runningJobs = 0;
const waitQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (runningJobs < MAX_CONCURRENT_JOBS) {
    runningJobs++;
    return;
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  runningJobs++;
}

function releaseSlot(): void {
  runningJobs--;
  const next = waitQueue.shift();
  if (next) next();
}

const app = new Hono<{ Variables: { user: AuthedUser } }>();

app.use('*', cors({
  // Phase 1: permissive. Tighten to actual origins in Phase 6.
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    stockfish: '17.1',
    runningJobs,
    queueDepth: waitQueue.length,
    maxConcurrent: MAX_CONCURRENT_JOBS,
  });
});

const AnalyzeBody = z.object({
  gameId: z.string().min(1).max(200),
  pgn: z.string().min(10).max(100_000),
  depth: z.number().int().min(1).max(30).default(18),
  // Required so the engine can compute the per-player summary (accuracy, blunders, etc.)
  // The engine doesn't know which color the user played without being told.
  playerColor: z.enum(['white', 'black']),
});

app.post('/analyze', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = AnalyzeBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }

  const user = getUser(c);
  const job = jobs.create(user.userId, parsed.data.gameId);

  // Kick off analysis in background. Don't await — client polls/streams.
  void runJob(job.id, user.userId, parsed.data);

  return c.json(
    {
      jobId: job.id,
      streamUrl: `/analyze/${job.id}/stream`,
      statusUrl: `/analyze/${job.id}`,
    },
    202,
  );
});

app.get('/analyze/:id', requireAuth, (c) => {
  const job = jobs.get(c.req.param('id'));
  if (!job) return c.json({ error: 'not_found' }, 404);
  const user = getUser(c);
  if (job.userId !== user.userId) return c.json({ error: 'forbidden' }, 403);

  return c.json({
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
  });
});

app.get('/analyze/:id/stream', requireAuth, (c) => {
  const job = jobs.get(c.req.param('id'));
  if (!job) return c.json({ error: 'not_found' }, 404);
  const user = getUser(c);
  if (job.userId !== user.userId) return c.json({ error: 'forbidden' }, 403);

  return streamSSE(c, async (stream) => {
    const queue: JobEvent[] = [];
    let resume: (() => void) | null = null;
    let done = false;

    const unsubscribe = jobs.subscribe(job.id, (event) => {
      queue.push(event);
      resume?.();
    });

    // Heartbeat so proxies don't close the connection while Stockfish thinks.
    const heartbeat = setInterval(() => {
      void stream.writeSSE({ event: 'ping', data: String(Date.now()) }).catch(() => {});
    }, 15_000);

    stream.onAbort(() => {
      done = true;
      clearInterval(heartbeat);
      unsubscribe();
      resume?.();
    });

    try {
      while (!done) {
        while (queue.length > 0) {
          const event = queue.shift()!;
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
          if (event.type === 'complete' || event.type === 'error') {
            done = true;
          }
        }
        if (done) break;
        await new Promise<void>((resolve) => { resume = resolve; });
        resume = null;
      }
    } finally {
      clearInterval(heartbeat);
      unsubscribe();
    }
  });
});

async function runJob(
  jobId: string,
  userId: string,
  input: { gameId: string; pgn: string; depth: number; playerColor: 'white' | 'black' },
): Promise<void> {
  await acquireSlot();
  jobs.markRunning(jobId);

  const startedAt = Date.now();
  let success = false;
  let errMsg: string | null = null;
  let movesAnalyzed = 0;
  let engineVersion = 'unknown';

  const timeout = setTimeout(() => {
    jobs.fail(jobId, `Job timeout after ${JOB_TIMEOUT_MS}ms`);
  }, JOB_TIMEOUT_MS);

  try {
    const result = await analyzeGame({
      gameId: input.gameId,
      pgn: input.pgn,
      depth: input.depth,
      playerColor: input.playerColor,
      onProgress: (moveIndex, totalMoves) => {
        jobs.reportProgress(jobId, { moveIndex, totalMoves });
      },
    });
    jobs.complete(jobId, result);
    success = true;
    movesAnalyzed = result.moves.length;
    engineVersion = result.engineVersion;
  } catch (err) {
    errMsg = String(err);
    jobs.fail(jobId, errMsg);
  } finally {
    clearTimeout(timeout);
    releaseSlot();

    // Fire-and-forget telemetry write. Never throws.
    void recordJob({
      id: jobId,
      userId,
      gameId: input.gameId,
      depth: input.depth,
      durationMs: Date.now() - startedAt,
      movesAnalyzed,
      success,
      error: errMsg,
      engineVersion,
    });
  }
}

console.log(`[engine-service] starting on port ${PORT}, max concurrent jobs: ${MAX_CONCURRENT_JOBS}`);
serve({ fetch: app.fetch, port: PORT });
