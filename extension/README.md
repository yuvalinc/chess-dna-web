# Chess DNA — Reddit Co-pilot (Chrome extension)

Loads alongside the `/seo?tab=reddit` dashboard. Handles the parts the
browser dashboard can't do on its own:

- **One-click fill** — when you open a Reddit thread that has a matching
  AI draft, an overlay appears with "Fill comment box" / "Copy" /
  "Mark posted". The fill action writes directly into Reddit's comment
  editor (both new + old Reddit), so you skip the paste step entirely.
- **Karma sync** — pulls live karma from
  `https://www.reddit.com/user/Inside-Essay-617/about.json` every hour
  so the dashboard's Karma Journey reflects reality.
- **Reply detection** — every 15 min, walks the advocate's last 25
  comments and surfaces any new replies as native Chrome notifications,
  with a popup list of the most recent.
- **Draft queue badge** — the toolbar icon shows a count of approved
  drafts waiting to be posted (📋 opened, not yet ✅ posted).

The extension **never auto-submits a Reddit comment** — it only fills
the box. You always click the actual Submit button yourself. That keeps
the extension out of "bot posting" territory (which violates Reddit's
ToS) and means every comment gets human review.

## Install (unpacked)

1. Open `chrome://extensions/`
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**.
4. Select this `extension/` directory.
5. Pin the icon to your toolbar so the side panel is one click away.

**Clicking the toolbar icon opens a persistent side panel** (Chrome Side
Panel API) alongside whatever tab you're on. It stays open as you
navigate Reddit — no transient popup that closes on every click.

## Does it post or comment automatically?

**No.** The extension never submits a Reddit comment on its own. The
flow is:

1. **Daily scanner runs** (manually via `npm run reddit:daily`, or via
   the launchd daemon once you opt in). Generates ~12 AI drafts in a
   GH issue.
2. **Extension worker polls GH every 10 min**, caches the drafts +
   their action state, sets a badge count on the toolbar icon.
3. **You open a matching Reddit thread**. A floating overlay appears
   bottom-right with the draft preview + three buttons.
4. **You click "Fill comment box"** → the draft fills Reddit's reply
   textarea. You can edit it.
5. **You click Reddit's own Comment button** to submit. The extension
   does not touch Reddit's submit flow.
6. **You click "Mark posted"** in the overlay so the dashboard's 9:1
   ratio gate and Account Health update.

Karma sync and reply detection are read-only — they never post anything.

## First-time setup

1. Click the extension icon.
2. Paste your GitHub PAT into the "GitHub PAT" field and hit **Save**.
   It's stored in `chrome.storage.local` — never leaves your machine
   except for calls to `api.github.com`.
3. Within ~10 sec the popup shows karma, draft queue stats, and (if
   any) recent replies.

## Architecture

```
service-worker.js (background)
├─ alarms.pollDrafts   (10 min) ─ reads latest reddit-daily GH issue
├─ alarms.pollKarma    (60 min) ─ reads u/<advocate>/about.json
└─ alarms.pollReplies  (15 min) ─ walks /user/<advocate>/comments.json
       ↓
chrome.storage.local: { ghPat, karma, activeDrafts, pendingReplies, seenReplies }
       ↓
popup.html/.js (toolbar UI)        content/reddit-thread.js (on every thread)
   ─ shows cached values            ─ asks worker for matching draft
   ─ "Refresh now" button           ─ injects overlay with fill/copy/mark
```

## Permissions used

- `storage` — for the PAT, cached karma/drafts, dedupe set of seen reply IDs.
- `alarms` — the three periodic polls.
- `notifications` — Chrome desktop notifications when new replies appear.
- `host_permissions` — `reddit.com` (read karma + comments + thread JSON,
  inject the overlay) and `api.github.com` (read/write the daily issue's
  comments).

## Sources of truth

- **Drafts** live in GH issues labeled `reddit-daily` on
  `yuvalinc/chess-dna-web`. Posting state is comment-driven:
  `📋 opened` / `✅ posted` / `🗑 skipped`.
- **Karma** is pulled live from Reddit's unauthenticated JSON endpoints.
- **Replies** are deduped via `seenReplies` (set of reply `t1_…` IDs)
  so each reply only notifies once.

## Updating the extension

The popup currently doesn't auto-reload after a code change. When you
edit files here:
1. Run `chrome://extensions/`
2. Find the Chess DNA extension card.
3. Click the reload (↻) icon.
4. Reload any open Reddit tab.

## Future

- Multi-account support (advocate list pulled from a per-campaign config).
- Send-time scheduling (queue posts at staggered intervals to avoid spike flags).
- Auto-generate reply drafts when a new reply notification arrives.
- Optional Reddit OAuth so the extension can also fetch your own
  inbox (private messages, mentions outside comment trees).
