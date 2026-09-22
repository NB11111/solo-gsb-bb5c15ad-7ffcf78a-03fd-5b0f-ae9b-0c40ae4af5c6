'use strict';

const http = require('node:http');
const { join, normalize, extname } = require('node:path');
const { readFile } = require('node:fs/promises');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// 收紧安全响应头；页面不加载任何第三方资源。
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join('; ')
};

const server = http.createServer(async (req, res) => {
  const setHeaders = (extra) => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(key, value);
    }
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        res.setHeader(key, value);
      }
    }
  };

  const sendText = (status, body) => {
    setHeaders({ 'Content-Type': 'text/plain; charset=utf-8' });
    res.writeHead(status);
    res.end(body);
  };

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(405, 'Method Not Allowed');
    }

    if (pathname === '/health') {
      setHeaders({ 'Cache-Control': 'no-store' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ status: 'ok' }));
    }

    // 静态文件：根路径回到 index.html，并防止路径穿越。
    let relPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = normalize(join(ROOT, relPath));
    if (!filePath.startsWith(ROOT + require('node:path').sep)) {
      return sendText(403, 'Forbidden');
    }

    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    setHeaders({
      'Content-Type': type,
      'Cache-Control': filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600'
    });
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (err) {
    if (err && err.code === 'ENOENT') return sendText(404, 'Not Found');
    console.error(err);
    sendText(500, 'Internal Server Error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`剧场排练走位工具已启动: http://localhost:${PORT}`);
});

module.exports = server;
