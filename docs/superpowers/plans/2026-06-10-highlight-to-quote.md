# Highlight-to-Quote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user highlight text on any web page, click a floating "+ Quote" button, and submit the selection (plus optional author/source/date) as a quote to their quotes server via an in-page overlay form.

**Architecture:** A content script (`content.js`) injected on all pages renders a floating button on text selection and a Shadow-DOM overlay form. Submitting sends the quote to a background service worker (`background.js`), which performs the cross-origin POST to `{serverUrl}/api/quotes` (avoiding mixed-content blocking). `manifest.json` registers both. No new permissions.

**Tech Stack:** Vanilla JS, Chrome Extension Manifest V3 (content scripts, service worker, `chrome.storage.local`, `chrome.runtime` messaging), Shadow DOM.

**Verification:** This extension has no automated test framework. Each task is verified by loading the unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked → select the `extension/` dir) and following the concrete steps given. Start the quotes server first (`http://localhost:3030`).

---

## File Structure

- **Create** `extension/background.js` — service worker; receives `add-quote` messages, reads `serverUrl` from storage, POSTs to the server.
- **Create** `extension/content.js` — content script; selection → floating button → Shadow-DOM overlay form → sends quote to the worker.
- **Modify** `extension/manifest.json` — register `content_scripts` and `background.service_worker`.

The overlay's CSS lives inline inside `content.js` (injected into the Shadow root) so it is fully encapsulated and travels with the script — no separate CSS file to wire up.

---

## Task 1: Background service worker — POST a quote to the server

**Files:**
- Create: `extension/background.js`
- Modify: `extension/manifest.json`

- [ ] **Step 1: Create the service worker**

Create `extension/background.js`:

```js
// Service worker for the Quotes Admin extension.
// Performs the cross-origin POST so the in-page content script doesn't have to:
// a content script posting to http://localhost from an https page is blocked as
// mixed content, but the worker (with host_permissions) is not.
'use strict';

const DEFAULT_URL = 'http://localhost:3030';

function normalizeUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '');
}

function loadServerUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ serverUrl: DEFAULT_URL }, (data) => {
      resolve(data.serverUrl || DEFAULT_URL);
    });
  });
}

async function addQuote(quote) {
  const base = `${normalizeUrl(await loadServerUrl())}/api/quotes`;
  const r = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quote),
  });
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  return r.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'add-quote') {
    addQuote(msg.quote)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true; // keep the message channel open for the async response
  }
  return false;
});
```

- [ ] **Step 2: Register the worker in the manifest**

In `extension/manifest.json`, add a top-level `background` key after the `"permissions"`/`"host_permissions"` block. The file currently ends:

```json
  "permissions": ["storage"],
  "host_permissions": ["http://*/*", "https://*/*"]
}
```

Change it to:

```json
  "permissions": ["storage"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "background": {
    "service_worker": "background.js"
  }
}
```

- [ ] **Step 3: Verify the worker loads with no errors**

1. Start the quotes server (`http://localhost:3030`).
2. Go to `chrome://extensions`, enable Developer mode, Load unpacked → select the `extension/` directory (or click the reload icon if already loaded).
3. On the extension card, click **service worker** (the "Inspect views" link) to open its DevTools.
4. In that DevTools **Console**, paste and run:

```js
chrome.runtime.sendMessage({ type: 'add-quote', quote: { text: 'SW smoke test' } }, console.log);
```

Expected: logs `{ok: true}`. Confirm the quote appears in the server (open the popup's Manage tab, or the site). Then delete that test quote from the popup so it doesn't linger.

If the server is stopped and you re-run the snippet, expected: `{ok: false, error: "..."}` (no thrown uncaught error in the console).

- [ ] **Step 4: Commit**

```bash
git add extension/background.js extension/manifest.json
git commit -m "feat(extension): add service worker to POST quotes"
```

---

## Task 2: Content script — floating button on text selection

**Files:**
- Create: `extension/content.js`
- Modify: `extension/manifest.json`

This task adds only the floating button (no form yet) so the selection/positioning logic can be verified in isolation.

- [ ] **Step 1: Create the content script with the floating button**

Create `extension/content.js`:

```js
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
  `;
  shadow.appendChild(style);

  const btn = document.createElement('button');
  btn.className = 'qx-btn';
  btn.textContent = '+ Quote';
  btn.hidden = true;
  shadow.appendChild(btn);

  document.documentElement.appendChild(host);

  let savedText = '';

  // Current non-empty selection text, or '' if none.
  function selectionText() {
    const sel = window.getSelection();
    return sel && !sel.isCollapsed ? sel.toString().trim() : '';
  }

  function showButtonForSelection() {
    const text = selectionText();
    if (!text) { btn.hidden = true; return; }
    const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) { btn.hidden = true; return; }
    savedText = text;
    // Position just below the end of the selection, in page (document) coords.
    btn.style.top = `${rect.bottom + window.scrollY + 6}px`;
    btn.style.left = `${rect.left + window.scrollX}px`;
    btn.hidden = false;
  }

  document.addEventListener('mouseup', () => {
    // Defer so the selection is finalized before we read it.
    setTimeout(showButtonForSelection, 0);
  });

  // Hide when the selection is cleared (e.g. a plain click elsewhere).
  document.addEventListener('selectionchange', () => {
    if (!selectionText()) btn.hidden = true;
  });

  btn.addEventListener('mousedown', (e) => {
    // Prevent this click from clearing the page selection.
    e.preventDefault();
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    // Form wiring added in a later task.
    console.log('[quotes-ext] + Quote clicked, text:', savedText);
  });
})();
```

- [ ] **Step 2: Register the content script in the manifest**

In `extension/manifest.json`, add a `content_scripts` array. After the previous task the file ends:

```json
  "host_permissions": ["http://*/*", "https://*/*"],
  "background": {
    "service_worker": "background.js"
  }
}
```

Change it to:

```json
  "host_permissions": ["http://*/*", "https://*/*"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 3: Verify the button appears and positions correctly**

1. Reload the extension at `chrome://extensions`.
2. Open any normal web page (e.g. a Wikipedia article) and **reload it** so the content script injects.
3. Select a sentence with the mouse. Expected: a black **"+ Quote"** button appears just below-left of the selection.
4. Click empty space to clear the selection. Expected: the button disappears.
5. Open the page DevTools Console, select text, click the button. Expected: a log line `[quotes-ext] + Quote clicked, text: <your selection>`. The page selection should NOT be cleared by the click (the `mousedown` preventDefault).

- [ ] **Step 4: Commit**

```bash
git add extension/content.js extension/manifest.json
git commit -m "feat(extension): show floating + Quote button on text selection"
```

---

## Task 3: Content script — overlay form and submit

**Files:**
- Modify: `extension/content.js`

This task replaces the button's placeholder click handler with a real Shadow-DOM overlay form, and submits via the background worker.

- [ ] **Step 1: Add form styles to the injected stylesheet**

In `extension/content.js`, find the `style.textContent` template (it currently ends after the `.qx-btn:hover` rule) and append these rules **before** the closing backtick:

```css
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
```

- [ ] **Step 2: Add helper functions near the top of the IIFE**

In `extension/content.js`, immediately after the line `let savedText = '';`, add:

```js
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
    btn.hidden = true;

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
```

- [ ] **Step 3: Wire the button to open the form**

In `extension/content.js`, replace the placeholder button click handler:

```js
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    // Form wiring added in a later task.
    console.log('[quotes-ext] + Quote clicked, text:', savedText);
  });
```

with:

```js
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    openForm(savedText);
  });
```

- [ ] **Step 4: Verify the full flow end-to-end**

1. Ensure the quotes server is running at `http://localhost:3030`.
2. Reload the extension at `chrome://extensions`, then reload a test web page.
3. Select text → click **"+ Quote"**. Expected: a centered overlay form appears, Quote pre-filled with the selection, **Source** pre-filled with the page title, **Date added** pre-filled with today, Author blank.
4. Click **Add quote**. Expected: notice "Quote added." then the overlay closes (~0.8s).
5. Open the extension popup → **Manage** tab. Expected: the new quote is listed with the page title as its source.
6. Edit the Author field, repeat — confirm author is saved.
7. Press **Escape** while the form is open, and separately click the dimmed backdrop. Expected: form closes without saving in both cases.
8. Stop the server, try to add a quote. Expected: red notice "Could not save — ..." and the form stays open. Restart the server afterward.
9. Delete any leftover test quotes from the popup.

- [ ] **Step 5: Commit**

```bash
git add extension/content.js
git commit -m "feat(extension): in-page overlay form to add highlighted text as a quote"
```

---

## Verification (whole feature)

- Floating button appears only on a non-empty selection and is positioned near it.
- Overlay form pre-fills Quote (selection), Source (page title), Date added (today); Author blank.
- Only non-empty optional fields are sent (matches `popup.js` behavior).
- Submit POSTs through the service worker to the saved `serverUrl` and the quote shows up in Manage.
- Escape / backdrop / Cancel close without saving; server-down shows an error and keeps the form open.
- No new permissions were added to `manifest.json`.
