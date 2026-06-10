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
