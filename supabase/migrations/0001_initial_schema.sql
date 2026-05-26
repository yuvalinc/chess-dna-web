-- Initial schema: 6 entity tables matching Base44.
-- See docs/handoff/fly-migration-plan.md (Phase 2).
--
-- Design choices:
--   - `id` is TEXT (Base44 IDs are not UUIDs; preserve identity across migration)
--   - `user_id` is TEXT (same reason — derived from Base44 JWT `sub` claim)
--   - JSON fields use `jsonb` (indexable, faster than `json`)
--   - RLS predicate: `auth.jwt() ->> 'sub' = user_id`
--   - Every table gets `created_at`, `updated_at` defaults + auto-update trigger
--
-- This file is idempotent: re-running it on a fresh DB is safe.
-- For existing DBs, use ALTER statements in a separate migration.

-- ── Auto-update updated_at trigger ──
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── GAMES ──
-- Chess games imported from chess.com/lichess or pasted PGN.
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- External identifier (chess.com gameId, lichess gameId, etc.) used for dedup
  game_id TEXT,
  -- Lowercase player username for filterable scoping
  player_username TEXT,

  -- GameRecord fields
  url TEXT NOT NULL DEFAULT '',
  pgn TEXT NOT NULL,
  player JSONB NOT NULL,        -- PlayerInfo
  opponent JSONB NOT NULL,      -- PlayerInfo
  time_class TEXT NOT NULL,     -- 'bullet' | 'blitz' | 'rapid' | 'daily'
  time_control TEXT NOT NULL,
  opening JSONB NOT NULL,       -- { eco, name }
  total_moves INTEGER NOT NULL DEFAULT 0,
  played_at BIGINT NOT NULL,    -- epoch ms (matches Base44 numeric timestamps)
  analyzed_at BIGINT,
  analysis_status TEXT NOT NULL DEFAULT 'pending',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_games_user_played_at ON games (user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_user_status    ON games (user_id, analysis_status);
CREATE INDEX IF NOT EXISTS idx_games_game_id        ON games (game_id);
CREATE INDEX IF NOT EXISTS idx_games_player_user    ON games (user_id, player_username);

CREATE TRIGGER trg_games_updated_at
  BEFORE UPDATE ON games
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE games ENABLE ROW LEVEL SECURITY;

CREATE POLICY games_select_own ON games FOR SELECT
  USING (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY games_insert_own ON games FOR INSERT
  WITH CHECK (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY games_update_own ON games FOR UPDATE
  USING (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY games_delete_own ON games FOR DELETE
  USING (auth.jwt() ->> 'sub' = user_id);

-- ── ANALYSES ──
-- One Analysis per Game (1:1 by game.id → analyses.game_id).
-- moves is a jsonb array; each entry is a MoveAnalysis object.
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- The Base44 Game.id this analysis is for
  game_id TEXT NOT NULL,
  -- Optional external chess gameId for stable cross-import matching
  chess_game_id TEXT,
  player_username TEXT,

  moves JSONB NOT NULL DEFAULT '[]',  -- MoveAnalysis[]
  summary JSONB NOT NULL,             -- GameSummary
  analyzed_at BIGINT NOT NULL,
  engine_depth INTEGER NOT NULL,
  engine_version TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analyses_user_game    ON analyses (user_id, game_id);
CREATE INDEX IF NOT EXISTS idx_analyses_user_player  ON analyses (user_id, player_username);
CREATE INDEX IF NOT EXISTS idx_analyses_chess_game   ON analyses (chess_game_id);
CREATE INDEX IF NOT EXISTS idx_analyses_user_created ON analyses (user_id, created_at DESC);

CREATE TRIGGER trg_analyses_updated_at
  BEFORE UPDATE ON analyses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY analyses_select_own ON analyses FOR SELECT
  USING (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY analyses_insert_own ON analyses FOR INSERT
  WITH CHECK (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY analyses_update_own ON analyses FOR UPDATE
  USING (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY analyses_delete_own ON analyses FOR DELETE
  USING (auth.jwt() ->> 'sub' = user_id);

-- ── PATTERNS (singleton per user) ──
-- CurrentPatterns: a user's overall weakness pattern set, recomputed after each analysis.
CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,  -- one row per user

  patterns JSONB NOT NULL DEFAULT '[]',  -- WeaknessPattern[]
  last_updated BIGINT NOT NULL,
  games_in_window INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patterns_user ON patterns (user_id);

CREATE TRIGGER trg_patterns_updated_at
  BEFORE UPDATE ON patterns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY patterns_select_own ON patterns FOR SELECT
  USING (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY patterns_insert_own ON patterns FOR INSERT
  WITH CHECK (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY patterns_update_own ON patterns FOR UPDATE
  USING (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY patterns_delete_own ON patterns FOR DELETE
  USING (auth.jwt() ->> 'sub' = user_id);

-- ── PATTERN SNAPSHOTS (append-only) ──
-- One row per analyzed game, captures the themes that game contributed.
CREATE TABLE IF NOT EXISTS pattern_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_id TEXT NOT NULL,

  timestamp BIGINT NOT NULL,
  themes JSONB NOT NULL DEFAULT '[]',  -- Array<{ theme, count, totalCpLoss }>

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pattern_snapshots_user_ts ON pattern_snapshots (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pattern_snapshots_game    ON pattern_snapshots (user_id, game_id);

CREATE TRIGGER trg_pattern_snapshots_updated_at
  BEFORE UPDATE ON pattern_snapshots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE pattern_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY pattern_snapshots_select_own ON pattern_snapshots FOR SELECT
  USING (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY pattern_snapshots_insert_own ON pattern_snapshots FOR INSERT
  WITH CHECK (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY pattern_snapshots_update_own ON pattern_snapshots FOR UPDATE
  USING (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY pattern_snapshots_delete_own ON pattern_snapshots FOR DELETE
  USING (auth.jwt() ->> 'sub' = user_id);

-- ── USER PREFERENCES (singleton per user) ──
-- Stored as a single jsonb blob to mirror Base44's flexible-schema behavior
-- and avoid schema changes every time we add a setting.
CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,

  settings JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences (user_id);

CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_preferences_select_own ON user_preferences FOR SELECT
  USING (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY user_preferences_insert_own ON user_preferences FOR INSERT
  WITH CHECK (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY user_preferences_update_own ON user_preferences FOR UPDATE
  USING (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY user_preferences_delete_own ON user_preferences FOR DELETE
  USING (auth.jwt() ->> 'sub' = user_id);

-- ── INSIGHTS ──
-- AI-generated insights about the user's play. Low volume.
CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  generated_at BIGINT NOT NULL,
  game_ids JSONB NOT NULL DEFAULT '[]',  -- string[]
  text TEXT NOT NULL,
  themes JSONB NOT NULL DEFAULT '[]',    -- WeaknessTheme[]
  priority TEXT NOT NULL DEFAULT 'medium',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insights_user_generated ON insights (user_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_user_unread    ON insights (user_id, is_read);

CREATE TRIGGER trg_insights_updated_at
  BEFORE UPDATE ON insights
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY insights_select_own ON insights FOR SELECT
  USING (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY insights_insert_own ON insights FOR INSERT
  WITH CHECK (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY insights_update_own ON insights FOR UPDATE
  USING (auth.jwt() ->> 'sub' = user_id);
CREATE POLICY insights_delete_own ON insights FOR DELETE
  USING (auth.jwt() ->> 'sub' = user_id);
