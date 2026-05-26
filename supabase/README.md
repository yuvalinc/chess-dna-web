# Supabase

Database schema, RLS policies, and Edge Functions for Phase 2+ of the Fly + Supabase migration. See `docs/handoff/fly-migration-plan.md`.

Nothing here is live until a Supabase project is provisioned and `npx supabase db push` (or equivalent) is run.

## Setup (when you're ready)

```bash
# Install the Supabase CLI
brew install supabase/tap/supabase

# Log in
supabase login

# Link to your project (created via the Supabase dashboard)
supabase link --project-ref <project-ref>

# Apply migrations
supabase db push

# Deploy Edge Functions
supabase functions deploy auth-bridge
```

## Layout

```
supabase/
├── migrations/
│   ├── 0001_initial_schema.sql   — all 6 entity tables + RLS + indexes
│   └── 0002_drift_log.sql        — table used by dual-write drift logger (Phase 3)
├── functions/
│   └── auth-bridge/
│       └── index.ts              — Deno function: Base44 JWT → Supabase JWT
└── config.toml                   — created by `supabase init`, not yet present
```

## Auth model

Until we replace auth, the flow is:

```
User → Base44 login → JWT in localStorage
React app → calls auth-bridge Edge Function with Base44 JWT
auth-bridge → validates Base44 JWT → mints a Supabase JWT with sub=base44_user_id
React app → uses the Supabase JWT for all DB calls
```

RLS policies on every table check `auth.jwt() ->> 'sub' = user_id`. The `user_id` column on each row is the Base44 user ID (text, not UUID — Base44 IDs aren't UUIDs).

When we eventually swap to Supabase Auth proper, we either:
1. Migrate `user_id` values to Supabase UUIDs (one-time data migration), OR
2. Keep `user_id` as text and let both auth sources mint a `sub` claim with the same value.

## Entities migrated

| Entity | Table | Notes |
|---|---|---|
| Game | `games` | High-volume, all PGNs |
| Analysis | `analyses` | Large rows (moves jsonb), 1-to-1 with games |
| Pattern | `patterns` | Singleton per user (UNIQUE on user_id) |
| PatternSnapshot | `pattern_snapshots` | Append-only |
| UserPreferences | `user_preferences` | Singleton per user (UNIQUE on user_id) |
| Insight | `insights` | AI-generated, low volume |

Lesson / Exercise / TrainingPlan are CLAUDE.md placeholders — no code uses them yet. Add when needed.
