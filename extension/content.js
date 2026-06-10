// Content script: select text on any page -> a floating "+ Quote" button
// appears near the selection. Clicking it (wired up in a later task) opens an
// in-page form. All UI lives in a Shadow DOM so page styles can't interfere.
(() => {
  'use strict';

  // --- Shadow host that holds all our injected UI ---
  const host = document.createElement('div');
  host.id = 'quotes-ext-host';
  host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .qx-btn {
      position: absolute;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      font: 600 12px/1 -apple-system, system-ui, sans-serif;
      color: #fff;
      background: #1a1a1a;
      border: none;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,.25);
      cursor: pointer;
      white-space: nowrap;
    }
    .qx-btn:hover { background: #000; }
    .qx-overlay {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 10vh;
      background: rgba(0,0,0,.35);
    }
    .qx-card {
      width: 360px;
      max-width: 92vw;
      box-sizing: border-box;
      padding: 16px;
      font: 14px/1.4 -apple-system, system-ui, sans-serif;
      color: #1a1a1a;
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 12px 40px rgba(0,0,0,.3);
    }
    .qx-card h2 { margin: 0 0 12px; font-size: 15px; }
    .qx-field { display: block; margin-bottom: 10px; }
    .qx-field span { display: block; margin-bottom: 4px; font-size: 12px; color: #555; }
    .qx-field textarea, .qx-field input {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 8px;
      font: inherit;
      border: 1px solid #ccc;
      border-radius: 6px;
    }
    .qx-actions { display: flex; gap: 8px; margin-top: 4px; }
    .qx-actions button {
      padding: 7px 12px;
      font: 600 13px/1 inherit;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    .qx-primary { color: #fff; background: #1a1a1a; }
    .qx-primary:hover { background: #000; }
    .qx-primary:disabled { opacity: .6; cursor: default; }
    .qx-ghost { background: #eee; color: #1a1a1a; }
    .qx-notice { margin: 8px 0 0; font-size: 12px; color: #137333; }
    .qx-notice.qx-error { color: #c5221f; }
  `;
  shadow.appendChild(style);

  const btn = document.createElement('button');
  btn.className = 'qx-btn';
  btn.textContent = '+ Quote';
  shadow.appendChild(btn);

  document.documentElement.appendChild(host);

  // Hide the button by parking it at the top-left and making it invisible.
  // We can't rely on the `hidden` attribute because `.qx-btn { display: ... }`
  // overrides its default `display: none`. visibility:hidden also disables
  // pointer events, so a parked button can't be clicked. Starts hidden.
  function hideButton() {
    btn.style.visibility = 'hidden';
    btn.style.top = '0';
    btn.style.left = '0';
  }
  function showButtonAt(top, left) {
    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;
    btn.style.visibility = 'visible';
  }
  hideButton();

  let savedText = '';

  function todayISO() {
    const d = new Date();
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }

  let overlay = null; // the open overlay element, or null

  function closeOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function openForm(text) {
    closeOverlay();
    hideButton();

    overlay = document.createElement('div');
    overlay.className = 'qx-overlay';
    overlay.innerHTML = `
      <form class="qx-card">
        <h2>Add quote</h2>
        <label class="qx-field">
          <span>Quote (required)</span>
          <textarea name="text" rows="3" required>${esc(text)}</textarea>
        </label>
        <label class="qx-field">
          <span>Author (optional)</span>
          <input type="text" name="author" placeholder="e.g. Marcus Aurelius">
        </label>
        <label class="qx-field">
          <span>Source (optional)</span>
          <input type="text" name="source">
        </label>
        <label class="qx-field">
          <span>Date added (optional)</span>
          <input type="date" name="dateAdded">
        </label>
        <div class="qx-actions">
          <button type="submit" class="qx-primary">Add quote</button>
          <button type="button" class="qx-ghost" data-act="cancel">Cancel</button>
        </div>
        <p class="qx-notice" hidden></p>
      </form>`;

    const form = overlay.querySelector('form');
    form.elements.source.value = document.title || '';
    form.elements.dateAdded.value = todayISO();

    const notice = overlay.querySelector('.qx-notice');
    function showNotice(message, isError) {
      notice.textContent = message;
      notice.className = isError ? 'qx-notice qx-error' : 'qx-notice';
      notice.hidden = false;
    }

    // Clicking the dimmed backdrop (outside the card) cancels.
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeOverlay(); });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', closeOverlay);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const quoteText = data.get('text').trim();
      if (!quoteText) return;

      const quote = { text: quoteText };
      const author = data.get('author').trim();
      const source = data.get('source').trim();
      const dateAdded = data.get('dateAdded');
      if (author) quote.author = author;
      if (source) quote.source = source;
      if (dateAdded) quote.dateAdded = dateAdded;

      const submit = form.querySelector('.qx-primary');
      submit.disabled = true;
      chrome.runtime.sendMessage({ type: 'add-quote', quote }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) {
          const err = (res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'unknown error';
          showNotice(`Could not save — ${err}`, true);
          submit.disabled = false;
          return;
        }
        showNotice('Quote added.', false);
        setTimeout(closeOverlay, 800);
      });
    });

    shadow.appendChild(overlay);
    form.elements.text.focus();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeOverlay();
  });

  // The right-click "Add as quote" menu (handled in background.js) asks us to
  // open the in-page form prefilled with the selected text.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'open-quote-form') {
      openForm((msg.text || '').trim());
    }
  });

  // Current non-empty selection text, or '' if none.
  function selectionText() {
    const sel = window.getSelection();
    return sel && !sel.isCollapsed ? sel.toString().trim() : '';
  }

  function showButtonForSelection() {
    const text = selectionText();
    if (!text) { hideButton(); return; }
    const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) { hideButton(); return; }
    savedText = text;
    // Position just below the end of the selection, in page (document) coords.
    showButtonAt(rect.bottom + window.scrollY + 6, rect.left + window.scrollX);
  }

  document.addEventListener('mouseup', () => {
    // Defer so the selection is finalized before we read it.
    setTimeout(showButtonForSelection, 0);
  });

  // Hide when the selection is cleared (covers keyboard deselect, programmatic
  // clears, and clicking away in browsers that fire selectionchange promptly).
  document.addEventListener('selectionchange', () => {
    if (!selectionText()) hideButton();
  });

  // Belt-and-suspenders: hide immediately on any pointer-down outside our own
  // button. A click that collapses the selection should make the button vanish
  // right away, without waiting on selectionchange. mouseup then re-shows it if
  // the gesture produced a new selection. composedPath() sees into the shadow
  // DOM, so clicks on the button itself (which open the form) are excluded.
  document.addEventListener('mousedown', (e) => {
    if (!e.composedPath().includes(host)) hideButton();
  }, true);

  btn.addEventListener('mousedown', (e) => {
    // Prevent this click from clearing the page selection.
    e.preventDefault();
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    openForm(savedText);
  });
})();
