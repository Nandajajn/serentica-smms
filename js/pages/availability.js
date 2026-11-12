// Availability: who is free, who is deployed and who is unavailable, by site and department.
import { initPage, showFatal } from '../core/app-init.js';
import { ACTIONS, can } from '../core/access-control.js';
import { subscribe } from '../core/store.js';
import { toCSV } from '../core/csv.js';
import { ensureSeeded } from '../services/seed-service.js';
import { STATES, departmentName, getAvailabilityReport } from '../services/availability-service.js';
import { $, download, h } from '../ui/dom.js';

const session = initPage({ pageKey: 'availability', title: 'Availability', crumbs: [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Availability' }] });
const LIMIT = 300;
const KIND = { [STATES.AVAILABLE]: 'ok', [STATES.DEPLOYED]: 'primary', [STATES.UNAVAILABLE]: 'off' };
const stateBadge = (s) => h('span', { class: `badge badge-${KIND[s]}`, text: s });
const state = { data: null, filter: '', site: '', dept: '', q: '' };

const table = (id, columns, rows, empty) => {
  const num = (i) => rows.length > 0 && rows.every((r) => typeof r[i] === 'number'); // only number columns are right-aligned
  return rows.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'table', id },
      h('thead', {}, h('tr', {}, columns.map((c, i) => h('th', { text: c, style: num(i) ? 'text-align:right' : null })))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.map((cell, i) => h('td', { text: String(cell), style: num(i) ? 'text-align:right' : null })))))))
    : h('p', { class: 'muted', text: empty });
};

function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.data.people.filter((p) => (!state.filter || p.state === state.filter)
    && (!state.site || p.baseSite === state.site || p.currentSite === state.site)
    && (!state.dept || p.department === state.dept)
    && (!q || [p.employeeID, p.employeeName, p.designation].some((v) => String(v || '').toLowerCase().includes(q))));
}

function renderPeople() {
  const area = $('people-area');
  if (!area) return;
  const rows = filtered();
  document.querySelectorAll('.tile').forEach((t) => t.classList.toggle('is-on', t.dataset.filter === state.filter));
  $('count').textContent = `${rows.length} of ${state.data.people.length} employees`;
  if (!rows.length) { area.replaceChildren(h('div', { class: 'empty', id: 'empty-filter' }, h('p', { text: 'No employees match.' }))); return; }
  const shown = rows.slice(0, LIMIT);
  area.replaceChildren(
    h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'people-table' },
      h('thead', {}, h('tr', {}, ['Employee', 'Department', 'Base site', 'Working at', 'State', 'Why'].map((t) => h('th', { text: t })))),
      h('tbody', {}, shown.map((p) => h('tr', { 'data-id': p.employeeID },
        h('td', {}, h('a', { href: `employee-profile.html?id=${encodeURIComponent(p.employeeID)}`, text: p.employeeName }), h('div', { class: 'muted small', text: p.employeeID })),
        h('td', { text: departmentName(p.department) }), h('td', { text: p.baseSite }),
        h('td', { text: p.currentProject ? `${p.currentSite} / ${p.currentProject}` : p.currentSite }),
        h('td', {}, stateBadge(p.state)), h('td', { class: 'wrap muted', text: p.reason || (p.state === STATES.AVAILABLE ? 'Free to deploy' : '') })))))),
    ...(rows.length > LIMIT ? [h('p', { class: 'muted small', text: `Showing the first ${LIMIT}. Narrow the filters or export the list to see everyone.` })] : []));
}

function exportList() {
  const rows = filtered();
  const csv = toCSV([['Employee ID', 'Name', 'Department', 'Base site', 'Current site', 'Current project', 'State', 'Why'],
    ...rows.map((p) => [p.employeeID, p.employeeName, departmentName(p.department), p.baseSite, p.currentSite, p.currentProject || '', p.state, p.reason])]);
  download(`smms-availability-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
}

function render() {
  const d = state.data;
  const t = d.totals;
  const tile = (key, label, n) => h('button', { class: 'tile', type: 'button', 'data-filter': key,
    onclick: () => { state.filter = state.filter === key ? '' : key; renderPeople(); } }, h('b', { text: String(n) }), h('span', { class: 'small muted', text: label }));
  const siteOptions = d.bySite.map((s) => s.site);
  const deptOptions = d.byDepartment.map((x) => x.department);

  $('view').replaceChildren(
    h('div', { class: 'page-head' }, h('h1', { text: 'Availability' }),
      h('p', { text: 'Who can be deployed now, who is already deployed, and who is unavailable. Available means Active, marked Available and not on an active deployment. Exited employees are not counted.' })),
    h('div', { class: 'stack' },
      h('div', { class: 'tiles', id: 'tiles' },
        tile(STATES.AVAILABLE, 'Available now', t.available), tile(STATES.DEPLOYED, 'Deployed', t.deployed),
        tile(STATES.UNAVAILABLE, 'Unavailable (leave, inactive)', t.unavailable), tile('', 'All employees in your sites', t.headcount)),
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h2', { text: 'By site' }),
          table('site-table', ['Site', 'Base headcount', 'Available', 'Deployed', 'Unavailable', 'Deployed in'],
            d.bySite.map((s) => [s.site, s.headcount, s.available, s.deployed, s.unavailable, s.deployedIn]), 'No sites in your scope.'),
          h('p', { class: 'muted small', text: 'Base headcount counts people whose home site is this site. "Deployed in" counts people from other sites working here now.' })),
        h('div', { class: 'card' }, h('h2', { text: 'Who is deployed where' }),
          table('alloc-table', ['Site', 'Project', 'People'], d.allocation.map((a) => [a.site, a.project, a.count]), 'Nobody is deployed right now.'))),
      h('div', { class: 'card' }, h('h2', { text: 'By department' }),
        table('dept-table', ['Department', 'Headcount', 'Available', 'Deployed', 'Unavailable'],
          d.byDepartment.map((x) => [x.name, x.headcount, x.available, x.deployed, x.unavailable]), 'No employees yet. Import employees from Excel first.')),
      h('div', { class: 'card' }, h('h2', { text: 'Employees' }),
        h('div', { class: 'toolbar' },
          h('div', { class: 'field-row' }, h('label', { for: 'q', text: 'Search' }),
            h('input', { class: 'input', id: 'q', type: 'search', placeholder: 'Name, ID or designation', autocomplete: 'off', value: state.q, oninput: (e) => { state.q = e.target.value; renderPeople(); } })),
          h('div', { class: 'field-row' }, h('label', { for: 'f-site', text: 'Site' }),
            h('select', { class: 'input', id: 'f-site', onchange: (e) => { state.site = e.target.value; renderPeople(); } }, h('option', { value: '', text: 'All sites' }), siteOptions.map((s) => h('option', { value: s, text: s })))),
          h('div', { class: 'field-row' }, h('label', { for: 'f-dept', text: 'Department' }),
            h('select', { class: 'input', id: 'f-dept', onchange: (e) => { state.dept = e.target.value; renderPeople(); } }, h('option', { value: '', text: 'All departments' }), deptOptions.map((c) => h('option', { value: c, text: departmentName(c) })))),
          h('div', { class: 'field-row' }, h('label', { for: 'f-state', text: 'State' }),
            h('select', { class: 'input', id: 'f-state', onchange: (e) => { state.filter = e.target.value; renderPeople(); } }, h('option', { value: '', text: 'All' }), Object.values(STATES).map((s) => h('option', { value: s, text: s }))))),
        h('div', { class: 'row', style: 'margin-top:12px;justify-content:space-between' }, h('span', { id: 'count', class: 'muted small' }),
          can(session, ACTIONS.EXPORT_DATA) ? h('button', { class: 'btn', type: 'button', id: 'export', onclick: exportList }, h('i', { class: 'fa-solid fa-file-csv', 'aria-hidden': 'true' }), ' Export CSV') : null),
        h('div', { id: 'people-area', style: 'margin-top:12px' }))));
  $('f-state').value = state.filter; $('f-site').value = state.site; $('f-dept').value = state.dept;
  renderPeople();
}

async function load() {
  state.data = await getAvailabilityReport(session);
  render();
}

if (session) {
  try {
    await ensureSeeded();
    await load();
    subscribe('employees', () => load().catch((e) => showFatal(e.message)));
  } catch (err) { showFatal(err.message); }
}
