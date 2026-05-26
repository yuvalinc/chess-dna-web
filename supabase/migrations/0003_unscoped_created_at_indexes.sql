-- 0003_unscoped_created_at_indexes.sql
--
-- Shadow-read does unscoped `ORDER BY created_at DESC LIMIT N` queries — it
-- mirrors Base44's RLS-scoped lists, but in Supabase we bypass RLS via the
-- service role, so the query reads across all users. The existing composite
-- (user_id, created_at DESC) index can't satisfy an unprefixed ORDER BY, so
-- the planner falls back to a full table scan + sort and times out on the
-- larger tables (statement_timeout fires at 8s).
--
-- A dedicated descending index on `created_at` makes these planner-bound
-- queries an index-only scan + LIMIT, which finishes in tens of ms regardless
-- of table size.
--
-- These indexes become moot the day shadow-read switches to user-scoped
-- queries (i.e. when we add `?user_id=eq.<sub>` to every list call) — at
-- that point the composite index is sufficient. Drop these then.

CREATE INDEX IF NOT EXISTS idx_analyses_created_at         ON public.analyses         (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_created_at            ON public.games            (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pattern_snapshots_created_at ON public.pattern_snapshots (created_at DESC);
