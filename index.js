/**
 * Cockpit — servidor Node.js.
 * Local:  node index.js
 * Vercel: deploy com vercel.json (usa @vercel/node)
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Carrega .env local
try {
  const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.+?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/['"]/g, '');
  }
} catch (_) {}

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const handler = (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'x'}`);
  const p = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
    return res.end();
  }

  // Proxy /api/* -> Supabase
  if (p.startsWith('/api/')) {
    if (p === '/api/import') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ ok: false, error: 'Import so funciona com Python (serve_simple.py).' }));
    }
    const api = p.replace('/api', '');
    const qs = u.searchParams.toString();
    const t = `${SUPABASE_URL}/rest/v1${api}${qs ? '?' + qs : ''}`;
    const proto = SUPABASE_URL.startsWith('https') ? https : http;
    try {
      proto.request(t, {
        method: 'GET',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        timeout: 15000,
      }, (r2) => {
        const c = []; r2.on('data', d => c.push(d));
        r2.on('end', () => {
          const b = Buffer.concat(c);
          res.writeHead(r2.statusCode, {
            'Content-Type': r2.headers['content-type'] || 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(b);
        });
      }).on('error', e => {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: e.message }));
      }).end();
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Arquivo estatico
  let fp = path.join(__dirname, p === '/' || p === '' ? 'index.html' : p.slice(1));
  try {
    fp = path.resolve(fp);
    if (!fp.startsWith(path.resolve(__dirname))) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const ct = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
      const d = fs.readFileSync(fp);
      res.writeHead(200, { 'Content-Type': ct, 'Content-Length': d.length, 'Cache-Control': 'no-store' });
      return res.end(d);
    }
  } catch (_) {}

  // Fallback index.html
  try {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  } catch (_) { res.writeHead(500); res.end(); }
};

// Local: inicia HTTP server
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  http.createServer(handler).listen(PORT, () => {
    console.log(`\n  Cockpit em http://localhost:${PORT}`);
    console.log(`  Proxy: /api/* -> ${SUPABASE_URL}/rest/v1/*\n`);
  });
} else {
  module.exports = handler;
}
