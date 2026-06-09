// Front-end client for the quotes REST API (served by server.js).
const QuoteAPI = {
  base: '/api/quotes',

  async all() {
    const r = await fetch(this.base);
    if (!r.ok) throw new Error('Failed to load quotes');
    return r.json();
  },

  async add(quote) {
    return this._send(this.base, 'POST', quote);
  },

  async update(id, patch) {
    return this._send(`${this.base}/${encodeURIComponent(id)}`, 'PUT', patch);
  },

  async remove(id) {
    const r = await fetch(`${this.base}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Failed to delete quote');
    return r.json();
  },

  async _send(url, method, body) {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Request failed (${r.status})`);
    return r.json();
  },
};
