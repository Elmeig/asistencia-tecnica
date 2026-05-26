#!/usr/bin/env node
/**
 * Obsidian → Asistencia DB sync daemon.
 *
 * Watches the Obsidian vault's "Asistencia/Inbox" folder for new .md files.
 * Each file is parsed (YAML frontmatter + body comentarios), validated,
 * appended as a new record to data/records.json + data/asistencia.xlsx,
 * then moved to "Asistencia/Synced/YYYY-MM/<original>.md" with a sync stamp.
 *
 * Idempotent: a file is only processed if it lacks a `synced` frontmatter field.
 * Watches BOTH vault paths (root + nested) since iPhone's Möbius bookmark
 * creates a parallel hierarchy.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const VAULT_ROOTS = [
  '/home/wilson/Documents/Obsidian Vault',
  '/home/wilson/Documents/Obsidian Vault/Obsidian Vault',
];
const RECORDS_JSON = '/home/wilson/asistencia-tecnica/data/records.json';
const XLSX_PATH    = '/home/wilson/asistencia-tecnica/data/asistencia.xlsx';
const POLL_MS = 5000;

const KNOWN_TECHS = [
  'MEHDI','RICARDO','MARCELO','JESUS','TAMARA','FRAN','VICTOR','AMIN','FELIX',
];
const DEFAULT_TECH = 'MEHDI';

function log(msg){ console.log(`[${new Date().toISOString()}] ${msg}`); }

/** Parse YAML-ish frontmatter (simple key: value, no nesting). */
function parseFrontmatter(content) {
  if (!content.startsWith('---')) return { meta: {}, body: content };
  const end = content.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: content };
  const fm = content.slice(3, end).trim();
  const body = content.slice(end + 4).replace(/^\n+/, '');
  const meta = {};
  for (const line of fm.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (m) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      meta[m[1].toLowerCase()] = v;
    }
  }
  return { meta, body };
}

function buildFrontmatter(meta) {
  const lines = ['---'];
  for (const [k,v] of Object.entries(meta)) lines.push(`${k}: ${v}`);
  lines.push('---','');
  return lines.join('\n');
}

function normalizeTech(raw) {
  if (!raw) return DEFAULT_TECH;
  const upper = String(raw).trim().toUpperCase();
  // Exact match
  if (KNOWN_TECHS.includes(upper)) return upper;
  // Match first known tech in the string
  for (const t of KNOWN_TECHS) {
    if (upper.includes(t)) return upper; // preserve formatting like "MEHDI/JESUS"
  }
  return upper || DEFAULT_TECH;
}

function todayISO() {
  return new Date().toISOString().slice(0,10);
}

function validateDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function loadRecords() {
  return JSON.parse(fs.readFileSync(RECORDS_JSON, 'utf8'));
}

function saveRecords(records) {
  // Atomic write
  const tmp = RECORDS_JSON + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
  fs.renameSync(tmp, RECORDS_JSON);
}

function writeXlsx(records) {
  const ws = XLSX.utils.json_to_sheet(records);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Asistencias');
  XLSX.writeFile(wb, XLSX_PATH);
}

function listInboxFiles() {
  const found = [];
  for (const root of VAULT_ROOTS) {
    const inbox = path.join(root, 'Asistencia', 'Inbox');
    if (!fs.existsSync(inbox)) continue;
    for (const f of fs.readdirSync(inbox)) {
      if (f.endsWith('.md') && !f.startsWith('.')) {
        found.push({ file: path.join(inbox, f), root });
      }
    }
  }
  return found;
}

function processFile({ file, root }) {
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
  const { meta, body } = parseFrontmatter(content);

  // Already synced? Skip.
  if (meta.synced) return;

  // Skip the template itself if it lands here
  if (path.basename(file).toLowerCase().startsWith('_template')) return;

  // Required + defaults
  const cliente  = (meta.cliente || '').trim().toUpperCase();
  const torno    = (meta.torno   || '').trim().toUpperCase();
  const fecha    = (meta.fecha   || todayISO()).trim();
  const tecnico  = normalizeTech(meta.tecnico);
  const comentarios = body.trim();

  const missing = [];
  if (!cliente) missing.push('cliente');
  if (!comentarios) missing.push('comentarios (body)');
  if (!validateDate(fecha)) missing.push(`fecha (got "${fecha}", need YYYY-MM-DD)`);

  if (missing.length) {
    // Mark file with an error so we don't keep re-reading it
    const updated = buildFrontmatter({ ...meta, sync_error: `missing: ${missing.join(', ')}`, sync_error_at: new Date().toISOString() }) + body;
    fs.writeFileSync(file, updated);
    log(`SKIP ${path.basename(file)} — ${missing.join(', ')}`);
    return;
  }

  // Append record
  const id = crypto.randomUUID();
  const record = { id, cliente, torno, fecha, tecnico, comentarios };

  const records = loadRecords();
  records.push(record);
  saveRecords(records);
  try { writeXlsx(records); } catch (e) {
    log(`XLSX write failed (records.json still updated): ${e.message}`);
  }

  // Stamp file as synced — write IN PLACE to avoid sync races with Möbius.
  // (Moving the file causes Möbius to re-sync the original from the phone,
  //  which then bounces back into the inbox. Stamping in place is idempotent
  //  and visible everywhere immediately.)
  const stamped = buildFrontmatter({
    ...meta,
    cliente, torno, fecha, tecnico,
    synced: new Date().toISOString(),
    record_id: id,
  }) + (body.endsWith('\n') ? body : body + '\n');

  fs.writeFileSync(file, stamped);

  log(`SYNCED ${path.basename(file)} → record ${id.slice(0,8)} (${cliente} / ${torno} / ${tecnico})`);
}

function tick() {
  try {
    const files = listInboxFiles();
    for (const f of files) processFile(f);
  } catch (e) {
    log(`tick error: ${e.message}`);
  }
}

log(`obsidian-sync starting. Polling every ${POLL_MS}ms. Vault roots:`);
VAULT_ROOTS.forEach(r => log(`  - ${r}/Asistencia/Inbox`));
tick();
setInterval(tick, POLL_MS);
