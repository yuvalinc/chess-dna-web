#!/bin/bash
# SEO executor daemon wrapper.
#
# This wrapper is invoked by launchd every 30 seconds. It:
#   1. Refuses to run if another instance is mid-execution (PID lock).
#   2. Loads env vars (GH_TOKEN via `gh auth token`; ANTHROPIC_API_KEY
#      via Claude Code's local auth if logged in, or ~/.seo-agent.env).
#   3. Invokes scripts/seo-execute.mjs, which itself short-circuits if
#      no GitHub issues currently carry the seo-approved label.
#
# Logs land in ~/Library/Logs/seo-executor.{out,err}.log
# Stop the daemon with:  npm run seo:daemon-stop

set -e
LOCKFILE="/tmp/seo-executor.lock"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Lock: bail if another instance is running.
if [ -f "$LOCKFILE" ]; then
  PID=$(cat "$LOCKFILE" 2>/dev/null || echo "")
  if [ -n "$PID" ] && ps -p "$PID" > /dev/null 2>&1; then
    exit 0
  fi
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

# Source optional env file (for ANTHROPIC_API_KEY if not in shell).
[ -f "$HOME/.seo-agent.env" ] && set -a && . "$HOME/.seo-agent.env" && set +a

# Get GH_TOKEN from gh CLI if not already set.
if [ -z "$GH_TOKEN" ] && command -v gh >/dev/null 2>&1; then
  export GH_TOKEN=$(gh auth token 2>/dev/null || true)
fi

# Quick existence check — if there are no approved issues, exit silently
# to keep the logs clean (launchd will fire again in 30s).
if [ -z "$GH_TOKEN" ]; then
  echo "[$(date '+%H:%M:%S')] GH_TOKEN not set; skipping" >&2
  exit 0
fi

cd "$REPO_DIR"

# Make sure PATH is set right — launchd starts with a minimal env.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Locate the Claude Code CLI. It's bundled inside the Mac Claude app at
# ~/Library/Application Support/Claude/claude-code/<version>/claude.app/Contents/MacOS/claude.
# The version changes with each update; pick the highest-versioned one.
CLAUDE_DIR=$(ls -d "$HOME/Library/Application Support/Claude/claude-code"/*/claude.app/Contents/MacOS 2>/dev/null | sort -V | tail -1)
if [ -n "$CLAUDE_DIR" ]; then
  export PATH="$CLAUDE_DIR:$PATH"
fi

# Only log on actual activity (executor itself logs to stdout when working).
node scripts/seo-execute.mjs
