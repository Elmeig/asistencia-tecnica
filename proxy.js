require('dotenv').config({ path: __dirname + '/.env' });

const http = require('http');
const url = require('url');
const bcrypt = require('bcrypt');

const PORT = 3002;
const BUG_TRACKER = 'http://127.0.0.1:3000';
const ASISTENCIA = 'http://127.0.0.1:3001';
const PUESTA_MARCHA = 'http://127.0.0.1:3003';
const SKYPILOT = 'http://127.0.0.1:3020';
const SKYPILOT_V2 = 'http://127.0.0.1:3022';

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

// ─── Basic Auth (Thermik beta) ────────────────────────────────────────
// JSON-backed registry: /home/wilson/skypilot/beta-users.json
// Hot-reloads on every request (file is tiny). Each user has a tier
// ("free" or "pro") that we forward downstream as X-Thermik-Tier so the
// API can gate features without re-doing auth.
const fs = require('fs');
const THERMIK_USERS_PATH = '/home/wilson/skypilot/beta-users.json';
let _thermikCache = { mtimeMs: 0, users: {} };
function loadThermikUsers() {
  try {
    const stat = fs.statSync(THERMIK_USERS_PATH);
    if (stat.mtimeMs === _thermikCache.mtimeMs) return _thermikCache.users;
    const raw = JSON.parse(fs.readFileSync(THERMIK_USERS_PATH, 'utf8'));
    _thermikCache = { mtimeMs: stat.mtimeMs, users: raw.users || {} };
    return _thermikCache.users;
  } catch (e) {
    console.error('[proxy] thermik users load failed:', e.message);
    return {};
  }
}

// Dummy hash for constant-time comparison on unknown usernames
// (regenerated at boot so it never matches a real password)
const DUMMY_HASH = bcrypt.hashSync('__dummy__' + Date.now() + Math.random(), 10);

async function isAuthenticated(req, users) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) return { ok: false };

  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const idx = credentials.indexOf(':');
    if (idx < 0) return { ok: false };
    const username = credentials.slice(0, idx);
    const password = credentials.slice(idx + 1);

    const validUser = Object.prototype.hasOwnProperty.call(users, username);
    const entry = validUser ? users[username] : null;
    // Support both legacy "hash-only-string" entries (Asistencia) and
    // structured { hash, tier, ... } entries (Thermik).
    const hashToCompare = entry
      ? (typeof entry === 'string' ? entry : entry.hash)
      : DUMMY_HASH;

    const isMatch = await bcrypt.compare(password, hashToCompare);
    if (!validUser || !isMatch) return { ok: false };
    return {
      ok: true,
      username,
      tier: (entry && typeof entry === 'object' && entry.tier) || 'free',
    };
  } catch (err) {
    return { ok: false };
  }
}

function send401(res, realm) {
  res.writeHead(401, {
    'WWW-Authenticate': `Basic realm="${realm || 'Asistencia'}"`,
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
  const isSkyRoute = pathname === '/sky' || pathname.startsWith('/sky/');

  // 🛡️ Apply Basic Auth to Asistencia and Puesta en Marcha routes
  if (isAsistenciaRoute || isPuestaMarchaRoute) {
    // If ASISTENCIA_USERS is empty, refuse rather than fall open
    if (!process.env.ASISTENCIA_USERS || !process.env.ASISTENCIA_USERS.trim()) {
      console.error('[proxy] ASISTENCIA_USERS not configured — denying access');
      return send401(res, 'Asistencia');
    }
    const result = await isAuthenticated(req, loadUsers());
    if (!result.ok) return send401(res, 'Asistencia');
  }

  // 🛡️ Thermik beta gate — protects the SkyPilot app + its API.
  // The legacy /sky/ (v1) and the v2 React app + the /sky/api/* both go
  // through this single check. The user's tier is forwarded downstream
  // as X-Thermik-Tier so the API can gate Pro-only features without
  // re-implementing auth.
  let thermikAuth = null;
  if (isSkyRoute) {
    const users = loadThermikUsers();
    if (!Object.keys(users).length) {
      console.error('[proxy] thermik users registry empty — denying access');
      return send401(res, 'Thermik beta');
    }
    thermikAuth = await isAuthenticated(req, users);
    if (!thermikAuth.ok) return send401(res, 'Thermik beta');
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
  } else if (pathname === '/sky') {
    res.writeHead(301, { Location: '/sky/' + search });
    res.end();
    return;
  } else if (pathname === '/sky/v2') {
    res.writeHead(301, { Location: '/sky/v2/' + search });
    res.end();
    return;
  } else if (pathname.startsWith('/sky/v2/')) {
    // React SPA build — strip /sky/v2 prefix, send to :3022
    const newPath = pathname.replace(/^\/sky\/v2/, '') || '/';
    const target = SKYPILOT_V2 + newPath + search;
    const upstreamHeaders = Object.assign({}, req.headers, {
      'X-Thermik-User': thermikAuth.username,
      'X-Thermik-Tier': thermikAuth.tier,
    });
    delete upstreamHeaders.authorization;
    const proxyReq = http.request(target, { method: req.method, headers: upstreamHeaders }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => { res.writeHead(502); res.end('Bad Gateway'); });
    req.pipe(proxyReq);
  } else if (pathname.startsWith('/sky/')) {
    const newPath = pathname.replace(/^\/sky/, '') || '/';
    const target = SKYPILOT + newPath + search;
    const upstreamHeaders = Object.assign({}, req.headers, {
      'X-Thermik-User': thermikAuth.username,
      'X-Thermik-Tier': thermikAuth.tier,
    });
    delete upstreamHeaders.authorization;
    const proxyReq = http.request(target, { method: req.method, headers: upstreamHeaders }, (proxyRes) => {
      // Rewrite root-absolute hrefs/srcs in HTML so assets resolve under /sky/
      const ct = proxyRes.headers['content-type'] || '';
      if (ct.includes('text/html')) {
        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8');
          html = html.replace(/(href|src)\s*=\s*"\/(?!sky\/|api\/|https?:|\/)/g, '$1="/sky/');
          const body = Buffer.from(html, 'utf8');
          const headers = Object.assign({}, proxyRes.headers);
          delete headers['content-length'];
          delete headers['transfer-encoding'];
          headers['Content-Length'] = body.length;
          res.writeHead(proxyRes.statusCode, headers);
          res.end(body);
        });
      } else {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
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
