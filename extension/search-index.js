// Shared FlexSearch helpers used by the public list and the manage page.

function buildIndex(quotes) {
  const index = new FlexSearch.Document({
    tokenize: 'forward',
    document: {
      id: 'id',
      index: ['text', 'author'],
    },
  });
  quotes.forEach((q) => index.add({ id: q.id, text: q.text, author: q.author || '' }));
  return index;
}

// Returns the subset of `quotes` matching `query`, preserving original order.
function searchQuotes(index, quotes, query) {
  query = query.trim();
  if (!query) return quotes;

  const ids = new Set();
  for (const field of index.search(query)) {
    field.result.forEach((id) => ids.add(id));
  }
  return quotes.filter((q) => ids.has(q.id));
}
