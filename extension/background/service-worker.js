// Service worker — runs in the background while Chrome is open.
//
// Responsibilities:
//   • Poll the chess-dna-web repo's latest "reddit-daily" issue every 10
//     minutes to pull approved drafts (those marked 📋 opened but not yet
//     ✅ posted).
//   • Refresh advocate karma every hour and push it to the dashboard
//     (writes to chrome.storage so the popup can show it).
//   • Detect new replies to the advocate's recent comments and surface
//     them as desktop notifications.
//
// All GitHub API calls use the PAT the user pastes into the popup, stored
// in chrome.storage.local under key `ghPat`. Reddit endpoints used here
// are all unauthenticated public JSON — no Reddit OAuth needed.

const GH_REPO = 'yuvalinc/chess-dna-web';
const ADVOCATE = 'Inside-Essay-617';

const POLL_DRAFTS_INTERVAL_MIN = 10;
const POLL_KARMA_INTERVAL_MIN  = 60;
const POLL_REPLIES_INTERVAL_MIN = 15;

const STORAGE = chrome.storage.local;

// ─── Bootstrapping ──────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create('poll-drafts',  { periodInMinutes: POLL_DRAFTS_INTERVAL_MIN });
  chrome.alarms.create('poll-karma',   { periodInMinutes: POLL_KARMA_INTERVAL_MIN });
  chrome.alarms.create('poll-replies', { periodInMinutes: POLL_REPLIES_INTERVAL_MIN });
  // Clicking the toolbar icon should open the persistent side panel
  // alongside the current tab (not a transient popup that closes when
  // the user clicks back into the page).
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    console.warn('[chess-dna] side panel API unavailable, fallback to popup', e);
  }
  // Run all three once at install.
  pollDrafts();
  pollKarma();
  pollReplies();
});

// On every startup (browser restart, not just install) re-apply the side
// panel behavior in case Chrome forgot it.
chrome.runtime.onStartup.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {}
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'poll-drafts')  pollDrafts();
  if (alarm.name === 'poll-karma')   pollKarma();
  if (alarm.name === 'poll-replies') pollReplies();
});

// ─── Drafts queue ───────────────────────────────────────────────────────────
async function pollDrafts() {
  const { ghPat } = await STORAGE.get(['ghPat']);
  if (!ghPat) return;
  try {
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}/issues?labels=reddit-daily&state=open&per_page=1`, {
      headers: { Authorization: `Bearer ${ghPat}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return;
    const [issue] = await res.json();
    if (!issue) return;
    const commentsRes = await fetch(`https://api.github.com/repos/${GH_REPO}/issues/${issue.number}/comments?per_page=100`, {
      headers: { Authorization: `Bearer ${ghPat}`, Accept: 'application/vnd.github+json' },
    });
    const comments = commentsRes.ok ? await commentsRes.json() : [];
    const drafts = parseDrafts(issue.body || '', comments);
    await STORAGE.set({ activeDrafts: drafts, activeIssueNumber: issue.number });
    chrome.action.setBadgeText({ text: drafts.queued > 0 ? String(drafts.queued) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#3a9d52' });
  } catch (e) { console.warn('[chess-dna] pollDrafts failed', e); }
}

function parseDrafts(body, comments) {
  // Find all draft blocks delimited by `### [r/sub] title  <!-- draft-N -->`
  // and pair each with its action state (📋 opened / ✅ posted / 🗑 skipped).
  const out = [];
  const draftsSection = body.split(/^##\s+Drafts\s*$/m)[1] ?? '';
  const blocks = draftsSection.split(/^---\s*$/m);
  for (const block of blocks) {
    const header = block.match(/^###\s+\[r\/([^\]]+)\]\s+(.+?)\s*<!--\s*(draft-\d+)\s*-->/m);
    if (!header) continue;
    const [, sub, title, id] = header;
    const typeM  = block.match(/\*\*Type\*\*:\s*(warmup|promotional|brand_monitor)/);
    const urlM   = block.match(/\*\*URL\*\*:\s*(\S+)/);
    const draftM = block.match(/\*\*AI draft\*\*:\s*\n```\s*\n([\s\S]+?)\n```/);
    out.push({
      id, sub, title: title.trim(),
      type: typeM?.[1] ?? 'warmup',
      url: urlM?.[1] ?? '',
      draft: draftM?.[1]?.trim() ?? '',
    });
  }
  // Tag with current action state.
  const stateByTitle = new Map();
  for (const c of comments) {
    const body = c.body || '';
    const t = body.match(/\*\*([^*]+?)\*\*/)?.[1]?.trim();
    if (!t) continue;
    if (body.startsWith('✅')) stateByTitle.set(t, 'posted');
    else if (body.startsWith('🗑')) stateByTitle.set(t, 'skipped');
    else if (body.startsWith('📋')) stateByTitle.set(t, 'opened');
  }
  const tagged = out.map(d => ({ ...d, state: stateByTitle.get(d.title) ?? 'pending' }));
  const queued = tagged.filter(d => d.state === 'opened').length;
  return { all: tagged, queued };
}

// ─── Karma sync ─────────────────────────────────────────────────────────────
async function pollKarma() {
  try {
    const res = await fetch(`https://www.reddit.com/user/${ADVOCATE}/about.json`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return;
    const json = await res.json();
    const data = json?.data;
    if (!data) return;
    await STORAGE.set({
      karma: {
        total: data.total_karma,
        link: data.link_karma,
        comment: data.comment_karma,
        createdUtc: data.created_utc,
        fetchedAt: Date.now(),
      },
    });
  } catch (e) { console.warn('[chess-dna] pollKarma failed', e); }
}

// ─── Reply detection ────────────────────────────────────────────────────────
async function pollReplies() {
  try {
    const res = await fetch(`https://www.reddit.com/user/${ADVOCATE}/comments.json?limit=25`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return;
    const json = await res.json();
    const children = json?.data?.children ?? [];
    const myCommentIds = children.map(c => c.data?.name).filter(Boolean);

    const { seenReplies = [] } = await STORAGE.get(['seenReplies']);
    const seen = new Set(seenReplies);
    const newReplies = [];

    // For each of my recent comments, fetch its thread and look for direct
    // replies to that comment that we haven't surfaced yet.
    for (const comment of children) {
      const permalink = comment.data?.permalink;
      if (!permalink) continue;
      const threadRes = await fetch(`https://www.reddit.com${permalink}.json?limit=50`, {
        headers: { Accept: 'application/json' },
      });
      if (!threadRes.ok) continue;
      const thread = await threadRes.json();
      // The comment's children = replies to it. Walk one level.
      const myName = comment.data?.name;
      const replies = thread?.[1]?.data?.children ?? [];
      for (const r of replies) {
        const rd = r.data;
        if (!rd || rd.author === ADVOCATE) continue;
        if (rd.parent_id !== myName) continue;
        if (seen.has(rd.name)) continue;
        newReplies.push({
          replyId: rd.name,
          author: rd.author,
          body: (rd.body || '').slice(0, 160),
          permalink: `https://www.reddit.com${rd.permalink}`,
          createdUtc: rd.created_utc,
          parentCommentTitle: comment.data?.link_title,
        });
        seen.add(rd.name);
      }
      // Be polite — small inter-request delay.
      await new Promise(res => setTimeout(res, 400));
    }

    if (newReplies.length > 0) {
      await STORAGE.set({ seenReplies: [...seen], pendingReplies: newReplies });
      for (const r of newReplies.slice(0, 3)) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon-128.png',
          title: `New reply from u/${r.author}`,
          message: r.body,
          priority: 1,
        });
      }
    } else {
      await STORAGE.set({ seenReplies: [...seen] });
    }
  } catch (e) { console.warn('[chess-dna] pollReplies failed', e); }
}

// ─── Message routing ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'refresh') {
    pollDrafts(); pollKarma(); pollReplies();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'get-draft-for-thread') {
    // Content script calls this when it lands on a thread page. We respond
    // with the matching draft (if any) so the script can offer to fill it in.
    STORAGE.get(['activeDrafts']).then(({ activeDrafts }) => {
      const drafts = activeDrafts?.all ?? [];
      const match = drafts.find(d =>
        msg.url?.includes(d.url.replace(/^https?:\/\/[^/]+/, ''))
        || msg.url?.endsWith(d.url.split('/').slice(-2).join('/')),
      );
      sendResponse({ draft: match || null });
    });
    return true; // keep the message channel open for async sendResponse
  }
  if (msg.type === 'mark-posted') {
    markPosted(msg.title);
    sendResponse({ ok: true });
    return false;
  }
});

async function markPosted(title) {
  const { ghPat, activeIssueNumber } = await STORAGE.get(['ghPat', 'activeIssueNumber']);
  if (!ghPat || !activeIssueNumber) return;
  await fetch(`https://api.github.com/repos/${GH_REPO}/issues/${activeIssueNumber}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ghPat}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body: `✅ **${title}** — marked posted by extension` }),
  });
  // Refresh queue so badge clears.
  pollDrafts();
}
