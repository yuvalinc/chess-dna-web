# Migration Go/No-Go Checklist

**Use this**: every day during the shadow-mode soak, fill in one column. Make the flip decision when an entity has 3 consecutive ✅ days.

## The single command you run daily

```bash
cd /Users/yuval/Chess-dna
node scripts/migration-health.mjs \
  --base44-token "$BASE44_TOKEN" \
  --supabase-url https://mhmwmgesyguaphniiedp.supabase.co \
  --supabase-service-key "$SUPABASE_SERVICE_KEY"
```

Where to get the values:
- `BASE44_TOKEN` — browser DevTools → Application → Local Storage on the live app → `base44_access_token`
- `SUPABASE_SERVICE_KEY` — https://supabase.com/dashboard/project/mhmwmgesyguaphniiedp/settings/api → `service_role` secret (click the eye)

Tip: paste them into env vars once per shell session and re-run the bare command.

## Per-entity go criteria

An entity is **ready to flip** (`VITE_READ_FROM_<entity>=supabase`) when ALL of these hold for 3 consecutive days:

| Signal | Threshold | Source |
|---|---|---|
| Row-count delta (Base44 vs Supabase) | ≤ 1% | migration-health script |
| `drift_3d` count | == 0 | `SELECT * FROM migration_health` |
| Recent drift inspection | nothing weird | `SELECT * FROM drift_recent WHERE entity='<X>'` |
| Sample integrity (20 rows random) | field-for-field match | manual spot-check via dashboard |
| Engine success rate (Game/Analysis only) | ≥ 99% | engine_health view |

If any signal is red, **do not flip**. Investigate first.

## Daily log template (fill in)

Copy this each day:

```
─── Day N — YYYY-MM-DD ───
Game             [ ]  rows Δ:____  drift_3d:____  notes:____
Analysis         [ ]  rows Δ:____  drift_3d:____  notes:____
Pattern          [ ]  rows Δ:____  drift_3d:____  notes:____
PatternSnapshot  [ ]  rows Δ:____  drift_3d:____  notes:____
UserPreferences  [ ]  rows Δ:____  drift_3d:____  notes:____
Insight          [ ]  rows Δ:____  drift_3d:____  notes:____

Engine: jobs____ p95____ success%____ cost$____
```

`[✅]` = clean, `[⚠️]` = drift present, `[❌]` = couldn't query.

## Recommended flip order

Smallest blast radius first. Wait 24h between flips and re-check the script.

1. **UserPreferences** (1 row per user, simplest schema)
2. **Pattern** (1 row per user, larger jsonb)
3. **Insight** (low volume, AI-generated)
4. **PatternSnapshot** (append-only, more rows)
5. **Analysis** (large rows, many per user)
6. **Game** (highest volume — last)

## When something goes wrong

- **Drift spikes on an entity**: query `SELECT * FROM drift_recent WHERE entity='X' ORDER BY id DESC LIMIT 50` and look at the `field` + `note` columns. Common harmless causes: timestamp precision, JSON key ordering, null vs undefined. Fix in `supabase-transform.ts` or `dual-write.ts`.
- **Row counts diverge by >1%**: run the backfill script again with `--entities <X>`. If still diverging, dual-write isn't catching some path — find it via `git grep "entities.<X>.create"`.
- **Engine success rate drops**: `fly logs --app chess-dna-engine` shows the actual errors. Also `SELECT * FROM engine_jobs WHERE success=false ORDER BY created_at DESC LIMIT 20`.
- **After a read flip causes UI bugs**: revert by changing `VITE_READ_FROM_<entity>` back to `base44` (or removing the line) and redeploying. Dual-write keeps Base44 hot, so the rollback is instant.

## What "complete migration" looks like at the end

All 6 entities have `VITE_READ_FROM_<entity>=supabase` AND have been stable for 30 days at that setting. Then we set every `VITE_DUAL_WRITE_<entity>=false` (Phase 7) and the Base44 DB stops receiving writes. Keep Base44 as cold backup for another 30 days, then cancel.

## Cost guardrails

During shadow mode itself the additional cost is:
- Supabase: free tier covers our test data
- Fly engine: only runs when `VITE_ENGINE_BACKEND=fly` is flipped. While only your account uses it, expect <$1/mo.

After 100% flip with all users:
- 100 users: ~$10/mo total new spend
- 1k users: ~$60-75/mo
- 10k users: ~$400-650/mo

Watch the Fly dashboard for unexpected machine starts. The `auto_stop_machines = "suspend"` config keeps cold idle cost ~$0.
