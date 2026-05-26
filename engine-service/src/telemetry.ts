/**
 * Engine telemetry — fire-and-forget writes to Supabase's `engine_jobs` table.
 *
 * Used so the decision-data dashboard (`migration-health.mjs`) can show
 * real numbers for latency, error rate, and cost without us standing up a
 * separate metrics stack.
 *
 * Configured via env vars. Both must be set on the Fly machine — see
 * README.md. Without them, telemetry is silently disabled.
 *
 *   SUPABASE_URL          e.g. https://mhmwmgesyguaphniiedp.supabase.co
 *   SUPABASE_SERVICE_KEY  the service_role JWT (bypasses RLS)
 */

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const ENABLED = SUPABASE_URL.length > 0 && SUPABASE_SERVICE_KEY.length > 0;

if (!ENABLED) {
  console.warn('[telemetry] disabled (SUPABASE_URL or SUPABASE_SERVICE_KEY missing)');
}

export interface JobRecord {
  id: string;
  userId: string;
  gameId: string;
  depth: number;
  durationMs: number;
  movesAnalyzed: number;
  success: boolean;
  error: string | null;
  engineVersion: string;
}

/**
 * Fire-and-forget record. Awaitable but errors are swallowed so the analysis
 * pipeline never breaks because of telemetry.
 */
export async function recordJob(record: JobRecord): Promise<void> {
  if (!ENABLED) return;

  const payload = {
    id: record.id,
    user_id: record.userId,
    game_id: record.gameId,
    depth: record.depth,
    duration_ms: record.durationMs,
    moves_analyzed: record.movesAnalyzed,
    success: record.success,
    error: record.error,
    engine_version: record.engineVersion,
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/engine_jobs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn(`[telemetry] write failed (${res.status}): ${detail}`);
    }
  } catch (err) {
    console.warn('[telemetry] write threw:', err);
  }
}
