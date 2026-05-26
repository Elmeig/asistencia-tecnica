const http = require('http');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const Busboy = require('busboy');

const PORT = 3001;
const DATA_DIR = path.join(__dirname, 'data');
const XLSX_FILE = path.join(DATA_DIR, 'asistencia.xlsx');
const JSON_FILE = path.join(DATA_DIR, 'records.json');

// ─── MIME types ──────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ─── Load records from xlsx into memory + JSON cache ─
// Normalize any fecha value (Excel serial number, Date object, or string)
// to ISO 'YYYY-MM-DD'. Returns '' for empty/invalid input. Keeps unknown
// string formats as-is (trimmed) so legacy free-text dates aren't lost.
function normalizeFecha(value) {
  if (value === null || value === undefined || value === '') return '';
  // Excel serial number (days since 1899-12-30)
  if (typeof value === 'number' && isFinite(value)) {
    const d = new Date(Math.round((value - 25569) * 86400000));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return '';
  }
  // Date object (XLSX with cellDates:true)
  if (value instanceof Date && !isNaN(value.getTime())) {
    // Use UTC components — the cell has no timezone, treat date-only.
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  if (!s) return '';
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // dd/mm/yyyy or dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yy] = m;
    if (yy.length === 2) yy = (Number(yy) < 50 ? '20' : '19') + yy;
    return `${yy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
  }
  // Numeric string that's actually an Excel serial
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 10000 && n < 80000) return normalizeFecha(n);
  }
  return s; // unknown free-text, keep as-is
}

function loadFromXlsx() {
  const wb = XLSX.readFile(XLSX_FILE, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some(c => c !== undefined && c !== '')) continue;
    records.push({
      id: uuidv4(),
      cliente: String(r[0] || '').trim(),
      torno: String(r[1] || '').trim(),
      fecha: normalizeFecha(r[2]),
      tecnico: String(r[3] || '').trim(),
      comentarios: String(r[4] || '').trim(),
    });
  }
  return records;
}

function loadRecords() {
  if (fs.existsSync(JSON_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
    } catch (_) {}
  }
  const records = loadFromXlsx();
  saveRecords(records);
  return records;
}

function saveRecords(records) {
  fs.writeFileSync(JSON_FILE, JSON.stringify(records, null, 2));
}

let records = loadRecords();

// Reload records.json whenever it changes on disk (e.g. obsidian-sync daemon
// appends new records from Obsidian Inbox notes). Without this the server
// would keep its in-memory copy and never see external writes.
try {
  fs.watch(JSON_FILE, { persistent: false }, () => {
    // Debounce: filesystem watchers can fire multiple events per write
    clearTimeout(records._reloadTimer);
    const t = setTimeout(() => {
      try {
        const fresh = loadRecords();
        records = fresh;
        console.log(`[${new Date().toISOString()}] records.json reloaded — ${records.length} records`);
      } catch (e) {
        console.error('records reload failed:', e.message);
      }
    }, 250);
    if (records && typeof records === 'object') records._reloadTimer = t;
  });
  console.log(`[${new Date().toISOString()}] watching ${JSON_FILE} for changes`);
} catch (e) {
  console.warn('fs.watch on records.json failed:', e.message);
}

// ─── Helpers ─────────────────────────────────────────
// ─── CORS allowlist ──────────────────────────────────
// Parse ALLOWED_ORIGINS env var, fall back to safe defaults.
// Use 'null' (the literal string) when the request origin isn't allowed —
// this prevents browsers from honoring the cross-origin response.
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ||
   'https://bugtracker.tail51f3b0.ts.net,http://127.0.0.1:3001,http://127.0.0.1:3002,http://localhost:3001,http://localhost:3002'
  ).split(',').map(s => s.trim()).filter(Boolean)
);

function resolveCorsOrigin(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return null; // same-origin or non-browser; omit header
  return ALLOWED_ORIGINS.has(origin) ? origin : 'null';
}

function corsHeaders(res) {
  const origin = res._cors_origin;
  if (origin === null || origin === undefined) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json',
  }, corsHeaders(res)));
  res.end(JSON.stringify(data));
}

function cors(res) {
  res.writeHead(204, Object.assign({
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }, corsHeaders(res)));
  res.end();
}

// ─── Build xlsx buffer from records ──────────────────
function buildXlsx(recs) {
  const header = ['Cliente', 'Torno', 'Fecha', 'Técnico', 'Comentarios'];
  const rows = [header];
  for (const r of recs) {
    rows.push([r.cliente, r.torno, r.fecha, r.tecnico, r.comentarios]);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Set column widths
  ws['!cols'] = [
    { wch: 20 }, // Cliente
    { wch: 20 }, // Torno
    { wch: 12 }, // Fecha
    { wch: 15 }, // Técnico
    { wch: 80 }, // Comentarios
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ─── Filter logic ────────────────────────────────────
function filterRecords(query) {
  let result = records;
  if (query.cliente) {
    const q = query.cliente.toLowerCase();
    result = result.filter(r => r.cliente.toLowerCase().includes(q));
  }
  if (query.torno) {
    const q = query.torno.toLowerCase();
    result = result.filter(r => r.torno.toLowerCase().includes(q));
  }
  if (query.tecnico) {
    const q = query.tecnico.toLowerCase();
    result = result.filter(r => r.tecnico.toLowerCase().includes(q));
  }
  if (query.desde) {
    result = result.filter(r => r.fecha >= query.desde);
  }
  if (query.hasta) {
    result = result.filter(r => r.fecha <= query.hasta);
  }
  // Sort newest first
  result.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  return result;
}

// ─── Parse query string ──────────────────────────────
function parseQS(urlStr) {
  const idx = urlStr.indexOf('?');
  if (idx === -1) return {};
  const params = {};
  urlStr.slice(idx + 1).split('&').forEach(p => {
    const [k, v] = p.split('=');
    if (k) {
      // '+' represents a space in URL-encoded strings (application/x-www-form-urlencoded)
      const decodedV = decodeURIComponent((v || '').replace(/\+/g, ' '));
      params[decodeURIComponent(k.replace(/\+/g, ' '))] = decodedV;
    }
  });
  return params;
}

// ─── Server ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const method = req.method;
  const urlPath = req.url.split('?')[0];
  const query = parseQS(req.url);

  // Resolve CORS origin once per request; attach to res for downstream helpers
  res._cors_origin = resolveCorsOrigin(req);

  // CORS preflight
  if (method === 'OPTIONS') return cors(res);

  // ── API routes ──
  if (urlPath === '/api/records' && method === 'GET') {
    const filtered = filterRecords(query);
    return json(res, { total: filtered.length, records: filtered });
  }

  // ── All unique customers (for combobox dropdown) ─────
  if (urlPath === '/api/customers' && method === 'GET') {
    const customers = [...new Set(records.map(r => r.cliente).filter(Boolean))].sort();
    return json(res, { customers });
  }

  // ── Unique values for dropdowns + cascading ──
  if (urlPath === '/api/unique-values' && method === 'GET') {
    const customer = query.cliente || '';
    let machines = [...new Set(records.map(r => r.torno).filter(Boolean))].sort();
    let technicians = [...new Set(records.map(r => r.tecnico).filter(Boolean))].sort();
    let dates = [...new Set(records.map(r => r.fecha).filter(Boolean))].sort().reverse();

    if (customer) {
      // Cascade: only show machines/technicians/dates that appear with this customer
      const linked = records.filter(r => r.cliente.toLowerCase() === customer.toLowerCase());
      machines = [...new Set(linked.map(r => r.torno).filter(Boolean))].sort();
      technicians = [...new Set(linked.map(r => r.tecnico).filter(Boolean))].sort();
      dates = [...new Set(linked.map(r => r.fecha).filter(Boolean))].sort().reverse();
    }

    return json(res, { machines, technicians, dates });
  }

  // ── Check for similar customer names (new record warning) ──
  if (urlPath === '/api/check-customer' && method === 'GET') {
    const name = (query.name || '').trim().toLowerCase();
    if (!name || name.length < 2) return json(res, { similar: [] });

    const similar = records
      .map(r => r.cliente)
      .filter(Boolean)
      .filter(c => {
        const cl = c.toLowerCase();
        // Exact match → skip (not similar, it's the same)
        if (cl === name) return false;
        // Contains check (both ways) — case insensitive
        if (cl.includes(name) || name.includes(cl)) return true;
        // Starts with same first 3 chars — catches typos & fragments
        if (cl.slice(0, 3) === name.slice(0, 3)) return true;
        return false;
      })
      .filter((v, i, a) => a.indexOf(v) === i) // dedupe
      .slice(0, 5);

    return json(res, { similar });
  }

  if (urlPath === '/api/records' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const record = {
        id: uuidv4(),
        cliente: String(body.cliente || '').trim(),
        torno: String(body.torno || '').trim(),
        fecha: body.fecha || new Date().toISOString().slice(0, 10),
        tecnico: String(body.tecnico || '').trim(),
        comentarios: String(body.comentarios || '').trim(),
      };
      if (!record.cliente || !record.tecnico) {
        return json(res, { error: 'Missing required fields (cliente, tecnico)' }, 400);
      }
      records.push(record);
      saveRecords(records);
      return json(res, record, 201);
    } catch (e) {
      return json(res, { error: 'Invalid JSON' }, 400);
    }
  }

  // ── Update a record ────────────────────────────────
  const updateMatch = urlPath.match(/^\/api\/records\/([^/]+)$/);
  if (updateMatch && method === 'PUT') {
    const id = updateMatch[1];
    try {
      const body = await parseBody(req);
      const idx = records.findIndex(r => r.id === id);
      if (idx === -1) return json(res, { error: 'Not found' }, 404);
      const updated = {
        ...records[idx],
        cliente: String(body.cliente || '').trim(),
        torno: String(body.torno || '').trim(),
        fecha: body.fecha || records[idx].fecha,
        tecnico: String(body.tecnico || '').trim(),
        comentarios: String(body.comentarios || '').trim(),
      };
      if (!updated.cliente || !updated.tecnico) {
        return json(res, { error: 'Missing required fields (cliente, tecnico)' }, 400);
      }
      records[idx] = updated;
      saveRecords(records);
      return json(res, updated);
    } catch (e) {
      return json(res, { error: 'Invalid JSON' }, 400);
    }
  }

  // ── Delete a record ────────────────────────────────
  const deleteMatch = urlPath.match(/^\/api\/records\/([^/]+)$/);
  if (deleteMatch && method === 'DELETE') {
    const id = deleteMatch[1];
    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return json(res, { error: 'Not found' }, 404);
    const deleted = records.splice(idx, 1)[0];
    saveRecords(records);
    return json(res, { deleted: deleted.id });
  }

  // ── Upload xlsx and upsert records ──────────────────
  if (urlPath === '/api/upload' && method === 'POST') {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return json(res, { error: 'multipart/form-data required' }, 400);
    }

    const busboy = Busboy({ headers: { 'content-type': contentType } });
    let fileBuffer = null;
    let fileName = '';

    busboy.on('file', (field, stream, info) => {
      fileName = info.filename;
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
    });

    busboy.on('finish', () => {
      if (!fileBuffer) return json(res, { error: 'No file received' }, 400);

      let workbook;
      try {
        workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
      } catch (e) {
        return json(res, { error: 'Invalid xlsx file' }, 400);
      }

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

      if (rows.length < 2) {
        return json(res, { error: 'File has no data rows' }, 400);
      }

      const header = rows[0].map(h => String(h).trim());
      const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const colMap = {
        cliente:     header.findIndex(h => norm(h).includes('cliente')),
        torno:       header.findIndex(h => /torno|maquina|machine/i.test(h)),
        fecha:       header.findIndex(h => norm(h).includes('fecha') || h.toLowerCase().includes('date')),
        tecnico:     header.findIndex(h => norm(h).includes('tecnic')),
        comentarios: header.findIndex(h => /comentarios|description|desc/i.test(h)),
      };

      const missing = Object.entries(colMap).filter(([, i]) => i === -1).map(([k]) => k);
      if (missing.length > 0) {
        return json(res, { error: `Missing columns: ${missing.join(', ')}` }, 400);
      }

      // Dedup key now INCLUDES comentarios — multiple distinct asistencias
      // can happen on the same day, same machine, same technician. The actual
      // service content is what distinguishes one visit from another, so the
      // body of the record is part of the identity.
      //
      // Behaviour:
      //   - Exact match (cliente+torno+fecha+tecnico+comentarios identical) → skip
      //   - Anything else                                                   → insert
      // There is no "update" path on xlsx upload; to amend a record, edit it
      // inline in the UI (or via the API) where the record id is known.
      const keyFor = (r) => [
        norm(r.cliente),
        norm(r.torno),
        String(r.fecha || '').trim(),
        norm(r.tecnico),
        (r.comentarios || '').trim(),
      ].join('|');

      const existingKeys = new Set(records.map(keyFor));

      let inserted = 0, skipped = 0;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const cliente     = String(row[colMap.cliente]    || '').trim();
        const torno       = String(row[colMap.torno]      || '').trim();
        const fecha       = normalizeFecha(row[colMap.fecha]);
        const tecnico     = String(row[colMap.tecnico]    || '').trim();
        const comentarios = String(row[colMap.comentarios] || '').trim();

        if (!cliente || !tecnico) continue; // skip invalid rows (torno optional)

        const newRecord = { cliente, torno, fecha, tecnico, comentarios };
        const key = keyFor(newRecord);

        if (existingKeys.has(key)) {
          skipped++;
        } else {
          records.push({ id: uuidv4(), ...newRecord });
          existingKeys.add(key); // prevent duplicates within same upload
          inserted++;
        }
      }

      saveRecords(records);
      return json(res, { inserted, skipped, total: records.length });
    });

    req.pipe(busboy);
    return;
  }

  if (urlPath === '/api/export' && method === 'GET') {
    const filtered = filterRecords(query);
    const buf = buildXlsx(filtered);
    res.writeHead(200, Object.assign({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="Asistencia_Tecnica.xlsx"',
      'Content-Length': buf.length,
    }, corsHeaders(res)));
    return res.end(buf);
  }

  // ── Static files ──
  let filePath = path.join(__dirname, 'public', urlPath === '/' ? 'index.html' : urlPath);
  // Security: prevent path traversal escaping the public directory
  const publicDir = path.join(__dirname, 'public');
  if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime });
  res.end(content);
});

server.listen(PORT, () => {
  console.log(`Asistencia server running on http://localhost:${PORT}`);
});
