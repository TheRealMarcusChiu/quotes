// Chrome extension popup: same Add / Manage features as admin.html, plus a
// Settings tab to point the extension at any quotes server.
// Depends on search-index.js (buildIndex / searchQuotes) loaded beforehand.
(() => {
  'use strict';

  const OFFLINE = 'is the server running?';
  const DEFAULT_URL = 'http://localhost:3030';

  // Strip a trailing slash so we can append paths cleanly.
  function normalizeUrl(u) {
    return String(u || '').trim().replace(/\/+$/, '');
  }

  // ---------- REST client ----------
  // `base` is set once the stored server URL is loaded.
  const QuoteAPI = {
    base: '',
    setServer(url) {
      this.base = `${normalizeUrl(url)}/api/quotes`;
    },
    all() {
      return this._send(this.base, 'GET');
    },
    add(quote) {
      return this._send(this.base, 'POST', quote);
    },
    update(id, patch) {
      return this._send(`${this.base}/${encodeURIComponent(id)}`, 'PUT', patch);
    },
    remove(id) {
      return this._send(`${this.base}/${encodeURIComponent(id)}`, 'DELETE');
    },
    async _send(url, method, body) {
      const opts = { method };
      if (body !== undefined) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
      }
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      return r.json();
    },
  };

  // ---------- Settings storage ----------
  function loadServerUrl() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ serverUrl: DEFAULT_URL }, (data) => {
        resolve(data.serverUrl || DEFAULT_URL);
      });
    });
  }

  function saveServerUrl(url) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ serverUrl: url }, resolve);
    });
  }

  // ---------- Helpers ----------
  function todayISO() {
    const d = new Date();
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }

  // Read text + optional fields from a form; optional values are trimmed.
  function readQuote(formEl) {
    const data = new FormData(formEl);
    return {
      text: data.get('text').trim(),
      author: data.get('author').trim(),
      dateAdded: data.get('dateAdded'),
      source: data.get('source').trim(),
    };
  }

  // Read the highlighted text (and title) from the active tab. Returns
  // { text, title } with text='' when nothing is selected, or null on failure
  // (e.g. a restricted page like chrome:// where scripts can't be injected).
  async function getActiveTabSelection() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return null;
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const sel = window.getSelection();
          return {
            text: sel && !sel.isCollapsed ? sel.toString().trim() : '',
            title: document.title || '',
          };
        },
      });
      return res && res.result ? res.result : null;
    } catch (e) {
      return null; // injection blocked (restricted page) — fall back to empty form
    }
  }

  // ---------- Add form ----------
  const form = document.getElementById('add-form');
  const notice = document.getElementById('notice');
  const dateInput = form.elements.dateAdded;
  dateInput.value = todayISO();

  let noticeTimer;
  function showNotice(message, isError) {
    notice.textContent = message;
    notice.className = isError ? 'notice notice-error' : 'notice';
    notice.hidden = false;

    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.hidden = true;
    }, 3000);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = readQuote(form);
    if (!fields.text) return;

    // Only send optional fields when they have a value.
    const quote = { text: fields.text };
    if (fields.author) quote.author = fields.author;
    if (fields.dateAdded) quote.dateAdded = fields.dateAdded;
    if (fields.source) quote.source = fields.source;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await QuoteAPI.add(quote);
      form.reset();
      dateInput.value = todayISO();
      showNotice('Quote added.', false);
      form.querySelector('textarea').focus();
    } catch (err) {
      showNotice(`Could not save — ${OFFLINE}`, true);
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ---------- Manage list (CRUD) ----------
  const rowsEl = document.getElementById('rows');
  const searchInput = document.getElementById('search');
  const emptyMsg = document.getElementById('empty');
  const countEl = document.getElementById('count');

  let editingId = null; // id of the quote currently in edit mode, or null
  let cache = []; // last list fetched from the server

  async function refresh() {
    try {
      cache = await QuoteAPI.all();
    } catch (e) {
      rowsEl.replaceChildren();
      countEl.textContent = '';
      emptyMsg.textContent = `Could not load — ${OFFLINE}`;
      emptyMsg.hidden = false;
      return;
    }
    emptyMsg.textContent = 'No quotes match your search.';
    const filtered = searchQuotes(buildIndex(cache), cache, searchInput.value);
    render(filtered, cache.length);
  }

  function render(items, total) {
    countEl.textContent = searchInput.value.trim()
      ? `${items.length} of ${total} quotes`
      : `${total} quote${total === 1 ? '' : 's'}`;

    rowsEl.replaceChildren();
    items.forEach((q) => rowsEl.appendChild(q.id === editingId ? editRow(q) : viewRow(q)));
    emptyMsg.hidden = items.length > 0;
  }

  function viewRow(q) {
    const el = document.createElement('div');
    el.className = 'manage-row';

    const meta = [q.author, q.dateAdded, q.source].filter(Boolean).map(esc).join(' · ');
    el.innerHTML = `
      <div class="manage-body">
        <p class="manage-text">"${esc(q.text)}"</p>
        ${meta ? `<p class="manage-meta">${meta}</p>` : ''}
      </div>
      <div class="row-actions">
        <button class="btn btn-ghost" data-act="edit">Edit</button>
        <button class="btn btn-danger" data-act="delete">Delete</button>
      </div>`;

    el.querySelector('[data-act="edit"]').addEventListener('click', () => {
      editingId = q.id;
      refresh();
    });
    el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this quote?')) return;
      try {
        await QuoteAPI.remove(q.id);
      } catch (e) {
        alert(`Could not delete — ${OFFLINE}`);
        return;
      }
      refresh();
    });

    return el;
  }

  function editRow(q) {
    const el = document.createElement('form');
    el.className = 'manage-row manage-edit';
    el.innerHTML = `
      <div class="manage-body">
        <textarea name="text" rows="2" required>${esc(q.text)}</textarea>
        <input type="text" name="author" placeholder="Author (optional)" value="${esc(q.author || '')}">
        <input type="date" name="dateAdded" value="${esc(q.dateAdded || '')}">
        <input type="text" name="source" placeholder="Source (optional)" value="${esc(q.source || '')}">
      </div>
      <div class="row-actions">
        <button type="submit" class="btn btn-primary">Save</button>
        <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
      </div>`;

    el.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fields = readQuote(el);
      if (!fields.text) return;
      try {
        // Empty strings clear optional fields; the server drops them.
        await QuoteAPI.update(q.id, fields);
      } catch (err) {
        alert(`Could not save — ${OFFLINE}`);
        return;
      }
      editingId = null;
      refresh();
    });

    el.querySelector('[data-act="cancel"]').addEventListener('click', () => {
      editingId = null;
      refresh();
    });

    return el;
  }

  searchInput.addEventListener('input', refresh);

  // ---------- Settings form ----------
  const settingsForm = document.getElementById('settings-form');
  const settingsNotice = document.getElementById('settings-notice');
  const urlInput = settingsForm.elements.serverUrl;
  const resetBtn = document.getElementById('reset-url');

  let settingsTimer;
  function showSettingsNotice(message, isError) {
    settingsNotice.textContent = message;
    settingsNotice.className = isError ? 'notice notice-error' : 'notice';
    settingsNotice.hidden = false;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      settingsNotice.hidden = true;
    }, 3000);
  }

  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = normalizeUrl(urlInput.value);
    if (!url) return;
    await saveServerUrl(url);
    QuoteAPI.setServer(url);
    urlInput.value = url;
    showSettingsNotice('Server URL saved.', false);
    refresh(); // reload manage list against the new server
  });

  resetBtn.addEventListener('click', async () => {
    urlInput.value = DEFAULT_URL;
    await saveServerUrl(DEFAULT_URL);
    QuoteAPI.setServer(DEFAULT_URL);
    showSettingsNotice('Reset to default.', false);
    refresh();
  });

  // ---------- Tabs ----------
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');

  function activate(name) {
    tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
    panels.forEach((p) => (p.hidden = p.dataset.panel !== name));
    if (name === 'manage') refresh(); // reflect new/edited quotes when opened
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => activate(tab.dataset.tab)));

  // ---------- Init ----------
  (async () => {
    const url = await loadServerUrl();
    QuoteAPI.setServer(url);
    urlInput.value = url;
    refresh();

    // If the active tab has highlighted text, prefill the Add form with it so
    // the user can save the selection as a quote straight from the popup.
    const sel = await getActiveTabSelection();
    if (sel && sel.text) {
      form.elements.text.value = sel.text;
      if (sel.title) form.elements.source.value = sel.title;
      form.elements.author.focus();
    }
  })();
})();
