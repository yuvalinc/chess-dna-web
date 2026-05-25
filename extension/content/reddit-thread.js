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
      const fillBtn = overlay.querySelector('.cdn-fill');
      fillBtn.textContent = 'Filling…';
      const result = await fillCommentBox(draft.draft);
      if (result === 'filled') {
        fillBtn.textContent = '✓ Filled';
        setTimeout(() => { fillBtn.textContent = 'Fill comment box'; }, 2000);
      } else if (result === 'clipboard') {
        // We copied to clipboard but couldn't write into the editor.
        // Surface the keystroke the user needs to press themselves.
        fillBtn.textContent = 'Press Cmd+V';
        await navigator.clipboard.writeText(draft.draft);
        setTimeout(() => { fillBtn.textContent = 'Fill comment box'; }, 4000);
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

  // Reddit ships three distinct comment composers depending on URL + skin:
  //   • old.reddit.com   → plain <textarea name="text">
  //   • www.reddit.com   → Lexical-based contenteditable inside a normal DOM
  //   • sh.reddit.com    → web components (<shreddit-composer>) with shadow
  //                        DOM containing the Lexical editor
  // Plus the composer is often *collapsed* until the user clicks
  // "Add a comment" — we click it programmatically if so.
  //
  // For rich-text editors (Lexical / Draft / ProseMirror), assigning
  // textContent does NOT update the editor's internal model. The editor
  // ignores the DOM change and the Submit button posts an empty string.
  // The correct approach is `document.execCommand('insertText')` after
  // focusing — it fires the proper beforeinput/input events that React
  // editors listen for.
  async function fillCommentBox(text) {
    // 1. Make sure a composer is open. If the page only shows a collapsed
    //    "Add a comment" placeholder, click it first.
    await openComposerIfCollapsed();

    // 2. Look for an editor — walk shadow roots too since shreddit-composer
    //    encapsulates its Lexical editor in a shadow root.
    const editor = findEditor(document);
    if (!editor) {
      console.warn('[chess-dna] no comment editor found');
      return 'clipboard';
    }

    // 3. Plain textarea (old Reddit / mobile fallback) — native setter.
    if (editor.tagName === 'TEXTAREA') {
      editor.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(editor, text);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      return 'filled';
    }

    // 4. Rich editor (contenteditable). execCommand is the only way to
    //    cleanly insert text that Lexical/Draft will respect. Yes, it's
    //    deprecated — and yes, it still works in Chrome 2024+ specifically
    //    for content scripts. If it ever stops, we fall back to clipboard.
    editor.focus();
    // Move caret to end so insert appends instead of replacing selection.
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {}

    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch {}
    if (!ok) {
      // Last-ditch: dispatch a synthetic paste event with a DataTransfer
      // payload. Many editors handle paste even when execCommand fails.
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        editor.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true, cancelable: true, clipboardData: dt,
        }));
        ok = (editor.textContent || '').includes(text.slice(0, 20));
      } catch {}
    }
    if (!ok) {
      console.warn('[chess-dna] execCommand + paste both failed; fall back to clipboard');
      return 'clipboard';
    }
    return 'filled';
  }

  // Click "Add a comment" / reply UI if visible but not yet expanded into an
  // editable composer. Wait briefly for the editor to mount.
  async function openComposerIfCollapsed() {
    if (findEditor(document)) return; // already open
    const trigger =
      // sh.reddit.com — comment placeholder card
      document.querySelector('[name="rich-text-comment-cta"]') ||
      // new Reddit — "Add a comment" button or placeholder textarea
      document.querySelector('button[aria-label*="comment" i][aria-label*="add" i]') ||
      document.querySelector('[data-testid="comment-submission-form-richtext"] button') ||
      // anything that looks like a placeholder for the composer
      [...document.querySelectorAll('button, div[role="button"]')]
        .find(el => /add a comment|write a comment|join the conversation/i.test(el.textContent || ''));
    if (trigger) {
      trigger.click();
      // Lexical takes ~100–250ms to mount. Poll for up to 1.5s.
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (findEditor(document)) return;
      }
    }
  }

  // Recursively walk the DOM + open shadow roots looking for an editor.
  function findEditor(root) {
    if (!root) return null;
    // Plain textarea (old Reddit, mobile)
    const ta = root.querySelector?.('textarea[name="text"]');
    if (ta) return ta;
    // Rich editor candidates — try most specific first.
    const candidates = [
      'div[contenteditable="true"][role="textbox"][aria-label*="comment" i]',
      'div[contenteditable="true"][role="textbox"]',
      '[data-testid="comment-submission-form-richtext"] div[contenteditable="true"]',
      'div[contenteditable="true"]',
    ];
    for (const sel of candidates) {
      const el = root.querySelector?.(sel);
      if (el && isVisible(el)) return el;
    }
    // Walk open shadow roots — sh.reddit.com encapsulates the composer.
    const all = root.querySelectorAll?.('*') ?? [];
    for (const el of all) {
      if (el.shadowRoot) {
        const found = findEditor(el.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
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
