/**
 * Types for the SEO/GEO agent run pipeline.
 *
 * A SeoRun represents one execution of the managed SEO agent
 * (agent_01FF7U9ms15noELzXPDGk8cX on Anthropic), plus the human approval
 * and Claude Code execution that follows it.
 *
 * Lifecycle:
 *   running   → agent is executing (transient)
 *   completed → agent finished, tasks extracted, awaiting human approval
 *   failed    → agent errored before producing output
 *   approved  → user clicked Approve in the dashboard
 *   executing → Claude Code workflow has started on the tasks
 *   done      → all tasks finished (or skipped)
 *   partial   → some tasks failed; manual follow-up needed
 */

export type SeoRunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'approved'
  | 'executing'
  | 'done'
  | 'partial';

export type SeoTaskStatus =
  | 'pending'
  | 'approved'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'skipped';

export type SeoEngine =
  | 'google'
  | 'bing'
  | 'chatgpt'
  | 'perplexity'
  | 'claude'
  | 'gemini';

export interface SeoTask {
  id: string;
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2';
  status: SeoTaskStatus;
  filesTouched?: string[];
  prUrl?: string;
  commitSha?: string;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
}

export interface SeoRanking {
  keyword: string;
  engine: SeoEngine;
  position: number | null;
  prevPosition?: number | null;
  url?: string;
  notes?: string;
}

export interface SeoRunRecord {
  id?: string;
  runDate: string;
  agentSessionId?: string;
  status: SeoRunStatus;
  rawOutput?: string;
  summary?: string;
  rankings?: SeoRanking[];
  tasks?: SeoTask[];
  approvedAt?: number;
  approvedBy?: string;
  workflowRunId?: string;
  workflowRunUrl?: string;
  completedAt?: number;
  tokensUsed?: number;
  costUsd?: number;
  errorMessage?: string;
  created_at?: number;
  updated_at?: number;
  created_by?: string;
}
