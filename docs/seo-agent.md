# SEO Agent — Daily Loop

A self-driving SEO improvement loop for chess-dna, with GitHub Issues as the
entire control plane (no Base44 dependency). One human approval per day,
everything else runs autonomously.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Daily ~07:00 — Anthropic Claude Code Routine                   │
│  Runs: node scripts/seo-daily.mjs                               │
│   1. Calls POST /v1/sessions against the managed SEO/GEO Agent  │
│   2. Sends the daily prompt (keywords, target URL, JSON schema) │
│   3. Agent uses the keyword.com MCP for SERP + AI Visibility    │
│   4. Polls until idle, fetches final agent message              │
│   5. Parses the JSON block (summary + rankings + tasks)         │
│   6. Opens a GitHub Issue: title "SEO YYYY-MM-DD — N tasks",    │
│      labels ["seo-daily","seo-pending"], body = markdown digest │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Morning — you open the issue in GitHub (desktop or mobile)     │
│   • Review summary + rankings + task checklist                  │
│   • Uncheck any task you want to skip                           │
│   • Add the "seo-approved" label to authorize the rest          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  You run `npm run seo:execute` on your Mac                      │
│  (after clicking Approve in the /seo dashboard)                 │
│   • Local Claude Code session = code edits AND Chrome MCP       │
│   • For each unchecked checklist item:                          │
│       - `claude -p "<task>" --print --dangerously-skip-perms`   │
│         (Claude picks the right tool — file edits for code      │
│          tasks, Chrome MCP for browser tasks like Search        │
│          Console submission, AlternativeTo listing, etc. —      │
│          using your already-logged-in browser session)          │
│       - Captures git diff, commits, pushes (code tasks)         │
│       - Takes screenshot before any irreversible submit click   │
│       - Checks the box in the issue body                        │
│       - Comments commit SHA / screenshot link + files touched   │
│   • All done → label "seo-done", close the issue                │
│   • Some failed → label "seo-partial", leave open               │
│                                                                  │
│  GHA workflow_dispatch is kept as a fallback for code-only      │
│  emergencies — `gh workflow run seo-claude-code.yml -f issue=N` │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Audit log = github.com/yuvalinc/chess-dna-web/issues           │
│  Each daily run is one closed issue with full history:          │
│   working/done/failed comments, commit SHAs, file lists,        │
│   approver, timestamps. Searchable, exportable, free.           │
└─────────────────────────────────────────────────────────────────┘
```

## One-time setup

### 1. Create a GitHub PAT for the Anthropic Routine

The routine runs on Anthropic's cloud and needs to create issues. Create a
fine-grained Personal Access Token at https://github.com/settings/tokens?type=beta:

- **Repository access**: only `yuvalinc/chess-dna-web`
- **Permissions**: Issues → Read and write, Contents → Read-only, Metadata → Read-only
- **Expiration**: 1 year (longest available)

Copy the token (starts with `github_pat_…`).

> The GitHub Actions workflow doesn't need a custom PAT — it uses the auto-provided `GITHUB_TOKEN`.

### 2. Add the GHA secret for the Anthropic key

The executor workflow needs `ANTHROPIC_API_KEY` (for the Claude Code CLI):

```bash
printf '%s' 'sk-ant-api03-…' | gh secret set ANTHROPIC_API_KEY --repo yuvalinc/chess-dna-web
```

> No `BASE44_…` secrets are needed anymore. The old `BASE44_TOKEN` / `BASE44_API_KEY` can be deleted from the repo's secrets list.

### 3. Connect the keyword.com MCP to the agent's environment

The daily agent pulls rankings from **keyword.com's hosted MCP server**
(`https://app.keyword.com/mcp`). One-time setup, in the Anthropic Managed
Agents console:

1. Open the SEO/GEO Agent's **Environment** (`env_01XnkgKT2C35kgoGqQSWNisG`).
2. Under **MCP servers / Connectors**, add a Streamable-HTTP server:
   - **URL**: `https://app.keyword.com/mcp`
   - **Auth**: OAuth 2.0 — a browser tab opens for keyword.com consent.
3. Approve the OAuth scope with the keyword.com account that owns the
   chess-dna project.

Without this step, the agent falls back to generic web search.

### 4. Create the daily Claude Code Routine

Go to https://claude.ai/code/routines → **New routine**.

- **Name**: `seo-daily`
- **Schedule**: Daily at 07:00 (local TZ)
- **Repository**: leave blank (script self-clones via `git clone`)
- **Instructions**:
  ```
  Daily SEO check. Run these commands in order, then exit with the status code of `npm run seo:daily`:

    export ANTHROPIC_API_KEY='PASTE_ANTHROPIC_KEY_HERE'
    export GH_TOKEN='PASTE_GITHUB_PAT_HERE'
    git clone https://github.com/yuvalinc/chess-dna-web /tmp/chess-dna-web
    cd /tmp/chess-dna-web
    npm install
    npm run seo:daily

  The script is self-contained — do not modify files, do not commit, do not push.
  ```
- Replace the two `PASTE_…_HERE` strings with the real values from steps 1 and 2.

### 5. Customize keywords (optional)

Defaults are baked in to `scripts/seo-daily.mjs`. Override per-routine via env:

```
SEO_KEYWORDS="how to improve at chess, chess analysis app, ..."
SEO_SITE_URL="https://chess-dna-fdd5fbde.base44.app"
SEO_KEYWORDCOM_PROJECT="chess-dna"   # name of the keyword.com project
```

## Daily workflow

1. **07:00 (laptop can be off)** — Routine fires on Anthropic's cloud. Agent runs ~2–4 min. New GitHub Issue lands.
2. **Morning (you open laptop)** — Visit https://chessdna.app/seo (or github.com/yuvalinc/chess-dna-web/issues). Skim today's issue:
   - Looks right → click **Approve Claude Code →** in the dashboard.
   - Some tasks are wrong → uncheck them first, then approve.
   - Whole thing is wrong → close the issue, no harm.
3. **Run the executor on your Mac** (one command, ~5-30 min depending on task count):
   ```bash
   npm run seo:execute
   ```
   Claude Code picks the right tool per task:
   - Code tasks → file edits in chess-dna repo, commits per task, pushes to main.
   - Browser tasks → drives Chrome via MCP using your logged-in sessions (Google Search Console, Bing Webmaster, AlternativeTo, etc.). Stops before irreversible "Submit" clicks unless the task explicitly authorizes them.
4. **End of day** — Skim today's commits on main + comments on the closed issue to see what shipped.

## Manual operations

| Want to…                                | Command                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------ |
| Test the daily run locally              | `ANTHROPIC_API_KEY=... GH_TOKEN=$(gh auth token) npm run seo:daily`      |
| Force-execute a specific issue          | `gh workflow run seo-claude-code.yml -f issue=<issue-number>`            |
| Stop a running execution                | `gh run cancel <gha-run-id>`                                             |
| Skip a task without running it          | Uncheck its box in the issue body before adding `seo-approved`           |
| Re-run today                            | Close + delete today's issue, then run `npm run seo:daily` locally       |

## Gotchas

- **15-min cron lag** — The executor polls every 15 min, so approved issues can take up to 15 min to start. To dispatch immediately: `gh workflow run seo-claude-code.yml -f issue=<n>`.
- **Auto-push to main** — The executor commits & pushes directly to main (per CLAUDE.md's "no feature branches" rule). Revert via `git revert <sha>` if Claude Code does something wrong.
- **PAT rotation** — The Anthropic Routine's GitHub PAT expires (1y max). Issue the script will fail with `401 Bad credentials` from GitHub. Generate a new PAT, update the routine env, done.
- **No deploy on commit** — The workflow does NOT run `npm run build` or `npx base44 site deploy`. Deploys remain manual.
- **Idempotency** — `seo-daily.mjs` checks for an existing issue with today's date in the title and exits early if found. Safe to run multiple times.

## File map

| File                                          | Purpose                                          |
| --------------------------------------------- | ------------------------------------------------ |
| `scripts/seo-daily.mjs`                       | Invokes the managed agent, opens daily GH issue  |
| `scripts/seo-execute.mjs`                     | Runs Claude Code on approved-issue tasks         |
| `.github/workflows/seo-claude-code.yml`       | GHA cron + workflow_dispatch wiring              |
