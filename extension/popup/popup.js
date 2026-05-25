// Popup script — reads from chrome.storage.local and renders the cached
// values the service worker has been keeping warm. Also lets the user
// paste their GitHub PAT (one-time setup) and trigger a manual refresh.

const STORAGE = chrome.storage.local;

const $ = (id) => document.getElementById(id);

async function render() {
  const { ghPat, karma, activeDrafts, pendingReplies } = await STORAGE.get([
    'ghPat', 'karma', 'activeDrafts', 'pendingReplies',
  ]);

  // PAT setup card visibility.
  $('pat-block').style.display = ghPat ? 'none' : 'block';

  // Karma section.
  if (karma) {
    $('karma-total').textContent = (karma.total ?? 0).toLocaleString();
    $('karma-split').textContent = `${(karma.link ?? 0).toLocaleString()} · ${(karma.comment ?? 0).toLocaleString()}`;
    const days = karma.createdUtc ? Math.floor((Date.now() / 1000 - karma.createdUtc) / 86400) : 0;
    $('account-age').textContent = `${days}d`;
  }

  // Drafts queue.
  if (activeDrafts) {
    const all = activeDrafts.all ?? [];
    $('drafts-total').textContent = String(all.length);
    $('drafts-pending').textContent = String(all.filter(d => d.state === 'pending' || d.state === 'opened').length);
    $('drafts-posted').textContent = String(all.filter(d => d.state === 'posted').length);
  } else {
    $('drafts-total').textContent = '0';
    $('drafts-pending').textContent = '0';
    $('drafts-posted').textContent = '0';
  }

  // Replies — render up to 5 most recent.
  const repliesList = $('replies-list');
  if (pendingReplies && pendingReplies.length > 0) {
    repliesList.innerHTML = pendingReplies.slice(0, 5).map(r => `
      <div class="reply-card">
        <div class="reply-author">u/${escapeHtml(r.author)}</div>
        <div class="reply-body">${escapeHtml(r.body)}</div>
        <a href="${r.permalink}" target="_blank" rel="noreferrer">View thread →</a>
      </div>
    `).join('');
  } else {
    repliesList.innerHTML = `<div class="empty">No new replies — the worker polls every 15 min</div>`;
  }
}

$('pat-save').addEventListener('click', async () => {
  const value = $('pat-input').value.trim();
  if (!value) return;
  await STORAGE.set({ ghPat: value });
  $('pat-input').value = '';
  // Tell worker to refresh now that we have a PAT.
  chrome.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
  render();
});

$('refresh-btn').addEventListener('click', async () => {
  $('refresh-btn').textContent = 'Refreshing…';
  // Trigger all three polls via the worker.
  chrome.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
  // Give the worker a moment then re-render.
  setTimeout(() => {
    $('refresh-btn').textContent = 'Refresh now';
    render();
  }, 1500);
});

function escapeHtml(s) {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

render();
