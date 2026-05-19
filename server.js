const http = require('http');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');

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
function loadFromXlsx() {
  const wb = XLSX.readFile(XLSX_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some(c => c !== undefined && c !== '')) continue;
    // Date: Excel serial number → ISO string
    let fecha = r[2];
    if (typeof fecha === 'number') {
      const d = new Date((fecha - 25569) * 86400000);
      fecha = d.toISOString().slice(0, 10);
    } else if (fecha) {
      fecha = String(fecha);
    } else {
      fecha = '';
    }
    records.push({
      id: uuidv4(),
      cliente: String(r[0] || '').trim(),
      torno: String(r[1] || '').trim(),
      fecha,
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

// ─── Helpers ─────────────────────────────────────────
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
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function cors(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
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
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  return params;
}

// ─── Server ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const method = req.method;
  const urlPath = req.url.split('?')[0];
  const query = parseQS(req.url);

  // CORS preflight
  if (method === 'OPTIONS') return cors(res);

  // ── API routes ──
  if (urlPath === '/api/records' && method === 'GET') {
    const filtered = filterRecords(query);
    return json(res, { total: filtered.length, records: filtered });
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
      if (!record.cliente || !record.torno || !record.tecnico) {
        return json(res, { error: 'Missing required fields' }, 400);
      }
      records.push(record);
      saveRecords(records);
      return json(res, record, 201);
    } catch (e) {
      return json(res, { error: 'Invalid JSON' }, 400);
    }
  }

  if (urlPath === '/api/export' && method === 'GET') {
    const filtered = filterRecords(query);
    const buf = buildXlsx(filtered);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="Asistencia_Tecnica.xlsx"',
      'Content-Length': buf.length,
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(buf);
  }

  // ── Static files ──
  let filePath = path.join(__dirname, 'public', urlPath === '/' ? 'index.html' : urlPath);
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
