# engine-service

Native Stockfish analysis service for Chess DNA, deployed on Fly Machines.

Replaces the browser WASM Stockfish worker for users who opt in via `VITE_ENGINE_BACKEND=fly` in the React app.

## Why

- **Faster**: native Stockfish at depth 18 is ~5-10× faster than WASM in a browser tab
- **Frees the user's tab**: no CPU/memory pressure on iOS Safari (where WASM regularly OOMs)
- **Scales independently**: analysis throughput no longer bound by per-device hardware

## Status

Phase 1 of the [Fly + Supabase migration plan](../docs/handoff/fly-migration-plan.md).

Scaffolded — not yet deployable. Remaining work tracked in `TODO.md`.

## Architecture

```
React client                                       Fly Machine (this service)
  │                                                  │
  ├─ POST /analyze { gameId, pgn, depth } ─────────► │  spawn Stockfish process
  │                                  ◄────────────── │  return { jobId }
  │                                                  │
  ├─ GET /analyze/:jobId/stream (SSE) ─────────────► │  stream progress events
  │                                  ◄────────────── │  { type: 'progress', moveIndex, totalMoves }
  │                                  ◄────────────── │  { type: 'complete', result: GameAnalysis }
  │
  └─ writes GameAnalysis to Base44 / Supabase
```

Engine service is **stateless** beyond an in-memory job map. Restart loses pending jobs (client retries). DB stays on the client side.

## Local development

```bash
# Install Stockfish locally (macOS)
brew install stockfish

# Install deps
npm install

# Run dev server
npm run dev
# → http://localhost:8080
```

Sanity check:
```bash
curl http://localhost:8080/health
# → {"status":"ok","stockfish":"17.1"}
```

## Deploy

```bash
# One-time: create the Fly app
fly launch --name chess-dna-engine --no-deploy

# Set secrets (Base44 JWT validation)
fly secrets set BASE44_JWT_SECRET=<from-base44-dashboard>

# Deploy
fly deploy
```

## Env vars

| Var | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `8080` | HTTP port |
| `STOCKFISH_PATH` | no | `stockfish` | Path to native binary |
| `STOCKFISH_THREADS` | no | `1` | UCI Threads option |
| `STOCKFISH_HASH_MB` | no | `128` | UCI Hash MB |
| `MAX_CONCURRENT_JOBS` | no | `4` | Max parallel analyses per Machine |
| `JOB_TIMEOUT_MS` | no | `300000` | 5 min per game timeout |
| `BASE44_JWT_SECRET` | yes (prod) | — | HS256 secret to validate Base44 tokens. Skip in dev for unauthenticated local testing. |
| `AUTH_OPTIONAL` | no | `false` | Set to `true` in dev to skip auth |
| `SUPABASE_URL` | optional | — | If set, engine writes one row per job to `engine_jobs` for migration-health telemetry. |
| `SUPABASE_SERVICE_KEY` | optional | — | service_role JWT; required alongside `SUPABASE_URL` to enable telemetry. Bypasses RLS. |

## Endpoints

### `POST /analyze`
Submit a game for analysis.

Body:
```json
{
  "gameId": "abc123",
  "pgn": "[Event \"...\"]\n\n1. e4 e5 ...",
  "depth": 18
}
```

Response (202):
```json
{ "jobId": "uuid-here", "streamUrl": "/analyze/uuid-here/stream" }
```

### `GET /analyze/:jobId/stream`
SSE stream of progress + final result.

Events:
- `progress` — `{ moveIndex, totalMoves }`
- `complete` — `{ result: GameAnalysis }`
- `error` — `{ error: string }`

### `GET /analyze/:jobId`
Poll status (for clients that can't use SSE).

Response:
```json
{ "status": "pending|running|complete|error", "progress": { ... }, "result": { ... } }
```

### `GET /health`
Liveness + Stockfish version check.
