# SEO Agent — Daily Loop

A self-driving SEO improvement loop for chess-dna. One human approval per day; everything else runs on its own.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Daily ~07:00 — Anthropic Claude Code Routine                   │
│  Runs: node scripts/seo-daily.mjs                               │
│   1. Calls POST /v1/sessions against the managed SEO/GEO Agent  │
│   2. Sends the daily prompt (keywords, target URL, JSON schema) │
│   3. Agent uses the keyword.com MCP (attached to its env) to    │
│      pull real SERP rankings, movers, share of voice, and       │
│      AI Visibility metrics (ChatGPT / Perplexity / Gemini)      │
│   4. Polls until idle, fetches final agent message              │
│   5. Parses the JSON block (summary + rankings + tasks)         │
│   6. Writes a SeoRun entity to Base44 with status="completed"   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Morning — you visit /seo in chess-dna                          │
│   • Review summary + rankings + extracted tasks                 │
│   • Click "Approve Claude Code →"                               │
│   • SeoRun.status becomes "approved"                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  GHA workflow seo-claude-code.yml (cron */15 min)               │
│  Runs: node scripts/seo-execute.mjs                             │
│   • Polls Base44 for SeoRun.status=="approved"                  │
│   • For each pending task: `claude -p "<task>" --print`         │
│   • Captures git diff, commits per task, pushes to main         │
│   • Updates task statuses in Base44 (in_progress → done/failed) │
│   • Sets run.status to done/partial/failed when finished        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  /seo dashboard refreshes — see each task's status, commit SHA, │
│  files touched. PR/diff history is the audit log.               │
└─────────────────────────────────────────────────────────────────┘
```

## One-time setup

### 1. Deploy the Base44 entity

```bash
npx base44 schema deploy
```

This pushes `base44/entities/seo-run.jsonc` to your Base44 app. Until this runs, the `/seo` dashboard will show an error banner.

### 2. Add GitHub Actions secrets

Go to https://github.com/yuvalinc/chess-dna-web/settings/secrets/actions and add:

| Secret name         | Value                                                        |
| ------------------- | ------------------------------------------------------------ |
| `ANTHROPIC_API_KEY` | API key with Managed Agents access (the one already used by the console) |
| `BASE44_API_KEY`    | App's server-side API key from app.base44.com → ChessDNA → API page. Bypasses the host allowlist (cloud IPs are fine). Doesn't expire — set once and forget. |

> **Why `BASE44_API_KEY` and not the user JWT?** The user JWT (in `~/.base44/auth/auth.json`) is subject to a host allowlist — calls from Anthropic-cloud or GitHub-Actions IPs are rejected with `403 Host not in allowlist`. The app-scoped api_key is the documented external-integration credential and is not constrained by the allowlist. It also doesn't expire every 30 days the way the JWT does.

### 3. Create the daily Claude Code Routine

Go to https://claude.ai/code/routines → New routine.

- **Repository**: `yuvalinc/chess-dna-web` (the routine clones it for context)
- **Schedule**: `0 7 * * *` (daily at 07:00 in your local TZ)
- **Prompt**:
  ```
  Run the daily SEO agent: `npm run seo:daily`.

  This script invokes the managed SEO/GEO Agent, parses today's output,
  and writes a SeoRun entity to Base44. Required env: ANTHROPIC_API_KEY,
  BASE44_API_KEY. If the script exits non-zero, capture the stderr and
  exit too so the failure is visible in the routine log.
  ```
- **Env vars**: `ANTHROPIC_API_KEY`, `BASE44_API_KEY` (same as the GHA secrets above). Anthropic Routines (research preview) don't have a real secrets store, so set these inline at the start of the bash command sequence via `export VAR=...` — see the Instructions field of the seo-daily routine for the working pattern.

### 4. Connect the keyword.com MCP

The daily agent pulls rankings from **keyword.com's hosted MCP server**
(`https://app.keyword.com/mcp`). One-time setup, in the Anthropic Managed
Agents console:

1. Open the SEO/GEO Agent's **Environment** (`env_01XnkgKT2C35kgoGqQSWNisG`).
2. Under **MCP servers / Connectors**, add a Streamable-HTTP server:
   - **URL**: `https://app.keyword.com/mcp`
   - **Auth**: OAuth 2.0 — a browser tab opens for keyword.com consent.
3. Approve the OAuth scope with the keyword.com account that owns the
   chess-dna project. Tokens auto-refresh; no key to copy.
4. Verify by running the routine once (or `npm run seo:daily` locally) —
   the agent should call `search_projects`, `list_keywords`, `serp_movers_window`,
   `aiv_metrics`, etc., instead of generic web search.

**Prerequisite**: an active keyword.com account with a project tracking the
chess-dna target keywords. Free trial works. If no project exists yet, the
agent will propose creating it as the first task in tomorrow's run.

The 66 tools cover SERP rank tracking, Share of Voice, anomalies, AI Visibility
(ChatGPT / Perplexity / Gemini / AI Overviews), competitor analysis, and
keyword research. Full reference: https://keyword.com/docs/#mcp.

> The daily prompt explicitly forbids calling write tools (`add_*`, `update_*`,
> `delete_*`, `refresh_*`). Anything that would mutate keyword.com state gets
> proposed as a task for human approval instead.

### 5. Customize keywords (optional)

Defaults are baked in to `scripts/seo-daily.mjs`. Override per-routine via env:

```
SEO_KEYWORDS="how to improve at chess, chess analysis app, ..."
SEO_SITE_URL="https://chess-dna-fdd5fbde.base44.app"
SEO_KEYWORDCOM_PROJECT="chess-dna"   # name of the keyword.com project to scope queries to
```

## Daily workflow

1. **07:00** — Routine fires. Agent runs ~2–4 min. SeoRun lands in Base44.
2. **Morning** — Open https://chess-dna-fdd5fbde.base44.app/seo. Review.
   - If the analysis looks right → click **Approve Claude Code →**.
   - If it looks off → don't approve. Edit tasks in the dashboard (skip the bad ones), then approve.
3. **Within 15 min** — GHA cron picks up the approved run, runs Claude Code on each task. You can watch progress on the dashboard (task statuses update live as each finishes) or in the linked workflow run.
4. **End of day** — Skim today's commits on `main` to see what landed.

## Manual operations

| Want to…                                | Command                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------ |
| Test the daily run locally              | `ANTHROPIC_API_KEY=... BASE44_TOKEN=... npm run seo:daily`               |
| Force-execute a specific run            | `gh workflow run seo-claude-code.yml -f run_id=<seo-run-id>`             |
| Stop a running execution                | `gh run cancel <gha-run-id>`                                             |
| Skip a task without running it          | Use the **Skip** button on the task row in the dashboard                 |
| Re-run today (deletes today's SeoRun)   | Delete the entity row in Base44 admin, then run `npm run seo:daily`      |

## Gotchas

- **15-min cron lag** — The executor polls every 15 min, so approved runs can take up to 15 min to start executing. If you want it faster, dispatch manually with `gh workflow run`.
- **Auto-push to main** — The executor commits & pushes directly to main (per CLAUDE.md's "no feature branches" rule). Revert via `git revert <sha>` if Claude Code does something wrong.
- **Token expiry** — `BASE44_TOKEN` is a JWT that expires (~30 days). When it expires, the script will fail; re-run `npx base44 login` locally and copy the new token to GHA secrets + routine env.
- **No deploy on commit** — The workflow does NOT run `npm run build` or `npx base44 site deploy`. Deploys remain manual.
- **Idempotency** — `seo-daily.mjs` checks for an existing non-failed SeoRun for today and exits early. Safe to run multiple times.
- **keyword.com MCP not connected** — if the connector is missing or its OAuth has expired, the agent falls back to generic web search and rankings will be noisy / blank. Reconnect via the Anthropic Managed Agents console (step 4 above).
- **No keyword.com project** — first run after setup will surface this as a P0 task ("create chess-dna project + add target keywords"). Do that in keyword.com's UI before approving — the executor will not run write tools against keyword.com.

## File map

| File                                          | Purpose                                          |
| --------------------------------------------- | ------------------------------------------------ |
| `base44/entities/seo-run.jsonc`               | SeoRun entity schema                             |
| `src/shared/types/seo.ts`                     | TS types                                         |
| `src/pages/SeoAdmin.tsx`                      | The `/seo` dashboard                             |
| `scripts/seo-daily.mjs`                       | Invokes the managed agent, writes SeoRun         |
| `scripts/seo-execute.mjs`                     | Runs Claude Code on approved tasks               |
| `.github/workflows/seo-claude-code.yml`       | GHA cron + workflow_dispatch wiring              |
