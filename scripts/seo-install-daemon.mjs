#!/usr/bin/env node
// Install (or uninstall) the SEO executor as a launchd agent that runs
// every 30 seconds in the background while you're logged into your Mac.
//
// Usage:
//   npm run seo:install-daemon    # install + start
//   npm run seo:uninstall-daemon  # stop + remove

import { writeFileSync, mkdirSync, existsSync, unlinkSync, chmodSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const action = process.argv[2] === 'uninstall' ? 'uninstall' : 'install';
const LABEL = 'com.chess-dna.seo-executor';
const HOME = homedir();
const PLIST_PATH = `${HOME}/Library/LaunchAgents/${LABEL}.plist`;
const LOGS_DIR = `${HOME}/Library/Logs`;
const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = `${REPO_DIR}/scripts/seo-daemon.sh`;

function buildPlist() {
  // Reliability knobs:
  //   StartInterval=30        → fire every 30s while loaded
  //   RunAtLoad=true          → fire immediately on load (login, manual launchctl load)
  //   ProcessType=Interactive → exempt from macOS App Nap / energy-saver throttling
  //                             (Background process types get aggressively throttled on
  //                             battery; Interactive ones do not)
  //   LowPriorityIO=false     → don't let macOS deprioritise the disk IO from our gh /
  //                             node calls when other apps are busy
  //   ThrottleInterval=10     → if the wrapper exits in <10s (e.g. crashes early),
  //                             launchd waits 10s before re-firing instead of the
  //                             default 10min throttle that effectively pauses us
  //   AbandonProcessGroup=true → if the wrapper spawns long-running children (Claude
  //                              Code can run for minutes), don't kill them when the
  //                              parent shell exits
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SCRIPT}</string>
  </array>
  <key>StartInterval</key>
  <integer>30</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>LowPriorityIO</key>
  <false/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>AbandonProcessGroup</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOGS_DIR}/seo-executor.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOGS_DIR}/seo-executor.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;
}

function tryUnload() {
  try {
    execSync(`launchctl unload ${PLIST_PATH}`, { stdio: 'ignore' });
  } catch {
    // not loaded — fine
  }
}

if (action === 'uninstall') {
  console.log(`[seo-daemon] Stopping and removing ${LABEL}…`);
  tryUnload();
  if (existsSync(PLIST_PATH)) unlinkSync(PLIST_PATH);
  console.log(`[seo-daemon] Done. The /seo dashboard's "Approve" button no longer triggers anything until you re-install with \`npm run seo:install-daemon\`.`);
  process.exit(0);
}

console.log(`[seo-daemon] Installing ${LABEL}…`);
console.log(`[seo-daemon]   wrapper: ${SCRIPT}`);
console.log(`[seo-daemon]   plist:   ${PLIST_PATH}`);
console.log(`[seo-daemon]   logs:    ${LOGS_DIR}/seo-executor.{out,err}.log`);

if (!existsSync(SCRIPT)) {
  console.error(`[seo-daemon] FATAL: wrapper script missing at ${SCRIPT}`);
  process.exit(1);
}
chmodSync(SCRIPT, 0o755);

mkdirSync(`${HOME}/Library/LaunchAgents`, { recursive: true });
mkdirSync(LOGS_DIR, { recursive: true });

tryUnload();
writeFileSync(PLIST_PATH, buildPlist());
execSync(`launchctl load ${PLIST_PATH}`);

console.log(`[seo-daemon] Installed. The daemon will:
  - Run every 30 seconds while you're logged in to macOS.
  - Skip silently if no GitHub issue has the \`seo-approved\` label.
  - When it sees one, run Claude Code on the unchecked tasks
    (code edits + Chrome MCP for browser tasks), check off the
    boxes, commit & push, and close the issue when all done.

Tail logs:
  tail -f ${LOGS_DIR}/seo-executor.out.log

Stop it:
  npm run seo:uninstall-daemon
`);

// Sanity check: is GH_TOKEN obtainable?
try {
  execSync('gh auth token', { stdio: 'ignore' });
} catch {
  console.warn(`[seo-daemon] ⚠️ \`gh auth token\` failed. The daemon needs gh CLI to be authenticated.
  Run: gh auth login`);
}
