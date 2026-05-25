// Injected on every Reddit comment thread page. Asks the background worker
// whether we have a matching AI draft for this thread; if so, offers a
// floating "Use Chess DNA draft" overlay above the comment composer.
//
// The script never auto-submits — it only fills the textarea + reveals a
// "Submit" path you click yourself. That keeps the extension out of "bot
// posting" territory and means the human still has final review.

(() => {
  if (window.__chessDnaInjected) return;
  window.__chessDnaInjected = true;

  // Ask the worker if we have a draft for this URL.
  chrome.runtime.sendMessage({ type: 'get-draft-for-thread', url: window.location.href }, (resp) => {
    if (!resp?.draft) return;
    injectOverlay(resp.draft);
  });

  function injectOverlay(draft) {
    const overlay = document.createElement('div');
    overlay.id = 'chess-dna-overlay';
    overlay.innerHTML = `
      <style>
        #chess-dna-overlay {
          position: fixed;
          bottom: 16px;
          right: 16px;
          z-index: 2147483646;
          width: 360px;
          background: #1a1d23;
          color: #e8e9ee;
          border: 1px solid #2c3038;
          border-radius: 10px;
          padding: 12px 14px;
          box-shadow: 0 10px 32px rgba(0,0,0,0.4);
          font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        #chess-dna-overlay .cdn-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        #chess-dna-overlay .cdn-title { font-weight: 700; font-size: 12px; }
        #chess-dna-overlay .cdn-type { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 4px; font-weight: 700; }
        #chess-dna-overlay .cdn-type.warmup { background: #133c20; color: #5ee387; }
        #chess-dna-overlay .cdn-type.promotional { background: #1e2a40; color: #6da8ff; }
        #chess-dna-overlay .cdn-type.brand_monitor { background: #3a2e10; color: #f5c46d; }
        #chess-dna-overlay .cdn-close { cursor: pointer; opacity: 0.5; font-size: 16px; line-height: 1; }
        #chess-dna-overlay .cdn-close:hover { opacity: 1; }
        #chess-dna-overlay .cdn-body { background: #0f1115; padding: 8px; border-radius: 6px; white-space: pre-wrap; margin-bottom: 8px; max-height: 160px; overflow-y: auto; }
        #chess-dna-overlay .cdn-actions { display: flex; gap: 6px; }
        #chess-dna-overlay button {
          flex: 1; padding: 6px 8px; border-radius: 5px; cursor: pointer; font-size: 12px; font-weight: 600;
          border: 1px solid #2c3038; background: #2c3038; color: #e8e9ee;
        }
        #chess-dna-overlay button.primary { background: #3a9d52; border-color: #3a9d52; color: white; }
        #chess-dna-overlay button:hover { filter: brightness(1.1); }
        #chess-dna-overlay button:disabled { opacity: 0.5; cursor: not-allowed; }
      </style>
      <div class="cdn-header">
        <div>
          <div class="cdn-title">Chess DNA draft ready</div>
          <span class="cdn-type ${draft.type}">${draft.type.replace('_', ' ')}</span>
        </div>
        <span class="cdn-close" title="Dismiss">×</span>
      </div>
      <div class="cdn-body">${escapeHtml(draft.draft)}</div>
      <div class="cdn-actions">
        <button class="cdn-fill primary">Fill comment box</button>
        <button class="cdn-copy">Copy</button>
        <button class="cdn-mark">Mark posted</button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.cdn-close').addEventListener('click', () => overlay.remove());

    overlay.querySelector('.cdn-fill').addEventListener('click', async () => {
      const ok = fillCommentBox(draft.draft);
      if (!ok) {
        // Fallback to clipboard if we couldn't find a textarea.
        await navigator.clipboard.writeText(draft.draft);
        alert('Comment box not found yet — copied to clipboard so you can paste manually.');
      }
    });

    overlay.querySelector('.cdn-copy').addEventListener('click', async () => {
      await navigator.clipboard.writeText(draft.draft);
      const b = overlay.querySelector('.cdn-copy');
      b.textContent = 'Copied!';
      setTimeout(() => { b.textContent = 'Copy'; }, 1500);
    });

    overlay.querySelector('.cdn-mark').addEventListener('click', async () => {
      chrome.runtime.sendMessage({ type: 'mark-posted', title: draft.title }, () => {
        overlay.remove();
      });
    });
  }

  // Reddit's comment composer is a contenteditable div (new Reddit) or a
  // <textarea> (old Reddit / mobile). Try both.
  function fillCommentBox(text) {
    // New Reddit: contenteditable div with [contenteditable="true"]
    const editable = document.querySelector('div[contenteditable="true"]');
    if (editable) {
      editable.focus();
      editable.textContent = text;
      editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      return true;
    }
    // Old Reddit: textarea inside .commentarea or under a "reply" link
    const ta = document.querySelector('textarea[name="text"]');
    if (ta) {
      ta.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    return false;
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
