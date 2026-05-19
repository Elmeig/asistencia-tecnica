const http = require('http');
const url = require('url');
const PORT = 3002;
const BUG_TRACKER = 'http://127.0.0.1:3000';
const ASISTENCIA = 'http://127.0.0.1:3001';

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname;
  const search = parsed.search || '';

  if (pathname.startsWith('/asistencia/')) {
    const newPath = (pathname.replace(/^\/asistencia/, '') || '/') + search;
    const target = ASISTENCIA + newPath;
    const proxyReq = http.request(target, { method: req.method, headers: req.headers }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => { res.writeHead(502); res.end('Bad Gateway'); });
    req.pipe(proxyReq);
  } else {
    const target = BUG_TRACKER + pathname + search;
    const proxyReq = http.request(target, { method: req.method, headers: req.headers }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => { res.writeHead(502); res.end('Bad Gateway'); });
    req.pipe(proxyReq);
  }
});

server.listen(PORT, () => {
  console.log('Proxy listening on port ' + PORT);
});
