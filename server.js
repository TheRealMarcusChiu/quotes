// Dependency-free static file server + quotes REST API.
// The API reads and writes the real quotes.js file so changes persist to disk.
//
//   node server.js          # then open http://localhost:3030
//
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'quotes.js');
const PORT = process.env.PORT || 3030;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Evaluate quotes.js in an isolated function scope to recover the QUOTES array,
// regardless of whether keys are quoted (JSON) or bare (hand-written literal).
function loadQuotes() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const src = fs.readFileSync(DATA_FILE, 'utf8');
  let arr;
  try {
    arr = Function(`${src}; return typeof QUOTES !== 'undefined' ? QUOTES : [];`)();
  } catch (e) {
    console.error('Could not parse quotes.js:', e.message);
    arr = [];
  }
  // Backfill ids on any legacy quotes that lack one, then persist.
  let changed = false;
  arr = arr.map((q) => {
    if (q && q.id) return q;
    changed = true;
    return { id: uid(), ...q };
  });
  if (changed) saveQuotes(arr);
  return arr;
}

function saveQuotes(list) {
  fs.writeFileSync(DATA_FILE, `const QUOTES = ${JSON.stringify(list, null, 2)};\n`);
}

// Stage, commit, and push quotes.js after a change. Git operations are
// serialized through a promise chain so rapid edits can't collide on the index
// lock, and run in the background so the API response isn't blocked.
let gitChain = Promise.resolve();

function git(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: ROOT }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve(stdout);
    });
  });
}

function commitAndPush(message) {
  gitChain = gitChain.then(async () => {
    try {
      await git(['add', DATA_FILE]);
      try {
        await git(['commit', '-m', message]);
      } catch (e) {
        if (/nothing to commit/i.test(e.stderr || '')) return; // no real change
        throw e;
      }
      await git(['push']);
      console.log('Pushed:', message);
    } catch (e) {
      console.error('git sync failed:', (e.stderr || e.message || '').trim());
    }
  });
  return gitChain;
}

function snippet(text) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > 50 ? `${s.slice(0, 50)}…` : s;
}

let quotes = loadQuotes();

// Normalize an incoming quote: required text, optional fields only when non-empty.
function clean(input, id) {
  const out = { id, text: String(input.text || '').trim() };
  for (const k of ['author', 'dateAdded', 'source']) {
    const v = input[k];
    if (v != null && String(v).trim() !== '') out[k] = String(v).trim();
  }
  return out;
}

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function handleApi(req, res, pathname) {
  try {
    const parts = pathname.split('/').filter(Boolean); // ['api', 'quotes', id?]
    const id = parts[2];

    if (req.method === 'GET' && !id) {
      return sendJSON(res, 200, quotes);
    }

    if (req.method === 'POST' && !id) {
      const body = await readBody(req);
      if (!String(body.text || '').trim()) return sendJSON(res, 400, { error: 'text required' });
      const record = clean(body, uid());
      quotes.unshift(record); // newest first
      saveQuotes(quotes);
      commitAndPush(`Add quote: "${snippet(record.text)}"`);
      return sendJSON(res, 201, record);
    }

    if (req.method === 'PUT' && id) {
      const i = quotes.findIndex((q) => q.id === id);
      if (i === -1) return sendJSON(res, 404, { error: 'not found' });
      const merged = { ...quotes[i], ...(await readBody(req)) };
      if (!String(merged.text || '').trim()) return sendJSON(res, 400, { error: 'text required' });
      quotes[i] = clean(merged, id);
      saveQuotes(quotes);
      commitAndPush(`Edit quote: "${snippet(quotes[i].text)}"`);
      return sendJSON(res, 200, quotes[i]);
    }

    if (req.method === 'DELETE' && id) {
      const before = quotes.length;
      quotes = quotes.filter((q) => q.id !== id);
      if (quotes.length === before) return sendJSON(res, 404, { error: 'not found' });
      saveQuotes(quotes);
      commitAndPush(`Delete quote ${id}`);
      return sendJSON(res, 200, { ok: true });
    }

    return sendJSON(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? '/admin.html' : pathname;
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    const decoded = decodeURIComponent(pathname);
    if (decoded.startsWith('/api/quotes')) return handleApi(req, res, decoded);
    return serveStatic(res, decoded);
  })
  .listen(PORT, () => {
    console.log(`Quotes server running at http://localhost:${PORT}`);
  });
