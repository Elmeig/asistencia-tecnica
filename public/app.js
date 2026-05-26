/* ─── Theme ────────────────────────────────────────── */
const themes = ['light', 'mid', 'dark'];
const themeIcons = { light: '🌙', mid: '🌗', dark: '☀️' };
let currentTheme = localStorage.getItem('theme') || 'light';

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-toggle').textContent = themeIcons[theme];
  localStorage.setItem('theme', theme);
}

function cycleTheme() {
  const idx = themes.indexOf(currentTheme);
  const next = themes[(idx + 1) % themes.length];
  applyTheme(next);
}

// Apply saved theme on load
applyTheme(currentTheme);

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
let _editId = null; // ID of record being edited, null if adding new
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

  // Re-apply cascade select placeholders (they contain translated labels)
  populateSelect('f-torno', _cascadeData.machines, '— ' + t('machine') + ' —');
  populateSelect('f-tecnico', _cascadeData.technicians, '— ' + t('technician') + ' —');
  populateSelect('new-torno', _cascadeData.machines, '— ' + t('machine') + ' —');
  populateSelect('new-tecnico', _cascadeData.technicians, '— ' + t('technician') + ' —');

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

async function updateRecord(id, data) {
  const res = await fetch(`${API}/records/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { ok: res.ok, data: await res.json() };
}

async function deleteRecordApi(id) {
  const res = await fetch(`${API}/records/${id}`, { method: 'DELETE' });
  return { ok: res.ok, data: await res.json() };
}

async function fetchUniqueValues(customerFilter = '') {
  const params = customerFilter ? `?cliente=${encodeURIComponent(customerFilter)}` : '';
  const res = await fetch(`${API}/unique-values${params}`);
  return res.json();
}

async function checkSimilarCustomers(name) {
  if (!name || name.trim().length < 2) return [];
  const res = await fetch(`${API}/check-customer?name=${encodeURIComponent(name)}`);
  const data = await res.json();
  return data.similar || [];
}

/* ─── Edit / Delete record ─────────────────────────── */
function startEditRecord(r) {
  _editId = r.id;
  document.getElementById('new-cliente').value = r.cliente;
  document.getElementById('new-torno').value = r.torno;
  document.getElementById('new-tecnico').value = r.tecnico;
  document.getElementById('new-fecha').value = r.fecha;
  document.getElementById('new-comentarios').value = r.comentarios;
  document.getElementById('btn-add').textContent = '✎ Update';
  document.getElementById('btn-add').classList.add('btn-update');
  const cancelBtn = document.getElementById('btn-cancel-edit');
  if (cancelBtn) cancelBtn.style.display = 'inline-block';
  switchTab('add');
  checkSimilarCustomerWarning();
}

function cancelEdit() {
  _editId = null;
  document.getElementById('new-cliente').value = '';
  document.getElementById('new-torno').value = '';
  document.getElementById('new-tecnico').value = '';
  document.getElementById('new-fecha').value = new Date().toISOString().slice(0, 10);
  document.getElementById('new-comentarios').value = '';
  document.getElementById('btn-add').textContent = t('addBtn');
  document.getElementById('btn-add').classList.remove('btn-update');
  const cancelBtn = document.getElementById('btn-cancel-edit');
  if (cancelBtn) cancelBtn.style.display = 'none';
  document.getElementById('similar-warning').style.display = 'none';
  onNewRecordCustomerChange();
}

async function confirmDelete(id) {
  if (!confirm('Delete this record?')) return;
  const result = await deleteRecordApi(id);
  if (result.ok) {
    await applyFilters();
  }
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

/* ─── Cascading dropdowns ──────────────────────────── */
function populateSelect(id, options, placeholder = '') {
  const el = document.getElementById(id);
  const current = el.value;
  el.innerHTML = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = placeholder;
    el.appendChild(opt);
  }
  options.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    el.appendChild(opt);
  });
  // Restore value only if it still exists in new options
  if (options.includes(current)) {
    el.value = current;
  }
}

let _cascadeData = { machines: [], technicians: [], dates: [] };

async function refreshCascadeSelects(customerFilter = '') {
  const data = await fetchUniqueValues(customerFilter);
  _cascadeData = data;

  // Filter form selects
  populateSelect('f-torno', data.machines, '— ' + t('machine') + ' —');
  populateSelect('f-tecnico', data.technicians, '— ' + t('technician') + ' —');

  // New record form selects
  populateSelect('new-torno', data.machines, '— ' + t('machine') + ' —');
  populateSelect('new-tecnico', data.technicians, '— ' + t('technician') + ' —');
}

async function onFilterCustomerInput(value) {
  // Called on every keystroke — cascades machine/technician
  await refreshCascadeSelects(value);
}

async function onFilterCustomerChange() {
  const customer = document.getElementById('f-cliente').value;
  const data = await fetchUniqueValues(customer);
  _cascadeData = data;
  populateSelect('f-torno', data.machines, '— ' + t('machine') + ' —');
  populateSelect('f-tecnico', data.technicians, '— ' + t('technician') + ' —');
  // Update filter date datalist with customer-linked dates (only the filter datalist)
  const dl = document.getElementById('date-suggestions');
  if (dl) {
    dl.innerHTML = '';
    data.dates.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      dl.appendChild(opt);
    });
  }
  // NOTE: do NOT clear machine/technician values here — we want to preserve them
}

async function onMachineChange() {
  // When machine changes, cascade to narrow technician list + re-fetch records
  const customer = document.getElementById('f-cliente').value;
  const machine = document.getElementById('f-torno').value;
  const data = await fetchUniqueValues(customer);
  _cascadeData = data;
  // Repopulate technician with only those linked to this customer+machine
  populateSelect('f-tecnico', data.technicians, '— ' + t('technician') + ' —');
  // Update date datalist with customer+machine filtered dates
  const dl = document.getElementById('date-suggestions');
  if (dl) {
    dl.innerHTML = '';
    data.dates.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      dl.appendChild(opt);
    });
  }
  // Apply filters so records update with the new machine selection
  applyFilters();
}

async function onNewRecordCustomerChange() {
  const customer = document.getElementById('new-cliente').value;
  // Reload cascade to narrow machine/technician options
  const data = await fetchUniqueValues(customer);
  _cascadeData = data;
  // Populate the new-record combobox lists for machine and technician
  _machineList = data.machines.slice();
  _technicianList = data.technicians.slice();
  // Auto-select first option if there's exactly one match
  if (_machineList.length === 1) document.getElementById('new-torno').value = _machineList[0];
  if (_technicianList.length === 1) document.getElementById('new-tecnico').value = _technicianList[0];
}

/* ─── Customer similarity warning ─────────────────── */
let _similarTimer = null;
async function checkSimilarCustomerWarning() {
  clearTimeout(_similarTimer);
  _similarTimer = setTimeout(async () => {
    const name = document.getElementById('new-cliente').value.trim();
    const warn = document.getElementById('similar-warning');
    const nameList = document.getElementById('similar-names');
    if (!name || name.length < 2) {
      warn.style.display = 'none';
      return;
    }
    const similar = await checkSimilarCustomers(name);
    if (similar.length > 0) {
      nameList.textContent = similar.map(s => `"${s}"`).join(', ');
      warn.style.display = 'block';
    } else {
      warn.style.display = 'none';
    }
  }, 350);
}

async function populateCustomerDatalist() {
  const dl = document.getElementById('customer-suggestions');
  dl.innerHTML = '';
  const unique = [...new Set(currentRecords.map(r => r.cliente).filter(Boolean))].sort();
  unique.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    dl.appendChild(opt);
  });
}

function populateDateDatalist(dates) {
  const dl1 = document.getElementById('date-suggestions');
  const dl2 = document.getElementById('date-suggestions-new');
  [dl1, dl2].forEach(dl => {
    if (!dl) return;
    dl.innerHTML = '';
    dates.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      dl.appendChild(opt);
    });
  });
}

/* ─── Customer Combobox (click to show + type to filter) ─ */
let _customerList = [];
let _customerListLoaded = false;
let _highlightedIndex = -1;

async function getCustomerList() {
  if (!_customerListLoaded) {
    try {
      const res = await fetch(`${API}/customers`);
      const data = await res.json();
      _customerList = data.customers || [];
      _customerListLoaded = true;
    } catch {
      _customerList = [];
    }
  }
  return _customerList;
}

function getDropdownId(prefix) {
  return `${prefix}-cliente-dropdown`;
}

function getInputId(prefix) {
  return `${prefix}-cliente`;
}

function toggleCustomerDropdown(prefix) {
  const input = document.getElementById(getInputId(prefix));
  const dropdown = document.getElementById(getDropdownId(prefix));
  if (dropdown.classList.contains('open')) {
    closeCustomerDropdown(prefix);
  } else {
    filterCustomerDropdown(input.value, prefix, true);
  }
}

function closeCustomerDropdown(prefix) {
  const dropdown = document.getElementById(getDropdownId(prefix));
  dropdown.classList.remove('open');
  _highlightedIndex = -1;
}

function closeAllCustomerDropdowns() {
  ['f', 'new'].forEach(p => closeCustomerDropdown(p));
}

async function filterCustomerDropdown(value, prefix, openOnEmpty = false) {
  const dropdown = document.getElementById(getDropdownId(prefix));
  const list = await getCustomerList();
  const q = value.trim().toLowerCase();

  if (!openOnEmpty && !q && dropdown.classList.contains('open')) {
    closeCustomerDropdown(prefix);
    return;
  }

  const filtered = q
    ? list.filter(c => c.toLowerCase().includes(q))
    : list;

  if (filtered.length === 0) {
    dropdown.classList.remove('open');
    return;
  }

  dropdown.innerHTML = '';
  filtered.forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    item.dataset.value = name;
    item.textContent = name;
    if (q) {
      // Highlight matching substring
      const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      item.innerHTML = name.replace(re, '<mark>$1</mark>');
    }
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent blur before selection
      selectCustomerItem(name, prefix);
    });
    item.addEventListener('mouseenter', () => {
      _highlightedIndex = i;
      updateHighlight(prefix);
    });
    dropdown.appendChild(item);
  });

  dropdown.classList.add('open');
  _highlightedIndex = -1;
}

function updateHighlight(prefix) {
  const dropdown = document.getElementById(getDropdownId(prefix));
  dropdown.querySelectorAll('.combobox-item').forEach((item, i) => {
    item.classList.toggle('highlighted', i === _highlightedIndex);
  });
}

function selectCustomerItem(name, prefix) {
  const input = document.getElementById(getInputId(prefix));
  input.value = name;
  closeCustomerDropdown(prefix);

  if (prefix === 'f') {
    onFilterCustomerChange();
    // Immediately apply filters so records update without extra click
    applyFilters();
  } else {
    onNewRecordCustomerChange();
  }
  checkSimilarCustomerWarning();
}

function handleCustomerKeydown(event, prefix) {
  const dropdown = document.getElementById(getDropdownId(prefix));
  const items = dropdown.querySelectorAll('.combobox-item');
  if (!dropdown.classList.contains('open')) {
    if (event.key === 'ArrowDown' || event.key === 'Enter') {
      filterCustomerDropdown('', prefix, true);
    }
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    _highlightedIndex = Math.min(_highlightedIndex + 1, items.length - 1);
    updateHighlight(prefix);
    items[_highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    _highlightedIndex = Math.max(_highlightedIndex - 1, -1);
    updateHighlight(prefix);
    if (_highlightedIndex === -1) {
      document.getElementById(getInputId(prefix)).focus();
    }
  } else if (event.key === 'Enter') {
    if (_highlightedIndex >= 0 && items[_highlightedIndex]) {
      selectCustomerItem(items[_highlightedIndex].dataset.value, prefix);
    }
    closeCustomerDropdown(prefix);
  } else if (event.key === 'Escape') {
    closeCustomerDropdown(prefix);
  } else if (event.key === 'Tab') {
    closeCustomerDropdown(prefix);
  }
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.combobox-wrap')) {
    closeAllCustomerDropdowns();
    closeNewMachineDropdown();
    closeNewTechnicianDropdown();
  }
});

/* ─── Machine combobox (new record form) ────────────── */
let _machineList = [];
let _machineHighlightedIndex = -1;

function closeNewMachineDropdown() {
  const dd = document.getElementById('new-torno-dropdown');
  if (!dd) return;
  dd.classList.remove('open');
  _machineHighlightedIndex = -1;
}

function openNewMachineDropdown() {
  const input = document.getElementById('new-torno');
  const dd = document.getElementById('new-torno-dropdown');
  dd.innerHTML = '';
  if (_machineList.length === 0) {
    dd.classList.remove('open');
    return;
  }
  _machineList.forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    item.dataset.value = name;
    item.textContent = name;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectNewMachineItem(name); });
    item.addEventListener('mouseenter', () => { _machineHighlightedIndex = i; updateMachineHighlight(); });
    dd.appendChild(item);
  });
  dd.classList.add('open');
  _machineHighlightedIndex = -1;
}

function filterNewMachineDropdown(value) {
  const input = document.getElementById('new-torno');
  const dd = document.getElementById('new-torno-dropdown');
  const q = value.trim().toLowerCase();
  if (!q) { closeNewMachineDropdown(); return; }
  const filtered = _machineList.filter(m => m.toLowerCase().includes(q));
  if (filtered.length === 0) { dd.classList.remove('open'); return; }
  dd.innerHTML = '';
  filtered.forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    item.dataset.value = name;
    item.textContent = name;
    if (q) {
      const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      item.innerHTML = name.replace(re, '<mark>$1</mark>');
    }
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectNewMachineItem(name); });
    item.addEventListener('mouseenter', () => { _machineHighlightedIndex = i; updateMachineHighlight(); });
    dd.appendChild(item);
  });
  dd.classList.add('open');
  _machineHighlightedIndex = -1;
}

function updateMachineHighlight() {
  const dd = document.getElementById('new-torno-dropdown');
  dd.querySelectorAll('.combobox-item').forEach((item, i) => {
    item.classList.toggle('highlighted', i === _machineHighlightedIndex);
  });
}

function selectNewMachineItem(name) {
  document.getElementById('new-torno').value = name;
  closeNewMachineDropdown();
}

function handleNewMachineKeydown(event) {
  const dd = document.getElementById('new-torno-dropdown');
  const items = [...dd.querySelectorAll('.combobox-item')];
  if (!dd.classList.contains('open')) {
    if (event.key === 'ArrowDown' || event.key === 'Enter') openNewMachineDropdown();
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    _machineHighlightedIndex = Math.min(_machineHighlightedIndex + 1, items.length - 1);
    updateMachineHighlight();
    items[_machineHighlightedIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    _machineHighlightedIndex = Math.max(_machineHighlightedIndex - 1, -1);
    updateMachineHighlight();
  } else if (event.key === 'Enter') {
    if (_machineHighlightedIndex >= 0 && items[_machineHighlightedIndex]) {
      selectNewMachineItem(items[_machineHighlightedIndex].dataset.value);
    }
    closeNewMachineDropdown();
  } else if (event.key === 'Escape') {
    closeNewMachineDropdown();
  } else if (event.key === 'Tab') {
    closeNewMachineDropdown();
  }
}

/* ─── Technician combobox (new record form) ─────────── */
let _technicianList = [];
let _technicianHighlightedIndex = -1;

function closeNewTechnicianDropdown() {
  const dd = document.getElementById('new-tecnico-dropdown');
  if (!dd) return;
  dd.classList.remove('open');
  _technicianHighlightedIndex = -1;
}

function openNewTechnicianDropdown() {
  const dd = document.getElementById('new-tecnico-dropdown');
  dd.innerHTML = '';
  if (_technicianList.length === 0) { dd.classList.remove('open'); return; }
  _technicianList.forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    item.dataset.value = name;
    item.textContent = name;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectNewTechnicianItem(name); });
    item.addEventListener('mouseenter', () => { _technicianHighlightedIndex = i; updateTechnicianHighlight(); });
    dd.appendChild(item);
  });
  dd.classList.add('open');
  _technicianHighlightedIndex = -1;
}

function filterNewTechnicianDropdown(value) {
  const dd = document.getElementById('new-tecnico-dropdown');
  const q = value.trim().toLowerCase();
  if (!q) { closeNewTechnicianDropdown(); return; }
  const filtered = _technicianList.filter(t => t.toLowerCase().includes(q));
  if (filtered.length === 0) { dd.classList.remove('open'); return; }
  dd.innerHTML = '';
  filtered.forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    item.dataset.value = name;
    item.textContent = name;
    if (q) {
      const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      item.innerHTML = name.replace(re, '<mark>$1</mark>');
    }
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectNewTechnicianItem(name); });
    item.addEventListener('mouseenter', () => { _technicianHighlightedIndex = i; updateTechnicianHighlight(); });
    dd.appendChild(item);
  });
  dd.classList.add('open');
  _technicianHighlightedIndex = -1;
}

function updateTechnicianHighlight() {
  const dd = document.getElementById('new-tecnico-dropdown');
  dd.querySelectorAll('.combobox-item').forEach((item, i) => {
    item.classList.toggle('highlighted', i === _technicianHighlightedIndex);
  });
}

function selectNewTechnicianItem(name) {
  document.getElementById('new-tecnico').value = name;
  closeNewTechnicianDropdown();
}

function handleNewTechnicianKeydown(event) {
  const dd = document.getElementById('new-tecnico-dropdown');
  const items = [...dd.querySelectorAll('.combobox-item')];
  if (!dd.classList.contains('open')) {
    if (event.key === 'ArrowDown' || event.key === 'Enter') openNewTechnicianDropdown();
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    _technicianHighlightedIndex = Math.min(_technicianHighlightedIndex + 1, items.length - 1);
    updateTechnicianHighlight();
    items[_technicianHighlightedIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    _technicianHighlightedIndex = Math.max(_technicianHighlightedIndex - 1, -1);
    updateTechnicianHighlight();
  } else if (event.key === 'Enter') {
    if (_technicianHighlightedIndex >= 0 && items[_technicianHighlightedIndex]) {
      selectNewTechnicianItem(items[_technicianHighlightedIndex].dataset.value);
    }
    closeNewTechnicianDropdown();
  } else if (event.key === 'Escape') {
    closeNewTechnicianDropdown();
  } else if (event.key === 'Tab') {
    closeNewTechnicianDropdown();
  }
}

// Auto-apply filter when customer combobox selection changes via hidden input
const _fClienteHidden = document.getElementById('f-cliente-val');
if (_fClienteHidden) {
  const _observer = new MutationObserver(() => {
    const val = _fClienteHidden.value;
    if (val) {
      document.getElementById('f-cliente').value = val;
      onFilterCustomerChange();
      applyFilters();
    }
  });
  _observer.observe(_fClienteHidden, { attributes: true, attributeFilter: ['value'] });
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
        <td data-label="${t('description')}" class="desc-cell">
          <div class="desc-text">${escapeHtml(r.comentarios)}</div>
          <div class="desc-actions">
            <button class="btn-action btn-edit" onclick='startEditRecord(${JSON.stringify(r).replace(/'/g, "&#39;")})' title="Edit">✎</button>
            <button class="btn-action btn-delete" onclick="confirmDelete('${r.id}')" title="Delete">✕</button>
          </div>
        </td>
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
  // Reset customer text inputs
  document.getElementById('f-cliente').value = '';
  _customerList = []; // force refresh

  document.getElementById('f-torno').value = '';
  document.getElementById('f-tecnico').value = '';
  document.getElementById('f-desde').value = '';
  document.getElementById('f-hasta').value = '';
  // Reset cascade selects to show all
  refreshCascadeSelects('');
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

/* ─── Upload xlsx ─────────────────────────────────── */
function handleFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('upload-filename').textContent = file.name;
  uploadXlsx(file);
}

async function uploadXlsx(file) {
  const progress = document.getElementById('upload-progress');
  const result = document.getElementById('upload-result');
  progress.style.display = 'block';
  result.textContent = '⏳ Uploading…';
  result.className = 'feedback show';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      result.textContent = `✗ ${data.error || 'Upload failed'}`;
      result.className = 'feedback show error';
      return;
    }

    const { inserted, skipped, total } = data;
    result.innerHTML =
      `✓ Done! Inserted: <b>${inserted}</b> · Skipped (duplicates): <b>${skipped}</b> · Total records: <b>${total}</b>`;
    result.className = 'feedback show success';

    // Refresh records
    await applyFilters();

    // Clear file input after 4s
    setTimeout(() => {
      document.getElementById('upload-file').value = '';
      document.getElementById('upload-filename').textContent = '';
    }, 4000);
  } catch (err) {
    result.textContent = `✗ Network error: ${err.message}`;
    result.className = 'feedback show error';
  }
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

  if (!data.cliente || !data.tecnico) {
    showFeedback(t('required'), 'error');
    return;
  }

  let result;
  if (_editId) {
    result = await updateRecord(_editId, data);
    if (result.ok) {
      showFeedback('✓ Record updated!', 'success');
      cancelEdit();
      await applyFilters();
    } else {
      showFeedback('✗ Error updating record', 'error');
    }
  } else {
    result = await addRecord(data);
    if (result.ok) {
      showFeedback(t('addSuccess'), 'success');
      document.getElementById('new-cliente').value = '';
      document.getElementById('new-torno').value = '';
      document.getElementById('new-tecnico').value = '';
      document.getElementById('new-comentarios').value = '';
      document.getElementById('new-fecha').value = new Date().toISOString().slice(0, 10);
      document.getElementById('similar-warning').style.display = 'none';
      await applyFilters();
    } else {
      showFeedback(t('addError'), 'error');
    }
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

  // Refresh customer list cache
  _customerList = [];

  // Populate cascade selects (all values initially)
  await refreshCascadeSelects('');

  // Also seed machine/technician lists for new-record comboboxes
  if (_cascadeData) {
    _machineList = (_cascadeData.machines || []).slice();
    _technicianList = (_cascadeData.technicians || []).slice();
  }

  // Populate date datalist
  const dates = [...new Set(currentRecords.map(r => r.fecha).filter(Boolean))].sort().reverse();
  populateDateDatalist(dates);

  // Populate customer datalist for new-record autocomplete (DEPRECATED — now using combobox)

  renderPage();
})();
