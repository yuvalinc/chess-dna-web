// Side panel script — renders the ReddGrow-style layout: header, ramping
// banner, posting-as row, queue/published stat cards, today's drafts list
// (each expandable to show full text + fill/copy/skip/mark-posted buttons),
// bottom action bar.

const STORAGE = chrome.storage.local;
const $ = (id) => document.getElementById(id);
const GH_REPO = 'yuvalinc/chess-dna-web';
const ADVOCATE = 'Inside-Essay-617';
const CAMPAIGN_START = '2026-05-25'; // keep in sync with scripts/reddit-daily.mjs

// ─── Ramping policy (mirrors reddit-daily.mjs computeRampingPolicy) ─────
function computePolicy() {
  const startMs = new Date(CAMPAIGN_START).getTime();
  const dayN = Math.max(1, Math.floor((Date.now() - startMs) / (24 * 3600 * 1000)) + 1);
  let cap, promoShare, phase;
  if (dayN <= 3)       { cap = 3;  promoShare = 0.00; phase = 'Browse-only ramp'; }
  else if (dayN <= 7)  { cap = 5;  promoShare = 0.20; phase = 'Soft posting'; }
  else if (dayN <= 14) { cap = 8;  promoShare = 0.30; phase = 'Ramping up'; }
  else                 { cap = 12; promoShare = 0.30; phase = 'Steady state'; }
  return { dayN, cap, promoShare, phase };
}

// ─── Render ─────────────────────────────────────────────────────────────
async function render() {
  const { ghPat, karma, activeDrafts, lastSyncAt, lastSyncError } = await STORAGE.get([
    'ghPat', 'karma', 'activeDrafts', 'lastSyncAt', 'lastSyncError',
  ]);

  // PAT setup
  $('pat-block').style.display = ghPat ? 'none' : 'block';

  // Ramping banner
  const policy = computePolicy();
  $('ramping').style.display = 'block';
  $('ramping-headline').textContent = policy.dayN <= 3
    ? `Browse only · ${Math.max(0, 7 - policy.dayN)} days left`
    : policy.dayN <= 14
      ? `Day ${policy.dayN} of 14 — ${policy.phase}`
      : 'Steady state · daily cap reached after 14d ramp';
  $('ramping-budget').textContent = ` · cap ${policy.cap}/day (${Math.round(policy.promoShare * 100)}% promo max)`;
  $('ramping-detail').textContent = policy.dayN <= 3
    ? `New campaign (day ${policy.dayN} of 14) — Warmup-only mode. Posting builds karma without promotional content for the first 3 days so Reddit's anti-spam classifier doesn't flag the account.`
    : policy.dayN <= 7
      ? `Posting started day 4. Promotional drafts are 1-in-5 max (the 9:1 ratio gate enforces this in real time).`
      : policy.dayN <= 14
        ? `Active ramp — daily cap rising. Maintain the 9:1 warmup-to-promo ratio across all your posts.`
        : `Full campaign. 12 drafts/day, ~30% promotional max, 9:1 ratio still enforced.`;

  // Posting as
  $('advocate-username').textContent = ADVOCATE;
  if (lastSyncError) {
    $('last-sync').innerHTML = `<span style="color: #c9580a;" title="${escapeHtml(lastSyncError)}">⚠ ${escapeHtml(lastSyncError.slice(0, 60))}${lastSyncError.length > 60 ? '…' : ''}</span>`;
  } else {
    $('last-sync').textContent = lastSyncAt
      ? `Last update: ${new Date(lastSyncAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })}`
      : 'Last update: —';
  }

  // Today's date in the section header
  $('today-date').textContent = '| ' + new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  // Stat cards + draft list
  const drafts = activeDrafts?.all ?? [];
  const pending = drafts.filter(d => d.state === 'pending' || d.state === 'opened');
  const posted = drafts.filter(d => d.state === 'posted');
  $('queue-value').textContent = String(pending.length);
  $('published-value').textContent = String(posted.length);
  $('published-cap').textContent = String(policy.cap);

  // Draft list
  const list = $('drafts-list');
  if (drafts.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">💬</div>
        <div class="empty-title">Queue is empty</div>
        <div class="empty-sub">${ghPat ? 'Run <code>npm run reddit:daily</code> to seed drafts.' : 'Connect GitHub above to load drafts.'}</div>
      </div>
    `;
    return;
  }
  list.innerHTML = drafts.map((d, idx) => renderDraftCard(d, idx)).join('');
  // Wire interactions
  list.querySelectorAll('.draft-card').forEach((card, idx) => {
    const draft = drafts[idx];
    card.querySelector('.draft-head').addEventListener('click', () => card.classList.toggle('expanded'));
    card.querySelector('.btn-open')?.addEventListener('click', e => { e.stopPropagation(); window.open(draft.url, '_blank'); });
    card.querySelector('.btn-copy')?.addEventListener('click', async e => {
      e.stopPropagation();
      await navigator.clipboard.writeText(draft.draft);
      const b = e.currentTarget;
      b.textContent = '✓ Copied';
      setTimeout(() => { b.textContent = 'Copy'; }, 1500);
    });
    card.querySelector('.btn-mark')?.addEventListener('click', async e => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'mark-posted', title: draft.title }, () => render());
    });
    card.querySelector('.btn-skip')?.addEventListener('click', async e => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'mark-skipped', title: draft.title }, () => render());
    });
    card.querySelector('.btn-remove')?.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Remove "${draft.title.slice(0, 80)}" from the queue? This hides it permanently.`)) return;
      chrome.runtime.sendMessage({ type: 'mark-removed', title: draft.title }, () => render());
    });
  });
}

function renderDraftCard(d, idx) {
  const stateCls = d.state || 'pending';
  const stateLabel = stateCls === 'posted' ? '✓ posted' : stateCls === 'skipped' ? 'skipped' : stateCls === 'opened' ? 'opened' : 'pending';
  return `
    <div class="draft-card ${stateCls === 'posted' ? 'posted' : ''} ${stateCls === 'skipped' ? 'skipped' : ''}">
      <div class="draft-head">
        <span class="draft-type ${d.type}">${d.type.replace('_', ' ')}</span>
        <span class="draft-sub">r/${d.sub}</span>
        <span class="draft-state ${stateCls}">${stateLabel}</span>
      </div>
      <div class="draft-title">${escapeHtml(d.title)}</div>
      <div class="draft-body">
        <div class="draft-text">${escapeHtml(d.draft)}</div>
        <div class="draft-actions">
          <button class="primary btn-open">Open thread</button>
          <button class="btn-copy">Copy</button>
          ${stateCls === 'posted' ? '' : '<button class="btn-mark">Mark posted</button>'}
          ${stateCls === 'skipped' ? '' : '<button class="btn-skip">Skip</button>'}
          ${stateCls === 'posted' ? '' : '<button class="btn-remove" title="Hide this draft from the queue permanently">✕ Remove</button>'}
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ─── Event handlers ─────────────────────────────────────────────────────
$('pat-save').addEventListener('click', async () => {
  // Aggressively strip all whitespace + control chars — paste from Terminal
  // or password managers often includes invisible \r or trailing newlines
  // that crash fetch() in the service worker with TypeError.
  const value = $('pat-input').value.replace(/[\r\n\t\s]+/g, '');
  if (!value) return;
  await STORAGE.set({ ghPat: value });
  $('pat-input').value = '';
  chrome.runtime.sendMessage({ type: 'refresh' }, () => render());
});

$('refresh-btn').addEventListener('click', () => {
  $('refresh-btn').textContent = '⏳ Syncing…';
  chrome.runtime.sendMessage({ type: 'refresh' }, () => {
    setTimeout(() => { $('refresh-btn').textContent = '🔄 Sync'; render(); }, 1200);
  });
});

$('open-dashboard-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://chess-dna-fdd5fbde.base44.app/seo?tab=reddit' });
});

$('logout-btn').addEventListener('click', async () => {
  if (!confirm('Clear stored PAT and cached data?')) return;
  await STORAGE.clear();
  render();
});

render();
// Re-render whenever storage updates (worker pushes new data).
chrome.storage.onChanged.addListener(() => render());
