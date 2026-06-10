# Highlight-to-Quote — Extension Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

Let the user highlight text on any web page, click a floating button that
appears near the selection, fill an in-page form (selected text pre-filled, plus
optional author / source / date), and submit it as a quote to their quotes
server — without leaving the page or opening the extension popup.

## Decisions

- **Trigger:** floating "+ Quote" button that appears near a non-empty text
  selection.
- **Form location:** in-page overlay (not the extension popup).
- **Smart defaults:** Source pre-filled with the page `document.title`; Date
  added pre-filled with today. Both editable. Author starts blank.
- **Server:** the saved `serverUrl` from `chrome.storage` (Settings tab),
  defaulting to `http://localhost:3030` — same source the popup uses.

## Architecture

Three new/changed pieces. No new permissions (`storage` and `host_permissions`
for all URLs are already granted in `manifest.json`).

### 1. `content.js` (content script, all pages)

- Runs at `document_idle` on `<all_urls>`.
- Listens for selection changes (`mouseup` / `selectionchange`). When the
  selection is non-empty, positions a small floating **"+ Quote"** button near
  the end of the selection. Hides the button when the selection is cleared or
  the user scrolls/clicks away.
- Clicking the button opens an **overlay form** rendered inside a **Shadow DOM**
  root, so page CSS cannot break the form and the form's CSS cannot leak into
  the page.
- Form fields:
  - **Quote** — `<textarea>`, pre-filled with the selected text, editable,
    required.
  - **Author** — text input, optional, blank.
  - **Source** — text input, pre-filled with `document.title`, editable.
  - **Date added** — date input, pre-filled with today (local date).
  - Actions: **Add quote** / **Cancel**, plus an inline notice line for
    success/error.
- On submit: build a quote object, send it to the background worker via
  `chrome.runtime.sendMessage`, await the result, show the notice. On success,
  auto-close the overlay (mirrors the popup's behavior). On error, keep the form
  open with the error notice so the user can retry.
- Escape key and Cancel close the overlay without saving.

### 2. `background.js` (service worker)

- Receives `{ type: 'add-quote', quote }` messages.
- Reads `serverUrl` from `chrome.storage.local` (default
  `http://localhost:3030`), normalizes it (strip trailing slash), and POSTs the
  quote to `{serverUrl}/api/quotes` with `Content-Type: application/json`.
- Responds `{ ok: true }` on a successful response, or
  `{ ok: false, error }` otherwise.
- **Why a worker instead of fetching from the content script:** a content script
  posting to `http://localhost:3030` from an `https://` page is blocked by the
  browser as mixed content. The service worker has `host_permissions` and is not
  subject to mixed-content blocking, so the request succeeds.

### 3. `manifest.json`

- Add a `content_scripts` entry: `matches: ["<all_urls>"]`,
  `js: ["content.js"]`, `run_at: "document_idle"`.
- Add `background: { "service_worker": "background.js" }`.
- `permissions` (`storage`) and `host_permissions` (`http://*/*`,
  `https://*/*`) already cover the new code.

## Data flow

```
select text
  -> floating "+ Quote" button appears near selection
  -> click button -> Shadow DOM overlay form (text + defaults pre-filled)
  -> user edits / fills optional fields -> Add quote
  -> content.js sendMessage({ type:'add-quote', quote })
  -> background.js reads serverUrl, POST {serverUrl}/api/quotes
  -> {ok} back to content.js -> notice; on success close overlay
```

## Quote payload

Only non-empty fields are sent (matches `popup.js` `readQuote` + the add
handler):

```js
const quote = { text };               // always
if (author) quote.author = author;    // optional
if (source) quote.source = source;    // optional, default document.title
if (dateAdded) quote.dateAdded = dateAdded; // optional, default today
```

## Reused logic

`todayISO()`, `esc()`, the URL-normalization, and the optional-field-stripping
mirror `popup.js`. Because a content script cannot import the popup's IIFE, this
small amount of logic is duplicated rather than shared.

## Out of scope

- Editing / deleting quotes from the page (remains popup-only).
- Keyboard shortcuts to open the form.
- A right-click context-menu trigger.
