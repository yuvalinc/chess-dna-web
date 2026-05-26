/**
 * In-memory job manager for analysis requests.
 *
 * Jobs are short-lived (typically <1 min). On process restart, in-flight jobs
 * are lost — the client retries. Acceptable for Phase 1; revisit if we need
 * durability (e.g. switch to Postgres-backed queue + multiple workers).
 */
import { randomUUID } from 'node:crypto';
import type { GameAnalysis } from './types.js';

export type JobStatus = 'pending' | 'running' | 'complete' | 'error';

export interface JobProgress {
  moveIndex: number;
  totalMoves: number;
}

export interface JobRecord {
  id: string;
  userId: string;
  gameId: string;
  status: JobStatus;
  progress: JobProgress | null;
  result: GameAnalysis | null;
  error: string | null;
  createdAt: number;
  subscribers: Set<(event: JobEvent) => void>;
}

export type JobEvent =
  | { type: 'progress'; jobId: string; progress: JobProgress }
  | { type: 'complete'; jobId: string; result: GameAnalysis }
  | { type: 'error'; jobId: string; error: string };

class JobManager {
  private jobs = new Map<string, JobRecord>();
  private readonly maxJobs = 1000;
  private readonly ttlMs = 30 * 60 * 1000; // 30 min

  create(userId: string, gameId: string): JobRecord {
    this.gc();
    const job: JobRecord = {
      id: randomUUID(),
      userId,
      gameId,
      status: 'pending',
      progress: null,
      result: null,
      error: null,
      createdAt: Date.now(),
      subscribers: new Set(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  markRunning(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) job.status = 'running';
  }

  reportProgress(jobId: string, progress: JobProgress): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.progress = progress;
    const event: JobEvent = { type: 'progress', jobId, progress };
    for (const sub of job.subscribers) {
      try { sub(event); } catch { /* swallow */ }
    }
  }

  complete(jobId: string, result: GameAnalysis): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'complete';
    job.result = result;
    const event: JobEvent = { type: 'complete', jobId, result };
    for (const sub of job.subscribers) {
      try { sub(event); } catch { /* swallow */ }
    }
  }

  fail(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'error';
    job.error = error;
    const event: JobEvent = { type: 'error', jobId, error };
    for (const sub of job.subscribers) {
      try { sub(event); } catch { /* swallow */ }
    }
  }

  subscribe(jobId: string, listener: (event: JobEvent) => void): () => void {
    const job = this.jobs.get(jobId);
    if (!job) return () => {};
    job.subscribers.add(listener);

    // Replay current state so a late subscriber gets caught up.
    if (job.progress) listener({ type: 'progress', jobId, progress: job.progress });
    if (job.status === 'complete' && job.result) {
      listener({ type: 'complete', jobId, result: job.result });
    } else if (job.status === 'error' && job.error) {
      listener({ type: 'error', jobId, error: job.error });
    }

    return () => {
      job.subscribers.delete(listener);
    };
  }

  private gc(): void {
    if (this.jobs.size < this.maxJobs) return;
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, job] of this.jobs) {
      if (job.createdAt < cutoff && (job.status === 'complete' || job.status === 'error')) {
        this.jobs.delete(id);
      }
    }
  }
}

export const jobs = new JobManager();
