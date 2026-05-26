#!/usr/bin/env node
/**
 * Obsidian Export Daemon
 *
 * Watches data/records.json and regenerates the Obsidian vault's
 * Customers/ and Machines/ trees on every change.
 *
 * One-way sync: DB -> Obsidian. Generated files are marked with a
 * "generated:" frontmatter stamp so the user knows not to hand-edit
 * them. Manual notes live in Customers/<C>/Notas manuales.md which
 * the daemon never touches.
 *
 * Companion to obsidian-sync.js (which does Obsidian -> DB).
 */

const fs = require('fs');
const path = require('path');

const RECORDS_PATH = '/home/wilson/asistencia-tecnica/data/records.json';
const VAULT = '/home/wilson/Documents/Obsidian Vault';
const CUSTOMERS_DIR = path.join(VAULT, 'Customers');
const MACHINES_DIR = path.join(VAULT, 'Machines');

const AUTO_HEADER = '> ⚠️ **Auto-generated from Asistencia database — do not edit.** Manual notes belong in `Notas manuales.md` in the same folder.';

function sanitizeFs(s) {
  // Keep human-readable but strip filesystem-hostile chars
  return String(s || '').replace(/[\/\\:*?"<>|]/g, '_').trim();
}

function machineModel(torno) {
  const m = String(torno || '').match(/^(R\d{3}|LML|LSR|REM)/i);
  return m ? m[1].toUpperCase() : null;
}

function fmtDate(d) {
  return d || '';
}

function escapeMd(s) {
  return String(s || '').replace(/\|/g, '\\|');
}

function buildCustomerOverview(cliente, machines, records) {
  const techs = [...new Set(records.map(r => (r.tecnico || '').trim()).filter(Boolean))].sort();
  const machineList = [...machines].sort();
  const lines = [
    '---',
    `customer: ${JSON.stringify(cliente)}`,
    `generated: ${new Date().toISOString()}`,
    `record_count: ${records.length}`,
    `machine_count: ${machineList.length}`,
    'auto: true',
    '---',
    '',
    AUTO_HEADER,
    '',
    `# ${cliente}`,
    '',
    `**Records:** ${records.length}  |  **Machines:** ${machineList.length}  |  **Technicians:** ${techs.join(', ') || '—'}`,
    '',
    '## Máquinas',
    '',
  ];
  if (machineList.length === 0) {
    lines.push('_Sin máquinas registradas._');
  } else {
    for (const m of machineList) {
      const recs = records.filter(r => (r.torno || '').trim() === m).length;
      lines.push(`- [[${m}]] — ${recs} intervención${recs === 1 ? '' : 'es'}`);
    }
  }
  lines.push('', '## Historial reciente', '');
  const sorted = [...records].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 10);
  for (const r of sorted) {
    const m = (r.torno || '').trim() || 'Sin máquina';
    const t = (r.tecnico || '').trim() || '—';
    const c = escapeMd((r.comentarios || '').replace(/\n+/g, ' ').slice(0, 120));
    lines.push(`- **${fmtDate(r.fecha)}** · [[${m}]] · *${t}* — ${c}`);
  }
  return lines.join('\n') + '\n';
}

function buildMachineNote(cliente, torno, records) {
  const sorted = [...records].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  const techs = [...new Set(sorted.map(r => (r.tecnico || '').trim()).filter(Boolean))].sort();
  const lines = [
    '---',
    `customer: ${JSON.stringify(cliente)}`,
    `machine: ${JSON.stringify(torno)}`,
    `model: ${JSON.stringify(machineModel(torno) || '')}`,
    `generated: ${new Date().toISOString()}`,
    `record_count: ${sorted.length}`,
    'auto: true',
    '---',
    '',
    AUTO_HEADER,
    '',
    `# ${torno || 'Sin máquina'} — [[${cliente}]]`,
    '',
    `**Cliente:** [[${cliente}/${cliente}|${cliente}]]  |  **Modelo:** ${machineModel(torno) || '—'}  |  **Intervenciones:** ${sorted.length}  |  **Técnicos:** ${techs.join(', ') || '—'}`,
    '',
    '## Historial completo',
    '',
  ];
  for (const r of sorted) {
    const t = (r.tecnico || '').trim() || '—';
    const c = (r.comentarios || '').trim() || '_(sin comentarios)_';
    lines.push(`### ${fmtDate(r.fecha)} — *${t}*`);
    lines.push('');
    lines.push(c);
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

function buildMachineIndex(model, byCustomerMachine) {
  // byCustomerMachine: [{cliente, torno, count}]
  const items = byCustomerMachine.filter(x => machineModel(x.torno) === model)
    .sort((a, b) => a.torno.localeCompare(b.torno));
  const lines = [
    '---',
    `model: ${model}`,
    `generated: ${new Date().toISOString()}`,
    `machine_count: ${items.length}`,
    'auto: true',
    '---',
    '',
    AUTO_HEADER,
    '',
    `# ${model}`,
    '',
    `**Total machines:** ${items.length}`,
    '',
    '## Listado',
    '',
  ];
  if (!items.length) {
    lines.push('_Sin máquinas registradas._');
  } else {
    for (const x of items) {
      lines.push(`- [[${x.cliente}/${x.torno}|${x.torno}]] — ${x.cliente} (${x.count} interv.)`);
    }
  }
  return lines.join('\n') + '\n';
}

function rebuild() {
  const start = Date.now();
  const raw = fs.readFileSync(RECORDS_PATH, 'utf8');
  const records = JSON.parse(raw);

  // Group by customer
  const byCustomer = new Map();
  for (const r of records) {
    const c = (r.cliente || '').trim();
    if (!c) continue;
    if (!byCustomer.has(c)) byCustomer.set(c, []);
    byCustomer.get(c).push(r);
  }

  // Wipe customer/machine generated content but PRESERVE Notas manuales.md
  // For a clean rebuild we remove every generated file (auto: true) and any
  // customer folder no longer in the DB.
  const dbCustomers = new Set(byCustomer.keys());
  if (fs.existsSync(CUSTOMERS_DIR)) {
    for (const dirent of fs.readdirSync(CUSTOMERS_DIR, { withFileTypes: true })) {
      if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
      const folder = path.join(CUSTOMERS_DIR, dirent.name);
      if (!dbCustomers.has(dirent.name)) {
        // Customer no longer exists — drop entire folder
        fs.rmSync(folder, { recursive: true, force: true });
        continue;
      }
      // Remove generated files (everything except Notas manuales.md and dotfiles)
      for (const f of fs.readdirSync(folder)) {
        if (f === 'Notas manuales.md' || f.startsWith('.')) continue;
        try { fs.unlinkSync(path.join(folder, f)); } catch {}
      }
    }
  }

  fs.mkdirSync(CUSTOMERS_DIR, { recursive: true });
  fs.mkdirSync(MACHINES_DIR, { recursive: true });

  const machineIndex = []; // {cliente, torno, count}

  for (const [cliente, recs] of byCustomer) {
    const folder = path.join(CUSTOMERS_DIR, sanitizeFs(cliente));
    fs.mkdirSync(folder, { recursive: true });

    // Group records by machine for this customer
    const byMachine = new Map();
    for (const r of recs) {
      const m = (r.torno || '').trim() || 'Sin máquina';
      if (!byMachine.has(m)) byMachine.set(m, []);
      byMachine.get(m).push(r);
    }

    // Customer overview
    fs.writeFileSync(
      path.join(folder, `${sanitizeFs(cliente)}.md`),
      buildCustomerOverview(cliente, new Set([...byMachine.keys()].filter(m => m !== 'Sin máquina')), recs)
    );

    // Per-machine notes
    for (const [torno, mRecs] of byMachine) {
      const fname = sanitizeFs(torno) + '.md';
      fs.writeFileSync(path.join(folder, fname), buildMachineNote(cliente, torno, mRecs));
      if (torno !== 'Sin máquina') {
        machineIndex.push({ cliente, torno, count: mRecs.length });
      }
    }
  }

  // Machine model indexes
  for (const model of ['R200', 'R250', 'R300', 'R400']) {
    fs.writeFileSync(path.join(MACHINES_DIR, `${model}.md`), buildMachineIndex(model, machineIndex));
  }

  const ms = Date.now() - start;
  console.log(`[${new Date().toISOString()}] rebuilt: ${byCustomer.size} customers, ${machineIndex.length} machines, ${records.length} records in ${ms}ms`);
}

// --- watch loop --------------------------------------------------------

let debounceTimer = null;
function scheduleRebuild() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    try { rebuild(); }
    catch (e) { console.error('[obsidian-export] rebuild failed:', e.message); }
  }, 500);
}

if (require.main === module) {
  // Initial rebuild
  try { rebuild(); }
  catch (e) { console.error('[obsidian-export] initial rebuild failed:', e.message); process.exit(1); }

  if (process.argv.includes('--once')) {
    process.exit(0);
  }

  // Watch records.json for changes
  fs.watch(RECORDS_PATH, { persistent: true }, (event) => {
    if (event === 'change' || event === 'rename') {
      scheduleRebuild();
    }
  });

  // Re-attach watcher periodically if file was renamed/replaced (atomic writes)
  setInterval(() => {
    try {
      fs.accessSync(RECORDS_PATH);
    } catch {
      console.error('[obsidian-export] records.json missing, will retry');
    }
  }, 30000);

  console.log('[obsidian-export] watching', RECORDS_PATH);
}

module.exports = { rebuild };
