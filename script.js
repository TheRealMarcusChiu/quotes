const list = document.getElementById('list');
const searchInput = document.getElementById('search');
const emptyMsg = document.getElementById('empty');

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// quotes.js is kept current on disk by the backend (server.js).
const quotes = QUOTES.map((q, i) => (q.id ? q : { id: String(i), ...q }));
const index = buildIndex(quotes);

function render(items) {
  const frag = document.createDocumentFragment();
  items.forEach((q, i) => {
    const row = document.createElement('div');
    row.className = 'quote-row';
    row.style.animationDelay = `${i * 40}ms`;

    let html = `<p class="qtext">"${q.text}"</p>`;
    if (q.author) html += `<p class="qauthor">— ${q.author}</p>`;
    if (q.dateAdded) html += `<p class="qdate">${formatDate(q.dateAdded)}</p>`;
    row.innerHTML = html;

    frag.appendChild(row);
  });

  list.replaceChildren(frag);
  emptyMsg.hidden = items.length > 0;
}

searchInput.addEventListener('input', (e) => {
  render(searchQuotes(index, quotes, e.target.value));
});

render(quotes);
