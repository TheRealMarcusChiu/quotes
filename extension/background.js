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

// Right-click menu: "Add as quote", shown only when text is selected.
const MENU_ID = 'quotes-add-selection';

function createMenu() {
  chrome.contextMenus.create(
    {
      id: MENU_ID,
      title: 'Add as quote',
      contexts: ['selection'],
    },
    () => void chrome.runtime.lastError // ignore "duplicate id" on re-register
  );
}

chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);

// Tell the content script to open its in-page form, prefilled with the
// selected text, so author/source can be filled in before saving.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || !tab.id) return;
  const text = (info.selectionText || '').trim();
  if (!text) return;
  chrome.tabs.sendMessage(tab.id, { type: 'open-quote-form', text }, () => {
    void chrome.runtime.lastError; // content script not present on this page
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'add-quote') {
    addQuote(msg.quote)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true; // keep the message channel open for the async response
  }
  return false;
});
