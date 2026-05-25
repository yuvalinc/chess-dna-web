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
  pollDrafts(); pollKarma(); pollReplies();
});

// Service workers in MV3 idle out after ~30s and restart on the next event.
// Fire pollDrafts at the top level so a reload-via-chrome://extensions/
// (which doesn't fire onInstalled) still produces a fresh sync.
pollDrafts();
pollKarma();

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'poll-drafts')  pollDrafts();
  if (alarm.name === 'poll-karma')   pollKarma();
  if (alarm.name === 'poll-replies') pollReplies();
});

// Strip whitespace/newlines from the PAT. The most common cause of
// "Failed to execute 'fetch' on 'WorkerGlobalScope'" is a trailing \n or \r
// in the Authorization header — the Headers constructor rejects any value
// containing a control character and throws a TypeError before the network
// request is even sent.
function cleanPat(raw) {
  return (raw || '').replace(/[\r\n\t\s]+/g, '');
}

// ─── Drafts queue ───────────────────────────────────────────────────────────
async function pollDrafts() {
  console.log('[chess-dna] pollDrafts starting…');
  const { ghPat: rawPat } = await STORAGE.get(['ghPat']);
  const ghPat = cleanPat(rawPat);
  if (!ghPat) {
    await STORAGE.set({ lastSyncError: 'No GitHub PAT saved. Connect GitHub first.' });
    console.warn('[chess-dna] pollDrafts: no PAT');
    return;
  }
  // Diagnostic: log shape (not value) of the PAT so we can verify it's well-formed.
  console.log('[chess-dna] PAT:', ghPat.length, 'chars, starts with', ghPat.slice(0, 4), 'cleaned from', (rawPat || '').length);
  if (ghPat !== rawPat) {
    // The stored PAT had whitespace — save the cleaned version so future
    // reads don't need to clean again.
    await STORAGE.set({ ghPat });
  }
  try {
    // state=all so drafts still surface even if a previous run was already
    // closed (after deploy). Sorted by created descending (default for issues).
    const url = `https://api.github.com/repos/${GH_REPO}/issues?labels=reddit-daily&state=all&per_page=5`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ghPat}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const err = `GitHub ${res.status}: ${txt.slice(0, 140)}`;
      console.warn('[chess-dna] pollDrafts:', err);
      await STORAGE.set({ lastSyncError: err });
      return;
    }
    const list = await res.json();
    const issue = list?.[0];
    if (!issue) {
      console.warn('[chess-dna] pollDrafts: no reddit-daily issues found');
      await STORAGE.set({
        activeDrafts: { all: [], queued: 0 },
        lastSyncError: 'No reddit-daily issues on github. Run npm run reddit:daily.',
        lastSyncAt: Date.now(),
      });
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    console.log('[chess-dna] pollDrafts: latest issue #' + issue.number);
    const commentsRes = await fetch(
      `https://api.github.com/repos/${GH_REPO}/issues/${issue.number}/comments?per_page=100`,
      { headers: { Authorization: `Bearer ${ghPat}`, Accept: 'application/vnd.github+json' } },
    );
    const comments = commentsRes.ok ? await commentsRes.json() : [];
    const drafts = parseDrafts(issue.body || '', comments);
    console.log('[chess-dna] pollDrafts: parsed', drafts.all.length, 'drafts,', drafts.queued, 'queued');
    await STORAGE.set({
      activeDrafts: drafts,
      activeIssueNumber: issue.number,
      lastSyncAt: Date.now(),
      lastSyncError: null,
    });
    chrome.action.setBadgeText({ text: drafts.queued > 0 ? String(drafts.queued) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#3a9d52' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[chess-dna] pollDrafts threw:', msg);
    await STORAGE.set({ lastSyncError: `Network error: ${msg}` });
  }
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
    // Match on Reddit's canonical post ID — the 6–8 char base36 segment in
    // /r/<sub>/comments/<POSTID>/.../ . It's stable across www/sh/old/new
    // subdomains, locale prefixes, query strings, and fragment hashes.
    STORAGE.get(['activeDrafts', 'ghPat']).then(({ activeDrafts, ghPat }) => {
      const drafts = activeDrafts?.all ?? [];
      const id = msg.postId || extractPostId(msg.url);
      const cachedDrafts = drafts.length;
      console.log('[chess-dna] get-draft-for-thread', { url: msg.url, postId: id, cachedDrafts, patSet: !!ghPat });
      if (!ghPat) {
        sendResponse({ draft: null, reason: 'no-pat', cachedDrafts: 0, patSet: false });
        return;
      }
      if (cachedDrafts === 0) {
        sendResponse({ draft: null, reason: 'no-drafts', cachedDrafts: 0, patSet: true });
        return;
      }
      if (!id) {
        sendResponse({ draft: null, reason: 'no-post-id', cachedDrafts, patSet: true });
        return;
      }
      const match = drafts.find(d => extractPostId(d.url) === id);
      sendResponse({
        draft: match || null,
        reason: match ? 'match' : 'no-match',
        postId: id,
        cachedDrafts,
        patSet: true,
      });
    });
    return true; // keep the message channel open for async sendResponse
  }
  if (msg.type === 'mark-posted') {
    markComment(msg.title, '✅', 'marked posted by extension');
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'mark-skipped') {
    markComment(msg.title, '🗑', 'skipped from extension');
    sendResponse({ ok: true });
    return false;
  }
});

// Pull /r/<sub>/comments/<POSTID>/... out of any Reddit URL variant.
function extractPostId(url) {
  if (!url) return null;
  const m = url.match(/\/comments\/([a-z0-9]+)(?:\/|$|\?|#)/i);
  return m?.[1] ?? null;
}

async function markComment(title, emoji, verb) {
  const { ghPat: rawPat, activeIssueNumber } = await STORAGE.get(['ghPat', 'activeIssueNumber']);
  const ghPat = cleanPat(rawPat);
  if (!ghPat || !activeIssueNumber) return;
  await fetch(`https://api.github.com/repos/${GH_REPO}/issues/${activeIssueNumber}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ghPat}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body: `${emoji} **${title}** — ${verb}` }),
  });
  // Refresh queue so badge clears and the list reflects the new state.
  pollDrafts();
}
