/* ─── Internationalization ─────────────────────────── */
const i18n = {
  en: {
    title: 'Technical Assistance Registry',
    subtitle: 'Remote technical assistance log',
    addTitle: 'New Record',
    customer: 'Customer',
    machine: 'Machine',
    technician: 'Technician',
    date: 'Date',
    description: 'Description',
    addBtn: 'Add Record',
    addSuccess: '✓ Record added successfully!',
    addError: '✗ Error adding record',
    filterTitle: 'Search & Filter',
    dateFrom: 'Date From',
    dateTo: 'Date To',
    searchBtn: 'Search',
    clearBtn: 'Clear',
    resultsTitle: 'Records',
    exportTitle: 'Export',
    exportDesc: 'Download the records as an Excel file (.xlsx). If filters are active, only filtered records will be exported.',
    exportBtn: '📥 Download XLSX',
    recordCount: '{count} records found',
    noRecords: 'No records found.',
    prev: '← Prev',
    next: 'Next →',
    required: 'Please fill all required fields.',
    activeFilters: 'Active filters',
  },
  es: {
    title: 'Registro de Asistencia Técnica',
    subtitle: 'Registro de asistencia técnica remota',
    addTitle: 'Nuevo Registro',
    customer: 'Cliente',
    machine: 'Torno',
    technician: 'Técnico',
    date: 'Fecha',
    description: 'Comentarios',
    addBtn: 'Añadir Registro',
    addSuccess: '✓ ¡Registro añadido con éxito!',
    addError: '✗ Error al añadir registro',
    filterTitle: 'Buscar y Filtrar',
    dateFrom: 'Fecha Desde',
    dateTo: 'Fecha Hasta',
    searchBtn: 'Buscar',
    clearBtn: 'Limpiar',
    resultsTitle: 'Registros',
    exportTitle: 'Exportar',
    exportDesc: 'Descargar los registros como archivo Excel (.xlsx). Si hay filtros activos, solo se exportarán los registros filtrados.',
    exportBtn: '📥 Descargar XLSX',
    recordCount: '{count} registros encontrados',
    noRecords: 'No se encontraron registros.',
    prev: '← Anterior',
    next: 'Siguiente →',
    required: 'Por favor completa todos los campos obligatorios.',
    activeFilters: 'Filtros activos',
  },
};

let currentLang = localStorage.getItem('lang') || 'en';
let currentRecords = [];
let currentPage = 1;
const PAGE_SIZE = 20;

function t(key) {
  return (i18n[currentLang] && i18n[currentLang][key]) || key;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('lang', lang);

  document.getElementById('btn-en').classList.toggle('active', lang === 'en');
  document.getElementById('btn-es').classList.toggle('active', lang === 'es');

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (i18n[lang][key]) el.textContent = i18n[lang][key];
  });

  updateRecordCount();
  renderPage();
  updateFilterIndicator();
}

/* ─── Tab switching ───────────────────────────────── */
function switchTab(tab) {
  // Update buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  // Update panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === 'panel-' + tab);
  });
  // Save active tab
  localStorage.setItem('activeTab', tab);
}

/* ─── API helpers ─────────────────────────────────── */
// Auto-detect base path (works both at / and /asistencia/)
const BASE = window.location.pathname.replace(/\/$/, '');
const API = BASE + '/api';

async function fetchRecords(filters = {}) {
  const params = new URLSearchParams();
  if (filters.cliente) params.set('cliente', filters.cliente);
  if (filters.torno) params.set('torno', filters.torno);
  if (filters.tecnico) params.set('tecnico', filters.tecnico);
  if (filters.desde) params.set('desde', filters.desde);
  if (filters.hasta) params.set('hasta', filters.hasta);
  const qs = params.toString();
  const url = `${API}/records${qs ? '?' + qs : ''}`;
  const res = await fetch(url);
  return res.json();
}

async function addRecord(data) {
  const res = await fetch(`${API}/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { ok: res.ok, data: await res.json() };
}

/* ─── Get current filters ─────────────────────────── */
function getFilters() {
  return {
    cliente: document.getElementById('f-cliente').value.trim(),
    torno: document.getElementById('f-torno').value.trim(),
    tecnico: document.getElementById('f-tecnico').value.trim(),
    desde: document.getElementById('f-desde').value,
    hasta: document.getElementById('f-hasta').value,
  };
}

function hasActiveFilters() {
  const f = getFilters();
  return f.cliente || f.torno || f.tecnico || f.desde || f.hasta;
}

/* ─── Filter indicator ────────────────────────────── */
function updateFilterIndicator() {
  const container = document.getElementById('active-filters');
  const tagsEl = document.getElementById('filter-tags');
  const f = getFilters();
  const tags = [];

  const labelMap = {
    cliente: () => t('customer'),
    torno: () => t('machine'),
    tecnico: () => t('technician'),
    desde: () => t('dateFrom'),
    hasta: () => t('dateTo'),
  };

  for (const [key, val] of Object.entries(f)) {
    if (val) tags.push(`<span class="filter-tag">${labelMap[key]()}: ${val}</span>`);
  }

  if (tags.length > 0) {
    tagsEl.innerHTML = tags.join(' ');
    container.style.display = 'flex';
  } else {
    container.style.display = 'none';
  }
}

/* ─── Technician color badge ──────────────────────── */
function techClass(name) {
  const n = name.toLowerCase().trim();
  if (n.includes('mehdi')) return 'tech-mehdi';
  if (n.includes('ricardo')) return 'tech-ricardo';
  if (n.includes('felix')) return 'tech-felix';
  if (n.includes('marcelo')) return 'tech-marcelo';
  if (n.includes('victor')) return 'tech-victor';
  if (n.includes('jesus')) return 'tech-jesus';
  if (n.includes('fran')) return 'tech-fran';
  if (n.includes('tamara')) return 'tech-tamara';
  if (n.includes('amin')) return 'tech-amin';
  return 'tech-other';
}

function renderTech(name) {
  return `<span class="tech-badge ${techClass(name)}">${escapeHtml(name)}</span>`;
}

/* ─── Render table ────────────────────────────────── */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateRecordCount() {
  const el = document.getElementById('record-count');
  el.textContent = t('recordCount').replace('{count}', currentRecords.length);

  // Update badge on records tab
  const badge = document.getElementById('tab-badge');
  badge.textContent = currentRecords.length;
}

function renderPage() {
  const totalPages = Math.max(1, Math.ceil(currentRecords.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRecords = currentRecords.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById('results-body');
  if (pageRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-light);padding:2rem;">${t('noRecords')}</td></tr>`;
  } else {
    tbody.innerHTML = pageRecords.map(r => `
      <tr>
        <td data-label="${t('customer')}">${escapeHtml(r.cliente)}</td>
        <td data-label="${t('machine')}">${escapeHtml(r.torno)}</td>
        <td data-label="${t('date')}">${escapeHtml(r.fecha)}</td>
        <td data-label="${t('technician')}">${renderTech(r.tecnico)}</td>
        <td data-label="${t('description')}">${escapeHtml(r.comentarios)}</td>
      </tr>
    `).join('');
  }

  updateRecordCount();
  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  ['pagination-top', 'pagination-bottom'].forEach(id => {
    const container = document.getElementById(id);
    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    let html = '';
    html += `<button onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>${t('prev')}</button>`;

    const pages = new Set();
    pages.add(1);
    pages.add(totalPages);
    for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
      pages.add(i);
    }
    const sorted = [...pages].sort((a, b) => a - b);
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) html += `<span class="page-info">…</span>`;
      html += `<button onclick="goToPage(${p})" class="${p === currentPage ? 'active' : ''}">${p}</button>`;
      prev = p;
    }

    html += `<button onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>${t('next')}</button>`;
    container.innerHTML = html;
  });
}

function goToPage(page) {
  currentPage = page;
  renderPage();
  document.getElementById('panel-records').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ─── Filter actions ──────────────────────────────── */
async function applyFilters() {
  const filters = getFilters();
  const result = await fetchRecords(filters);
  currentRecords = result.records;
  currentPage = 1;
  renderPage();
  updateFilterIndicator();
}

// Apply filters and auto-switch to records tab
async function applyFiltersAndShow() {
  await applyFilters();
  switchTab('records');
}

function clearFilters() {
  document.getElementById('f-cliente').value = '';
  document.getElementById('f-torno').value = '';
  document.getElementById('f-tecnico').value = '';
  document.getElementById('f-desde').value = '';
  document.getElementById('f-hasta').value = '';
  applyFilters();
}

/* ─── Export ──────────────────────────────────────── */
function exportXlsx() {
  const params = new URLSearchParams();
  if (hasActiveFilters()) {
    const f = getFilters();
    if (f.cliente) params.set('cliente', f.cliente);
    if (f.torno) params.set('torno', f.torno);
    if (f.tecnico) params.set('tecnico', f.tecnico);
    if (f.desde) params.set('desde', f.desde);
    if (f.hasta) params.set('hasta', f.hasta);
  }
  const qs = params.toString();
  window.location.href = `${API}/export${qs ? '?' + qs : ''}`;
}

/* ─── Add Record form ─────────────────────────────── */
function showFeedback(msg, type) {
  const el = document.getElementById('add-feedback');
  el.textContent = msg;
  el.className = `feedback show ${type}`;
  setTimeout(() => { el.classList.remove('show'); }, 3000);
}

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    cliente: document.getElementById('new-cliente').value.trim(),
    torno: document.getElementById('new-torno').value.trim(),
    tecnico: document.getElementById('new-tecnico').value.trim(),
    fecha: document.getElementById('new-fecha').value || new Date().toISOString().slice(0, 10),
    comentarios: document.getElementById('new-comentarios').value.trim(),
  };

  if (!data.cliente || !data.torno || !data.tecnico) {
    showFeedback(t('required'), 'error');
    return;
  }

  const result = await addRecord(data);
  if (result.ok) {
    showFeedback(t('addSuccess'), 'success');
    document.getElementById('new-cliente').value = '';
    document.getElementById('new-torno').value = '';
    document.getElementById('new-tecnico').value = '';
    document.getElementById('new-comentarios').value = '';
    document.getElementById('new-fecha').value = new Date().toISOString().slice(0, 10);
    // Refresh records
    await applyFilters();
  } else {
    showFeedback(t('addError'), 'error');
  }
});

/* ─── Init ────────────────────────────────────────── */
(async function init() {
  // Set today's date as default
  document.getElementById('new-fecha').value = new Date().toISOString().slice(0, 10);

  // Restore language
  setLang(currentLang);

  // Restore active tab
  const savedTab = localStorage.getItem('activeTab') || 'add';
  switchTab(savedTab);

  // Load all records
  const result = await fetchRecords();
  currentRecords = result.records;
  renderPage();
})();
