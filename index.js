const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let fp = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);

  try {
    fp = path.resolve(fp);
    if (!fp.startsWith(path.resolve(ROOT))) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const ct = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
      const d = fs.readFileSync(fp);
      res.writeHead(200, { 'Content-Type': ct, 'Content-Length': d.length, 'Cache-Control': 'no-store' });
      return res.end(d);
    }
  } catch (_) {}

  try {
    const d = fs.readFileSync(path.join(ROOT, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(d);
  } catch (_) {
    res.writeHead(500); res.end();
  }
});

server.listen(PORT, () => {
  console.log(`\n  Cockpit local em http://localhost:${PORT}\n`);
});
