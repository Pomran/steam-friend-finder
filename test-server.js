// 本地测试用静态服务器 + 模拟 Cloudflare Functions API
// 用途：在无法运行 wrangler dev 时，快速验证大厅页与本机 Steam 卡片。
// 启动：node test-server.js  ->  http://127.0.0.1:8787/play
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8787;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = decodeURIComponent(url.pathname);

  // 模拟站点 API，避免页面逻辑报错
  if (p === '/api/me') return json(res, { loggedIn: false });
  if (p === '/api/lobby') {
    if (req.method === 'GET') return json(res, []);
    return json(res, { error: '测试服务器未登录：请用 wrangler dev 或线上环境测试登录功能' }, 401);
  }
  if (p === '/api/presence') {
    if (req.method === 'GET') return json(res, []);
    const body = await readJson(req);
    if (body.active === false) return json(res, { ok: true });
    return json(res, { ok: true });
  }
  if (p === '/api/push/config' || p === '/api/push/vapid') return json(res, { webPushSub: null });
  if (p === '/auth/login') {
    res.writeHead(302, { Location: 'http://127.0.0.1:8787/play?login=failed' });
    return res.end();
  }

  // 静态文件
  let rel = p === '/' ? '/index.html' : p;
  if (rel === '/play') rel = '/play.html';
  const fp = path.normalize(path.join(ROOT, rel));
  if (!fp.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('not found: ' + p);
  }
  const ext = path.extname(fp).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Test server running at http://127.0.0.1:${PORT}/play`);
  console.log('Press Ctrl+C to stop.');
});
