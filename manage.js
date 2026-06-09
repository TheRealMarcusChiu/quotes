const rowsEl = document.getElementById('rows');
const searchInput = document.getElementById('search');
const emptyMsg = document.getElementById('empty');
const countEl = document.getElementById('count');

let editingId = null; // id of the quote currently in edit mode, or null
let cache = []; // last list fetched from the server

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

async function refresh() {
  try {
    cache = await QuoteAPI.all();
  } catch (e) {
    rowsEl.replaceChildren();
    countEl.textContent = '';
    emptyMsg.textContent = 'Could not load — is the server running?';
    emptyMsg.hidden = false;
    return;
  }
  emptyMsg.textContent = 'No quotes match your search.';
  const index = buildIndex(cache);
  const filtered = searchQuotes(index, cache, searchInput.value);
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
      alert('Could not delete — is the server running?');
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
    const data = new FormData(el);
    const text = data.get('text').trim();
    if (!text) return;

    try {
      // Send empty strings for cleared optional fields; the server drops them.
      await QuoteAPI.update(q.id, {
        text,
        author: data.get('author').trim(),
        dateAdded: data.get('dateAdded'),
        source: data.get('source').trim(),
      });
    } catch (err) {
      alert('Could not save — is the server running?');
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
refresh();
