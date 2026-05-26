-- drift_log — used by the Phase 3 dual-write wrapper to record any
-- mismatches between Base44 and Supabase writes/reads.
--
-- Purpose: drives the Phase 5 shadow-read verification. We don't flip the
-- read source for an entity until this table has been empty (or only known
-- harmless drifts) for 3 consecutive days.

CREATE TABLE IF NOT EXISTS drift_log (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  entity TEXT NOT NULL,        -- 'Game' | 'Analysis' | 'Pattern' | ...
  entity_id TEXT,              -- the row id (may be null for list-level drift)
  operation TEXT NOT NULL,     -- 'create' | 'update' | 'delete' | 'read'
  field TEXT,                  -- specific field that differed, or null for whole-row
  base44_value JSONB,
  supabase_value JSONB,
  note TEXT,                   -- free-form context (e.g. "timing", "JSON ordering")
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drift_log_user_created ON drift_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drift_log_entity      ON drift_log (entity, created_at DESC);

-- RLS: user can only see their own drift records, but admins can see all.
-- We let the dual-write wrapper insert via the user's own JWT so RLS still applies.
ALTER TABLE drift_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY drift_log_select_own ON drift_log FOR SELECT
  USING (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY drift_log_insert_own ON drift_log FOR INSERT
  WITH CHECK (auth.jwt() ->> 'sub' = user_id);

-- No update/delete policies — drift records are append-only.
