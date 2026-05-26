# Fly + Supabase Migration Plan

**Status**: planning · **Owner**: yuval · **Started**: 2026-05-25

## Goal

Migrate two things off Base44:
1. **Analysis processing** → native Stockfish on Fly Machines (target ~5-10× faster than browser WASM, frees the user's tab)
2. **Database** → Supabase Postgres (removes 5000-record cap, removes Base44 scalability ceiling)

Auth stays on Base44 for now (decided later). Run both systems in parallel with feature-flagged cutover per entity. **No big-bang switches.**

## Architecture

```
React app
 ├─ entity hooks  →  [feature flag per entity]
 │                    ├─ Base44         (current — kept hot for rollback)
 │                    └─ Supabase REST  (new)
 │
 └─ queueForAnalysis  →  [VITE_ENGINE_BACKEND flag]
                          ├─ Browser WASM Stockfish  (current)
                          └─ Fly engine service      (new, native, faster)
                              ├─ POST /analyze       (PGN in, job_id out)
                              ├─ GET  /analyze/:id/stream  (SSE progress + result)
                              └─ GET  /analyze/:id   (poll fallback)
```

Engine service is **stateless** — receives PGN, returns `GameAnalysis`. No DB access. Auth via Base44 JWT validation.

## Decisions

| Question | Decision |
|---|---|
| DB platform | Supabase Cloud |
| Auth | Keep Base44 JWT for now; revisit after DB is stable |
| Engine language | Node 22 + Hono (matches stack) |
| Engine container | `node:22-slim` (Debian) + Stockfish 17.1 binary downloaded at build |
| Engine concurrency | 1 Stockfish process per analysis, N per Machine, autoscale on queue depth |
| Engine ↔ Client comm | SSE for progress, REST for submit/status |
| Existing data | Migrate everything (Games, Analyses, Patterns, UserPreferences, …) |
| Cutover unit | Per entity, behind feature flag |
| Rollback strategy | Each phase has a single-flag rollback to the previous state |

## Prerequisites (you do these)

- [ ] **Fly.io account**: sign up at https://fly.io/app/sign-up (credit card required for Machines)
- [ ] **Install flyctl**: `brew install flyctl`
- [ ] **Log in**: `fly auth login && fly auth whoami`
- [ ] **Supabase account**: sign up at https://supabase.com
- [ ] **Create Supabase project** (region: pick close to your users, e.g. `us-east-1`). Save: project URL, anon key, service_role key.
- [ ] Add to `.env.local` in /Users/yuval/Chess-dna/:
  ```
  VITE_SUPABASE_URL=https://<project>.supabase.co
  VITE_SUPABASE_ANON_KEY=<anon-key>
  # Don't commit service_role — keep it for the Fly engine env only
  ```

## Phases

Each phase is independently mergeable and reversible. Phase exit = the gate to start the next phase.

---

### Phase 1: Engine service on Fly  (week 1)

**Goal**: native Stockfish service running on Fly, A/B-able against the browser worker.

**Deliverables**:
- `engine-service/` directory: Dockerfile, fly.toml, Hono server, Stockfish wrapper, game-analyzer port
- `POST /analyze` returns `{ jobId }`
- `GET /analyze/:jobId/stream` returns SSE with `progress` and `complete` events
- `GET /health` returns 200
- JWT validation middleware (accepts Base44 token; configurable secret/JWK)
- `src/engine/fly-client.ts` — adapter on the React side
- `VITE_ENGINE_BACKEND=browser|fly` flag in `analysis-pipeline.ts`
- Defaults to `browser` (no behavior change for users)

**Verification**:
- Hit `/analyze` locally → returns analysis matching browser WASM within ±5 cp per move
- Deploy to Fly → same test against the deployed URL
- Flip flag to `fly` for your own user → analyze 10 games → compare results vs browser worker
- Latency comparison logged: target ≥3× speedup at depth 18

**Rollback**: set `VITE_ENGINE_BACKEND=browser`, redeploy app. Engine service can stay up — it just stops receiving traffic.

**Exit criteria**:
- 100 games analyzed via Fly with no errors
- Result parity verified (sample of 10 games, full move-by-move comparison)
- Latency ≥3× faster than browser
- Cost per analysis logged

---

### Phase 2: Supabase schema + JWT bridge  (week 2)

**Goal**: Supabase project with all entity tables, RLS policies, and a JWT validation function that accepts Base44 tokens.

**Deliverables**:
- `supabase/migrations/0001_initial_schema.sql` — tables for Game, Analysis, Pattern, UserPreferences, PatternSnapshot, Insight, Lesson, Exercise, TrainingPlan (one table per entity, mirror Base44 fields)
- RLS policies: `user_id = auth.uid()` for all tables
- Edge Function `supabase/functions/auth-bridge/` — validates Base44 JWT, returns Supabase JWT with `user_id` claim
- Indexes on common query fields (`gameId`, `playerUsername`, `playedAt`, `analysisStatus`)
- `src/api/supabaseClient.ts` — client setup
- No production code uses it yet — sanity-check via dashboard + smoke test only

**Verification**:
- Run all 9 entity-table SQL migrations locally → dashboard shows tables
- Insert a row via Supabase client → RLS blocks reads from other users
- Run auth-bridge with a Base44 JWT → returns Supabase JWT
- Smoke test: write + read a Game via Supabase JS client end-to-end

**Rollback**: nothing in production touches Supabase yet — just delete the project if needed.

**Exit criteria**:
- All entity tables exist with correct schema
- RLS verified on every table (test as another user)
- Auth bridge works
- Smoke-test script in `engine-service/scripts/smoke-supabase.ts` passes

---

### Phase 3: Dual-write per entity  (weeks 3-4)

**Goal**: every write goes to both Base44 and Supabase. Reads stay on Base44. Drift logged.

**Order** (smallest blast radius first):
1. **UserPreferences** (singleton, simplest)
2. **Pattern** (singleton)
3. **PatternSnapshot** (append-only)
4. **Insight, Lesson, Exercise, TrainingPlan** (AI-generated, lower volume)
5. **Analysis** (per-game, large rows due to serialized moves)
6. **Game** (highest volume, biggest field set, last)

**Deliverables**:
- `src/api/dual-write.ts` — wraps entity hooks, writes to both backends
- Per-entity flag: `VITE_DUAL_WRITE.<Entity>=true|false` (default false)
- Drift logger: after each dual write, compare returned rows, log mismatches to console + Supabase `drift_log` table
- Backfill script per entity (used in Phase 4)

**Verification**:
- Enable dual-write for UserPreferences only
- Make 20 settings changes → check Supabase row matches Base44
- Watch drift_log → should be empty
- Repeat per entity as you enable each one

**Rollback per entity**: set `VITE_DUAL_WRITE.<Entity>=false`. Base44 remains authoritative. Supabase rows become stale but not destructive.

**Exit criteria**:
- All 9 entity types dual-writing for ≥3 days with <0.1% drift
- Drift cases all explained (timing, idempotency) — no unresolved mismatches

---

### Phase 4: Backfill historical data  (week 5)

**Goal**: copy all existing Base44 data into Supabase so the two are in sync.

**Deliverables**:
- `engine-service/scripts/backfill.ts` — paginates Base44 `entity.list()`, batch-inserts to Supabase
- Handles Base44's 5000-record limit per request via cursor pagination
- Per-entity idempotency: skip rows already in Supabase by `id` or `(user_id, gameId)`
- Progress log per entity, total row count, error log

**Verification**:
- Run for each entity → row counts match (Base44 count ≈ Supabase count)
- Spot-check 20 rows per entity for field-level equality
- Re-run script → no duplicate inserts (idempotent)

**Rollback**: `TRUNCATE` the Supabase tables and re-run. Backfill is repeatable.

**Exit criteria**:
- Row counts match within tolerance for every entity
- No errors in backfill log
- Sample diff per entity passes

---

### Phase 5: Shadow-read + drift detection  (week 6)

**Goal**: every read fetches from both backends and compares. Logs drift. Still serves Base44 result to the UI.

**Deliverables**:
- `src/api/shadow-read.ts` — wraps read hooks, fires both queries, compares, logs differences
- Per-entity flag: `VITE_SHADOW_READ.<Entity>=true|false`
- Drift dashboard (simple page) showing recent mismatches per entity
- Investigate every drift cluster (likely: timestamp precision, JSON ordering, null vs undefined)

**Verification**:
- Run for a week with all entities shadow-reading
- Drift rate <0.01% per entity
- Every drift case has a known cause

**Rollback**: flip shadow-read flag off per entity. No user impact.

**Exit criteria**:
- Drift rate <0.01% sustained for 3 consecutive days per entity

---

### Phase 6: Flip reads per entity  (weeks 7-8)

**Goal**: reads come from Supabase, writes still go to both.

**Order**: same as Phase 3 (smallest blast radius first).

**Deliverables**:
- `VITE_READ_FROM.<Entity>=base44|supabase` flag (default base44)
- Per-entity flip with 24h soak before flipping the next entity
- Error rate monitoring: if errors spike on a flipped entity → flip back immediately

**Verification**:
- After each entity flip: monitor error rate, load times, user reports for 24h
- No degradation → proceed to next entity
- Degradation → flip back, investigate, fix, retry

**Rollback per entity**: set `VITE_READ_FROM.<Entity>=base44`. Dual-write kept Supabase warm so re-flipping forward later is safe.

**Exit criteria**:
- All 9 entities reading from Supabase
- 7 consecutive days with no rollbacks
- Error rate equal-or-better vs Base44 baseline

---

### Phase 7: Stop Base44 writes  (week 9)

**Goal**: Supabase is the single source of truth. Base44 is cold backup.

**Deliverables**:
- `VITE_DUAL_WRITE.<Entity>=false` for all entities
- Final Base44 export snapshot saved to S3/Backblaze (cold backup)
- Code cleanup: remove dual-write wrappers (keep behind feature flag for 30 days, then delete)

**Verification**:
- 30 days with no rollback need
- Base44 account can be downgraded to free tier or canceled

**Rollback**: hardest of any phase. Would require Base44 catch-up sync from Supabase. Avoid by being thorough in Phase 6.

**Exit criteria**:
- 30 days stable on Supabase
- Cold backup verified restorable

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Drift between Base44 and Supabase during dual-write | High | Med | Drift logging + investigation in Phase 5 before flipping reads |
| Engine service hangs on a malformed PGN | Med | Med | 5-min per-game timeout, process kill, error response |
| Fly Machine OOM under load | Med | Med | Memory limit set, autoscale on queue depth, alerting |
| Base44 JWT format changes | Low | High | Auth bridge isolates this; if it happens we update one function |
| Supabase outage during cutover | Low | High | Feature flag flip back to Base44 in seconds (dual-write keeps Base44 hot through Phase 7) |
| iOS PWA pending-patch quirks break on Supabase | Med | Med | Port `useSingletonEntity` as-is, test on iOS device before flipping reads for any singleton entity |
| Cost surprise on Fly (Stockfish CPU-hungry) | Med | Low | Per-analysis cost logging in Phase 1; set Fly machine count + autoscale ceiling |
| Backfill misses rows (Base44 5000-cap pagination bug) | Med | High | Row count reconciliation in Phase 4; re-run repeatedly until counts match |

## Timeline estimate

| Phase | Duration | Cumulative |
|---|---|---|
| P1 Engine service | 1 week | week 1 |
| P2 Supabase schema | 1 week | week 2 |
| P3 Dual-write | 2 weeks | week 4 |
| P4 Backfill | 1 week | week 5 |
| P5 Shadow-read | 1 week | week 6 |
| P6 Flip reads | 2 weeks | week 8 |
| P7 Stop Base44 writes | 1 week + 30 day soak | week 9 (then 30 days soak) |

**Total active work**: ~9 weeks. **Total to safe Base44 decommission**: ~13 weeks.

This is honest. It's a real migration, not a weekend project. The phasing is what protects against the wipe-pattern your codebase has already suffered twice.
