require('dotenv').config({ path: __dirname + '/.env' });

const http = require('http');
const url = require('url');
const bcrypt = require('bcrypt');

const PORT = 3002;
const BUG_TRACKER = 'http://127.0.0.1:3000';
const ASISTENCIA = 'http://127.0.0.1:3001';
const PUESTA_MARCHA = 'http://127.0.0.1:3003';

// ─── Basic Auth (Asistencia only) ─────────────────────────────────────
// Parse ASISTENCIA_USERS="user1:$2b$10$hash1,user2:$2b$10$hash2"
function loadUsers() {
  return (process.env.ASISTENCIA_USERS || '').split(',').reduce((acc, pair) => {
    const trimmed = pair.trim();
    if (!trimmed) return acc;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) return acc;
    const user = trimmed.slice(0, idx);
    const hash = trimmed.slice(idx + 1);
    if (user && hash) acc[user] = hash;
    return acc;
  }, {});
}

// Dummy hash for constant-time comparison on unknown usernames
// (regenerated at boot so it never matches a real password)
const DUMMY_HASH = bcrypt.hashSync('__dummy__' + Date.now() + Math.random(), 10);

async function isAuthenticated(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;

  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const idx = credentials.indexOf(':');
    if (idx < 0) return false;
    const username = credentials.slice(0, idx);
    const password = credentials.slice(idx + 1);

    const users = loadUsers();
    const validUser = Object.prototype.hasOwnProperty.call(users, username);
    const hashToCompare = validUser ? users[username] : DUMMY_HASH;

    const isMatch = await bcrypt.compare(password, hashToCompare);
    return validUser && isMatch;
  } catch (err) {
    return false;
  }
}

function send401(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Asistencia"',
    'Content-Type': 'text/plain',
  });
  res.end('401 Unauthorized - Access Denied');
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname;
  const search = parsed.search || '';

  const isAsistenciaRoute = pathname === '/asistencia' || pathname.startsWith('/asistencia/');
  const isPuestaMarchaRoute = pathname === '/puesta-marcha' || pathname.startsWith('/puesta-marcha/');

  // 🛡️ Apply Basic Auth to Asistencia and Puesta en Marcha routes
  if (isAsistenciaRoute || isPuestaMarchaRoute) {
    // If ASISTENCIA_USERS is empty, refuse rather than fall open
    if (!process.env.ASISTENCIA_USERS || !process.env.ASISTENCIA_USERS.trim()) {
      console.error('[proxy] ASISTENCIA_USERS not configured — denying access');
      return send401(res);
    }
    const ok = await isAuthenticated(req);
    if (!ok) return send401(res);
  }

  if (pathname === '/asistencia') {
    // Redirect /asistencia → /asistencia/ so relative asset URLs (style.css, app.js) resolve correctly
    res.writeHead(301, { Location: '/asistencia/' + search });
    res.end();
    return;
  }

  if (pathname === '/puesta-marcha') {
    res.writeHead(301, { Location: '/puesta-marcha/' + search });
    res.end();
    return;
  }

  if (pathname.startsWith('/asistencia/')) {
    // Strip /asistencia prefix for requests to asistencia app (port 3001)
    const newPath = pathname.replace(/^\/asistencia/, '') || '/';
    const target = ASISTENCIA + newPath + search;
    const proxyReq = http.request(target, { method: req.method, headers: req.headers }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => { res.writeHead(502); res.end('Bad Gateway'); });
    req.pipe(proxyReq);
  } else if (pathname.startsWith('/puesta-marcha/')) {
    const newPath = pathname.replace(/^\/puesta-marcha/, '') || '/';
    const target = PUESTA_MARCHA + newPath + search;
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
