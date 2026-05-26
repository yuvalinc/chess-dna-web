# engine-service — remaining work

## Phase 1 (current)

- [x] Scaffold: Dockerfile, fly.toml, package.json, tsconfig
- [x] HTTP server (Hono): /health, POST /analyze, SSE stream, status poll
- [x] StockfishProcess wrapper (stdin/stdout, UCI protocol, rich PositionEval)
- [x] In-memory job manager with subscribe/replay semantics
- [x] JWT auth middleware (Base44 token, dev override)
- [x] Concurrency semaphore (MAX_CONCURRENT_JOBS)
- [x] **game-analyzer.ts ported** — full port with all 4 dependencies:
  - `engine/eval-classifier.ts` (move quality + win chance + sacrifice detection)
  - `engine/phase-detector.ts` (opening/middlegame/endgame + material count)
  - `engine/tactical-detector.ts` (motif detection + cheap deterministic motifs)
  - `engine/uci-parser.ts` (parseInfoLine, parseBestMove, accuracy formula)
  - Main `analyzeGame()` loop with playerColor input
- [x] Typecheck clean (`npm run typecheck`)
- [x] Stockfish 17.1 ubuntu binary URL verified
- [ ] **Local smoke test**: needs `brew install stockfish`, then `npm run dev` + curl POST /analyze with a real PGN
- [ ] Parity test script: same 10 PGNs through browser WASM and Fly engine, diff results (target: identical moveSan/bestMove, eval within ±5cp)
- [ ] Cost-per-analysis instrumentation (log Stockfish CPU time per job)

## Phase 1 client-side (after engine is deployed)

- [ ] `src/engine/fly-client.ts` in main app — adapter that POSTs PGN and streams SSE
- [ ] Update `src/engine/analysis-pipeline.ts` to branch on `VITE_ENGINE_BACKEND`
- [ ] Update `src/shared/constants.ts` with `FLY_ENGINE_URL`
- [ ] A/B telemetry: which backend was used, latency, errors

## Phase 1 deploy

- [ ] User signs up for Fly + installs flyctl (see migration plan prereqs)
- [ ] `fly launch --copy-config --no-deploy` to provision app
- [ ] `fly secrets set BASE44_JWT_SECRET=<value>` — need to get from Base44 dashboard / their support
- [ ] `fly deploy`
- [ ] Verify health endpoint returns Stockfish 17.1
- [ ] Run parity test against deployed URL
- [ ] Flip `VITE_ENGINE_BACKEND=fly` for yuval@ only first, then 1%, then 10%, then 100%

## Phase 2+ (Supabase) — separate work tracked in main migration plan
