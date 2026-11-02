// Employee directory: search, filters, sorting, paging, export. Redraws itself when data changes.
import { initPage, showFatal } from '../core/app-init.js';
import { ACTIONS, can } from '../core/access-control.js';
import { subscribe } from '../core/store.js';
import { DEPARTMENTS, DEPLOYMENT_STATUSES, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, ORG_ROLES } from '../core/reference-data.js';
import { toCSV } from '../core/csv.js';
import { ensureSeeded } from '../services/seed-service.js';
import { getEmployees } from '../services/employee-service.js';
import { getImportSites } from '../services/import-preview.js';
import { $, download, h, put } from '../ui/dom.js';

const session = initPage({
  pageKey: 'employees', title: 'Employees',
  crumbs: [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Employees' }],
});

const deptName = (c) => DEPARTMENTS.find((d) => d.code === c)?.name || c || '';
const roleName = (c) => ORG_ROLES.find((r) => r.code === c)?.name || c || '';

const state = {
  all: [], sites: [], q: '', page: 1, pageSize: 25, sort: { key: 'employeeID', dir: 'asc' },
  filters: { site: '', department: '', role: '', employmentType: '', status: '', deploymentStatus: '' },
};

let byId = new Map();
const managerLabel = (e) => (e.reportingManagerID ? (byId.get(e.reportingManagerID)?.employeeName || e.reportingManagerID) : '');

const COLUMNS = [
  { key: 'employeeID', label: 'Employee ID', get: (e) => e.employeeID },
  { key: 'employeeName', label: 'Name', get: (e) => e.employeeName },
  { key: 'designation', label: 'Designation', get: (e) => e.designation || '' },
  { key: 'department', label: 'Department', get: (e) => deptName(e.department) },
  { key: 'role', label: 'Role', get: (e) => roleName(e.role) },
  { key: 'currentSite', label: 'Current site', get: (e) => e.currentSite || '' },
  { key: 'employmentType', label: 'Type', get: (e) => e.employmentType || '' },
  { key: 'status', label: 'Status', get: (e) => e.status || '' },
  { key: 'deploymentStatus', label: 'Deployment', get: (e) => e.deploymentStatus || '' },
  { key: 'reportingManagerID', label: 'Reports to', get: (e) => managerLabel(e) },
];

/* ---------- filtering, sorting, paging ---------- */
function visible() {
  const q = state.q.trim().toLowerCase();
  const f = state.filters;
  const rows = state.all.filter((e) =>
    (!f.site || e.currentSite === f.site) && (!f.department || e.department === f.department) && (!f.role || e.role === f.role) &&
    (!f.employmentType || e.employmentType === f.employmentType) && (!f.status || e.status === f.status) &&
    (!f.deploymentStatus || e.deploymentStatus === f.deploymentStatus) &&
    (!q || [e.employeeID, e.employeeName, e.email, e.designation, e.phone, deptName(e.department), roleName(e.role)]
      .some((v) => String(v || '').toLowerCase().includes(q))));
  const col = COLUMNS.find((c) => c.key === state.sort.key) || COLUMNS[0];
  const dir = state.sort.dir === 'asc' ? 1 : -1;
  return rows.sort((a, b) => dir * String(col.get(a)).localeCompare(String(col.get(b)), undefined, { numeric: true, sensitivity: 'base' }));
}

const badge = (text, kind) => h('span', { class: `badge badge-${kind}`, text });
const statusBadge = (s) => badge(s, s === 'Active' ? 'ok' : s === 'On Leave' ? 'warn' : 'off');
const deployBadge = (s) => badge(s, s === 'Available' ? 'ok' : s === 'Deployed' ? 'primary' : 'off');

/* ---------- controls (drawn once, so typing never loses focus) ---------- */
function select(key, label, options) {
  return h('div', { class: 'field-row' }, h('label', { for: `f-${key}`, text: label }),
    h('select', { class: 'input', id: `f-${key}`, onchange: (e) => { state.filters[key] = e.target.value; state.page = 1; renderList(); } },
      h('option', { value: '', text: 'All' }), options.map(([v, t]) => h('option', { value: v, text: t }))));
}

function renderControls() {
  const card = $('controls');
  card.replaceChildren(
    h('div', { class: 'toolbar' },
      h('div', { class: 'field-row wide' }, h('label', { for: 'search', text: 'Search' }),
        h('input', { class: 'input', id: 'search', type: 'search', placeholder: 'Name, ID, email, designation, phone...', autocomplete: 'off',
          oninput: (e) => { state.q = e.target.value; state.page = 1; renderList(); } })),
      select('site', 'Current site', state.sites.map((s) => [s.siteCode, s.siteName])),
      select('department', 'Department', DEPARTMENTS.map((d) => [d.code, d.name])),
      select('role', 'Role', ORG_ROLES.map((r) => [r.code, r.name])),
      select('employmentType', 'Employment type', EMPLOYMENT_TYPES.map((t) => [t, t])),
      select('status', 'Status', EMPLOYEE_STATUSES.map((s) => [s, s])),
      select('deploymentStatus', 'Deployment', DEPLOYMENT_STATUSES.map((s) => [s, s])),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', id: 'reset-filters', onclick: resetFilters }, h('i', { class: 'fa-solid fa-rotate-left', 'aria-hidden': 'true' }), ' Reset'),
        can(session, ACTIONS.EXPORT_DATA) ? h('button', { class: 'btn', type: 'button', id: 'export', onclick: exportCSV }, h('i', { class: 'fa-solid fa-file-csv', 'aria-hidden': 'true' }), ' Export CSV') : null)));
}

function resetFilters() {
  state.q = ''; state.page = 1;
  Object.keys(state.filters).forEach((k) => { state.filters[k] = ''; });
  $('search').value = '';
  document.querySelectorAll('#controls select').forEach((s) => { s.value = ''; });
  renderList();
}

function exportCSV() {
  const rows = [['Employee ID', 'Name', 'Designation', 'Department', 'Role', 'Reports to (ID)', 'Phone', 'Email', 'Employment type', 'Base site',
    'Current site', 'Project', 'Status', 'Deployment status', 'Joining date', 'Experience (years)', 'Shift']];
  for (const e of visible()) {
    rows.push([e.employeeID, e.employeeName, e.designation, deptName(e.department), roleName(e.role), e.reportingManagerID || '', e.phone, e.email,
      e.employmentType, e.baseSite, e.currentSite, e.currentProject, e.status, e.deploymentStatus, e.joiningDate, e.experienceYears ?? '', e.shift]);
  }
  download('employees.csv', toCSV(rows), 'text/csv;charset=utf-8');
}

/* ---------- the list ---------- */
function headerCell(col) {
  const active = state.sort.key === col.key;
  const arrow = active ? (state.sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return h('th', { 'aria-sort': active ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
    h('button', { type: 'button', 'data-sort': col.key, onclick: () => {
      state.sort = { key: col.key, dir: active && state.sort.dir === 'asc' ? 'desc' : 'asc' };
      renderList();
    } }, col.label + arrow));
}

function renderList() {
  const card = $('list');
  card.replaceChildren();
  if (!state.all.length) {
    put(card, h('div', { class: 'empty', id: 'empty-all' },
      h('p', { text: 'There are no employees to show yet.' }),
      can(session, ACTIONS.IMPORT_UPLOAD) ? h('a', { class: 'btn btn-primary', href: 'data-management.html' }, 'Upload employees from Excel') : h('p', { class: 'small', text: 'Employees appear here once they are imported.' })));
    return;
  }
  const rows = visible();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * state.pageSize;
  const slice = rows.slice(start, start + state.pageSize);

  if (!rows.length) {
    put(card, h('div', { class: 'empty', id: 'empty-filter' }, h('p', { text: 'No employees match your search and filters.' }),
      h('button', { class: 'btn', type: 'button', onclick: resetFilters }, 'Clear search and filters')));
    return;
  }

  const body = slice.map((e) => h('tr', { 'data-id': e.employeeID },
    h('td', {}, h('a', { href: `employee-profile.html?id=${encodeURIComponent(e.employeeID)}`, text: e.employeeID })),
    h('td', { text: e.employeeName }), h('td', { text: e.designation || '' }), h('td', { text: deptName(e.department) }), h('td', { text: roleName(e.role) }),
    h('td', { text: e.currentSite || '' }), h('td', { text: e.employmentType || '' }), h('td', {}, statusBadge(e.status)),
    h('td', {}, deployBadge(e.deploymentStatus)), h('td', { text: managerLabel(e) })));

  put(card, h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'employee-table' },
    h('thead', {}, h('tr', {}, COLUMNS.map(headerCell))), h('tbody', {}, body))),
    h('div', { class: 'pager' },
      h('span', { class: 'small', id: 'range', text: `Showing ${start + 1}-${start + slice.length} of ${rows.length}${rows.length !== state.all.length ? ` (filtered from ${state.all.length})` : ''}` }),
      h('div', { class: 'row' },
        h('label', { class: 'small', for: 'page-size', text: 'Rows per page' }),
        h('select', { class: 'input', id: 'page-size', style: 'width:auto', value: String(state.pageSize), onchange: (e) => { state.pageSize = Number(e.target.value); state.page = 1; renderList(); } },
          [10, 25, 50, 100].map((n) => h('option', { value: String(n), text: String(n) }))),
        h('button', { class: 'btn btn-sm', type: 'button', id: 'prev', disabled: state.page <= 1, onclick: () => { state.page -= 1; renderList(); } }, 'Previous'),
        h('span', { class: 'small', text: `Page ${state.page} of ${pages}` }),
        h('button', { class: 'btn btn-sm', type: 'button', id: 'next', disabled: state.page >= pages, onclick: () => { state.page += 1; renderList(); } }, 'Next'))));
}

/* ---------- data ---------- */
async function load() {
  state.all = await getEmployees(session);
  byId = new Map(state.all.map((e) => [e.employeeID, e]));
  renderList();
}

async function start() {
  if (!session) return;
  try {
    await ensureSeeded();
    state.sites = await getImportSites(session);
    renderControls();
    await load();
    subscribe('employees', () => load()); // live: another page, another tab or an import changed the data
  } catch (err) {
    showFatal(err.message);
  }
}
start();
