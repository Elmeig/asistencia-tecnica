const API = '.';

let records = [];
let filteredRecords = [];
let editingId = null;
let sidebarOpen = false;

// DOM References
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Loading overlay
function showLoading() { $('.loading-overlay').classList.add('visible'); }
function hideLoading() { $('.loading-overlay').classList.remove('visible'); }

// Toast notifications
function showToast(message, type = 'success') {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 3000);
}

// Load records from API
async function loadRecords() {
    showLoading();
    try {
        const res = await fetch(API + '/api/records');
        if (!res.ok) throw new Error(res.statusText);
        records = await res.json();
        applyFilters();
        updateStats();
        populateFilterDropdowns();
        populateDatalists();
    } catch (e) {
        console.error('Error loading records:', e);
        showToast('Error al cargar registros', 'error');
    }
    hideLoading();
}

// Update stats in header
function updateStats() {
    var now = new Date();
    var month = now.getMonth();
    var year = now.getFullYear();

    var monthCount = records.filter(function(r) {
        if (!r.date) return false;
        var d = new Date(r.date);
        return d.getMonth() === month && d.getFullYear() === year;
    }).length;

    $('#stat-total').textContent = 'Total: ' + records.length;
    $('#stat-month').textContent = 'Mes: ' + monthCount;
}

// Get technician color class
function getTechColorClass(techName) {
    if (!techName) return '';
    const name = techName.toUpperCase().split('/')[0].trim(); // Handle combined names like "MEHDI/JESUS"
    const techColors = {
        'RICARDO': 'tech-ricardo',
        'MEHDI': 'tech-mehdi', 
        'JAIME': 'tech-jaime',
        'JESUS': 'tech-jesus',
        'AMIN': 'tech-amin',
        'MARCELO': 'tech-marcelo',
        'TAMARA': 'tech-tamara',
        'FELIX': 'tech-felix',
        'FRAN': 'tech-fran',
        'VICTOR': 'tech-victor'
    };
    return techColors[name] || '';
}

// Populate filter dropdowns
function populateFilterDropdowns() {
    var clients = [...new Set(records.map(function(r) { return r.client; }).filter(Boolean))].sort();
    var machines = [...new Set(records.map(function(r) { return r.machine; }).filter(Boolean))].sort();
    var techs = [...new Set(records.map(function(r) { return r.tech; }).filter(Boolean))].sort();

    var fillSelect = function(id, items) {
        var sel = $(id);
        var current = sel.value;
        sel.innerHTML = '<option value="">Todos</option>';
        items.forEach(function(item) {
            var opt = document.createElement('option');
            opt.value = item;
            opt.textContent = item;
            sel.appendChild(opt);
        });
        sel.value = current;
    };

    fillSelect('#filter-client', clients);
    fillSelect('#filter-machine', machines);
    fillSelect('#filter-tech', techs);
}

// Populate datalists for autocomplete
function populateDatalists() {
    var clients = [...new Set(records.map(function(r) { return r.client; }).filter(Boolean))].sort();
    var machines = [...new Set(records.map(function(r) { return r.machine; }).filter(Boolean))].sort();

    var fillDatalist = function(id, items) {
        var dl = $(id);
        dl.innerHTML = '';
        items.forEach(function(item) {
            var opt = document.createElement('option');
            opt.value = item;
            dl.appendChild(opt);
        });
    };

    fillDatalist('#list-clients', clients);
    fillDatalist('#list-machines', machines);
}

// Apply all filters
function applyFilters() {
    var clientFilter = $('#filter-client').value;
    var machineFilter = $('#filter-machine').value;
    var techFilter = $('#filter-tech').value;
    var dateFrom = $('#filter-date-from').value;
    var dateTo = $('#filter-date-to').value;
    var searchQuery = ($('#global-search-input').value || '').toLowerCase().trim();

    filteredRecords = records.filter(function(r) {
        if (clientFilter && r.client !== clientFilter) return false;
        if (machineFilter && r.machine !== machineFilter) return false;
        if (techFilter && r.tech !== techFilter) return false;
        if (dateFrom && r.date < dateFrom) return false;
        if (dateTo && r.date > dateTo) return false;
        if (searchQuery) {
            var searchable = [r.client, r.machine, r.tech, r.comments, r.date]
                .filter(Boolean).join(' ').toLowerCase();
            if (!searchable.includes(searchQuery)) return false;
        }
        return true;
    });

    // Sort by date descending
    filteredRecords.sort(function(a, b) {
        return (b.date || '').localeCompare(a.date || '');
    });

    renderRecords();
}

// Render filtered records to the DOM with new card design
function renderRecords() {
    var container = $('#records-container');
    container.innerHTML = '';

    if (!filteredRecords.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p>No se encontraron registros</p></div>';
        return;
    }

    filteredRecords.forEach(function(r) {
        var row = document.createElement('div');
        row.className = 'record-card';
        row.dataset.id = r.id;

        var techColorClass = getTechColorClass(r.tech);

        row.innerHTML =
            '<div class="record-card-header" data-id="' + r.id + '">' +
                '<div class="card-info-left">' +
                    '<div class="client-name">' + (r.client || '') + '</div>' +
                    '<div class="machine-name">' + (r.machine || '') + '</div>' +
                '</div>' +
                '<div class="card-info-right">' +
                    '<div class="tech-name ' + techColorClass + '">' + (r.tech || '') + '</div>' +
                    '<div class="record-date">' + (r.date || '') + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="record-card-body">' +
                '<div class="record-comments">' + escapeHtml(r.comments || '') + '</div>' +
                '<div class="record-actions">' +
                    '<button class="btn-icon btn-edit" data-id="' + r.id + '" title="Editar">✏️</button>' +
                    '<button class="btn-icon btn-delete" data-id="' + r.id + '" title="Eliminar">🗑️</button>' +
                '</div>' +
            '</div>';

        container.appendChild(row);
    });
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Open modal for add or edit
function openModal(id) {
    editingId = id || null;
    var overlay = $('#modal-record');
    overlay.classList.add('visible');

    if (editingId) {
        $('#modal-title').textContent = 'Editar Asistencia';
        var rec = records.find(function(r) { return r.id === editingId; });
        if (rec) {
            $('#form-client').value = rec.client || '';
            $('#form-machine').value = rec.machine || '';
            $('#form-date').value = rec.date || '';
            $('#form-tech').value = rec.tech || '';
            $('#form-comments').value = rec.comments || '';
        }
    } else {
        $('#modal-title').textContent = 'Nueva Asistencia';
        $('#record-form').reset();
        var today = new Date().toISOString().split('T')[0];
        $('#form-date').value = today;
    }
}

function closeModal() {
    $('#modal-record').classList.remove('visible');
    editingId = null;
}

// Save record (create or update)
async function saveRecord(e) {
    e.preventDefault();
    var data = {
        client: $('#form-client').value.trim(),
        machine: $('#form-machine').value.trim(),
        date: $('#form-date').value.trim(),
        tech: $('#form-tech').value.trim(),
        comments: $('#form-comments').value.trim(),
    };

    showLoading();
    try {
        var res;
        if (editingId) {
            res = await fetch(API + '/api/records/' + editingId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
        } else {
            res = await fetch(API + '/api/records', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
        }

        if (!res.ok) {
            var err = await res.json().catch(function() { return {}; });
            throw new Error(err.error || res.statusText);
        }

        closeModal();
        await loadRecords();
        showToast(editingId ? 'Registro actualizado' : 'Registro creado', 'success');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
    hideLoading();
}

// Delete record
async function deleteRecord(id) {
    if (!confirm('¿Eliminar este registro?')) return;

    showLoading();
    try {
        var res = await fetch(API + '/api/records/' + id, { method: 'DELETE' });
        if (!res.ok) throw new Error('Error al eliminar');
        await loadRecords();
        showToast('Registro eliminado', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
    hideLoading();
}

// Export to Excel (CSV)
function exportToCSV() {
    var data = filteredRecords.length ? filteredRecords : records;
    if (!data.length) {
        showToast('No hay datos para exportar', 'error');
        return;
    }

    var headers = ['Fecha', 'Cliente', 'Maquina', 'Tecnico', 'Comentarios'];
    var rows = data.map(function(r) {
        return [r.date || '', r.client || '', r.machine || '', r.tech || '', (r.comments || '').replace(/\n/g, ' ')]
            .map(function(v) { return '"' + v.replace(/"/g, '""') + '"'; })
            .join(',');
    });

    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    var datestr = new Date().toISOString().split('T')[0];
    a.download = 'asistencia_' + datestr + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exportado correctamente', 'success');
}

// Toggle sidebar
function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    $('#sidebar').classList.toggle('open');
    $('#sidebar-backdrop').classList.toggle('visible');
}

function closeSidebar() {
    sidebarOpen = false;
    $('#sidebar').classList.remove('open');
    $('#sidebar-backdrop').classList.remove('visible');
}

// Toggle theme
function toggleTheme() {
    var html = document.documentElement;
    var isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    $('#btn-theme').textContent = isDark ? '☀️' : '🌙';
}

// ====== EVENT LISTENERS ======

document.addEventListener('DOMContentLoaded', function() {
    // Load initial data
    loadRecords();

    // Header: sidebar toggle
    var btnToggle = $('#btn-sidebar-toggle');
    if (btnToggle) btnToggle.addEventListener('click', toggleSidebar);

    // Header: add record
    var btnAdd = $('#btn-add-record');
    if (btnAdd) btnAdd.addEventListener('click', function() { openModal(); });

    // Header: theme toggle
    var btnTheme = $('#btn-theme');
    if (btnTheme) btnTheme.addEventListener('click', toggleTheme);

    // Header: search
    var searchInput = $('#global-search-input');
    var searchClear = $('#global-search-clear');
    if (searchInput) {
        var debounce;
        searchInput.addEventListener('input', function() {
            clearTimeout(debounce);
            debounce = setTimeout(applyFilters, 300);
            searchClear.style.display = searchInput.value ? 'inline' : 'none';
        });
    }
    if (searchClear) {
        searchClear.addEventListener('click', function() {
            searchInput.value = '';
            searchClear.style.display = 'none';
            applyFilters();
        });
    }

    // Sidebar: close
    var btnClose = $('#btn-sidebar-close');
    if (btnClose) btnClose.addEventListener('click', closeSidebar);

    // Sidebar: backdrop click
    var backdrop = $('#sidebar-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeSidebar);

    // Sidebar: filters
    $('#filter-client').addEventListener('change', applyFilters);
    $('#filter-machine').addEventListener('change', applyFilters);
    $('#filter-tech').addEventListener('change', applyFilters);
    $('#filter-date-from').addEventListener('change', applyFilters);
    $('#filter-date-to').addEventListener('change', applyFilters);

    // Clear filters
    var btnClear = $('#btn-clear-filters');
    if (btnClear) {
        btnClear.addEventListener('click', function() {
            $('#filter-client').value = '';
            $('#filter-machine').value = '';
            $('#filter-tech').value = '';
            $('#filter-date-from').value = '';
            $('#filter-date-to').value = '';
            applyFilters();
            showToast('Filtros limpiados');
        });
    }

    // Export
    var btnExport = $('#btn-export');
    if (btnExport) btnExport.addEventListener('click', exportToCSV);

    // Modal: close
    var btnCancel = $('#btn-cancel-modal');
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    var btnModalClose = $('#btn-modal-close');
    if (btnModalClose) btnModalClose.addEventListener('click', closeModal);

    // Modal: overlay click
    $('#modal-record').addEventListener('click', function(e) {
        if (e.target === $('#modal-record')) closeModal();
    });

    // Record form submit
    $('#record-form').addEventListener('submit', saveRecord);

    // Record list: click action buttons (no toggle - always visible comments)
    $('#records-container').addEventListener('click', function(e) {
        var editBtn = e.target.closest('.btn-edit');
        var deleteBtn = e.target.closest('.btn-delete');

        if (editBtn) {
            e.stopPropagation();
            openModal(editBtn.dataset.id);
        } else if (deleteBtn) {
            e.stopPropagation();
            deleteRecord(deleteBtn.dataset.id);
        }
    });

    // Keyboard: Escape closes modals/sidebar
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if ($('#modal-record').classList.contains('visible')) closeModal();
            else if (sidebarOpen) closeSidebar();
        }
    });
});
