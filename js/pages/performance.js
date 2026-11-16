// Performance: ratings by site and department, and a list of people to help choose who to deploy.
import { initPage, showFatal } from '../core/app-init.js';
import { ACTIONS, can } from '../core/access-control.js';
import { subscribe } from '../core/store.js';
import { toCSV } from '../core/csv.js';
import { ensureSeeded } from '../services/seed-service.js';
import { STATES, departmentName } from '../services/availability-service.js';
import { BANDS, STRONG_FROM, SUPPORT_BELOW, getPerformanceReport } from '../services/performance-service.js';
import { $, download, h } from '../ui/dom.js';

const session = initPage({ pageKey: 'performance', title: 'Performance', crumbs: [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Performance' }] });
const LIMIT = 300;
const BAND_KIND = { [BANDS.STRONG]: 'ok', [BANDS.SATISFACTORY]: 'primary', [BANDS.SUPPORT]: 'warn', [BANDS.NONE]: 'off' };
const state = { data: null, band: '', site: '', dept: '', avail: '', q: '' };
const num = (v) => (v === null || v === undefined ? '-' : v);

const table = (id, columns, rows, empty) => {
  const right = (i) => rows.length > 0 && rows.every((r) => typeof r[i] === 'number' || r[i] === '-'); // only number columns are right-aligned
  return rows.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'table', id },
      h('thead', {}, h('tr', {}, columns.map((c, i) => h('th', { text: c, style: right(i) ? 'text-align:right' : null })))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.map((cell, i) => h('td', { text: String(cell), style: right(i) ? 'text-align:right' : null })))))))
    : h('p', { class: 'muted', text: empty });
};

const summaryRow = (r, label) => [label, r.headcount, r.assessed, num(r.average), r.strong, r.satisfactory, r.support, r.notAssessed];
const SUMMARY_COLUMNS = (first) => [first, 'Headcount', 'Assessed', 'Average (of 5)', 'Strong', 'Satisfactory', 'Needs support', 'Not assessed'];

function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.data.people.filter((p) => (!state.band || p.band === state.band)
    && (!state.site || p.baseSite === state.site)
    && (!state.dept || p.department === state.dept)
    && (!state.avail || p.state === state.avail)
    && (!q || [p.employeeID, p.employeeName, p.designation].some((v) => String(v || '').toLowerCase().includes(q))))
    .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || a.employeeName.localeCompare(b.employeeName)); // best rated first, unassessed last
}

function renderPeople() {
  const area = $('people-area');
  if (!area) return;
  const rows = filtered();
  document.querySelectorAll('.tile').forEach((t) => t.classList.toggle('is-on', t.dataset.band === state.band));
  $('count').textContent = `${rows.length} of ${state.data.people.length} employees`;
  if (!rows.length) { area.replaceChildren(h('div', { class: 'empty', id: 'empty-filter' }, h('p', { text: 'No employees match.' }))); return; }
  const canReview = can(session, ACTIONS.REVIEW_RECORD);
  area.replaceChildren(
    h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'people-table' },
      h('thead', {}, h('tr', {}, ['Employee', 'Department', 'Base site', 'Availability', 'Latest review', 'Rating (of 5)', 'Band', canReview ? '' : null].filter((t) => t !== null).map((t) => h('th', { text: t })))),
      h('tbody', {}, rows.slice(0, LIMIT).map((p) => h('tr', { 'data-id': p.employeeID },
        h('td', {}, h('a', { href: `employee-profile.html?id=${encodeURIComponent(p.employeeID)}`, text: p.employeeName }), h('div', { class: 'muted small', text: p.employeeID })),
        h('td', { text: departmentName(p.department) }), h('td', { text: p.baseSite }),
        h('td', { text: p.state }), h('td', { text: p.latestPeriod || '-' }),
        h('td', { text: num(p.overall), style: 'text-align:right' }),
        h('td', {}, h('span', { class: `badge badge-${BAND_KIND[p.band]}`, text: p.band })),
        canReview ? h('td', {}, h('a', { href: `review-form.html?id=${encodeURIComponent(p.employeeID)}`, text: 'Record review' })) : null))))),
    ...(rows.length > LIMIT ? [h('p', { class: 'muted small', text: `Showing the first ${LIMIT}. Narrow the filters or export the list to see everyone.` })] : []));
}

function exportList() {
  const csv = toCSV([['Employee ID', 'Name', 'Department', 'Base site', 'Availability', 'Latest review', 'Rating (of 5)', 'Band', 'Reviews on record'],
    ...filtered().map((p) => [p.employeeID, p.employeeName, departmentName(p.department), p.baseSite, p.state, p.latestPeriod, p.overall ?? '', p.band, p.reviewCount])]);
  download(`smms-performance-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
}

function render() {
  const d = state.data;
  const t = d.totals;
  const tile = (key, label, n) => h('button', { class: 'tile', type: 'button', 'data-band': key,
    onclick: () => { state.band = state.band === key ? '' : key; $('f-band').value = state.band; renderPeople(); } }, h('b', { text: String(n) }), h('span', { class: 'small muted', text: label }));
  const siteOptions = d.bySite.map((s) => s.site);
  const deptOptions = d.byDepartment.map((x) => x.department);

  $('view').replaceChildren(
    h('div', { class: 'page-head' }, h('h1', { text: 'Performance' }),
      h('p', { text: `Quarterly ratings recorded by Project Managers. Each rating is the average of five criteria, scored 1 to 5. Strong is ${STRONG_FROM}.0 or more, Needs support is under ${SUPPORT_BELOW}.0. Each person is counted once, using their latest review. Use the filters to find strong people who are Available.` })),
    h('div', { class: 'stack' },
      h('div', { class: 'tiles', id: 'tiles' },
        tile(BANDS.STRONG, `Strong (${STRONG_FROM}.0 or more)`, t.strong), tile(BANDS.SATISFACTORY, 'Satisfactory', t.satisfactory),
        tile(BANDS.SUPPORT, `Needs support (under ${SUPPORT_BELOW}.0)`, t.support), tile(BANDS.NONE, 'Not assessed yet', t.notAssessed)),
      h('div', { class: 'card' }, h('h2', { text: 'By site' }),
        table('site-table', SUMMARY_COLUMNS('Site'), d.bySite.map((s) => summaryRow(s, s.site)), 'No sites in your scope.')),
      h('div', { class: 'card' }, h('h2', { text: 'By department' }),
        table('dept-table', SUMMARY_COLUMNS('Department'), d.byDepartment.map((x) => summaryRow(x, x.name)), 'No employees yet. Import employees from Excel first.'),
        h('p', { class: 'muted small', text: 'Average is taken over assessed people only. People who have not been assessed are counted separately, not as zero.' })),
      h('div', { class: 'card' }, h('h2', { text: 'Employees' }),
        h('div', { class: 'toolbar' },
          h('div', { class: 'field-row' }, h('label', { for: 'q', text: 'Search' }),
            h('input', { class: 'input', id: 'q', type: 'search', placeholder: 'Name, ID or designation', autocomplete: 'off', value: state.q, oninput: (e) => { state.q = e.target.value; renderPeople(); } })),
          h('div', { class: 'field-row' }, h('label', { for: 'f-band', text: 'Rating band' }),
            h('select', { class: 'input', id: 'f-band', onchange: (e) => { state.band = e.target.value; renderPeople(); } }, h('option', { value: '', text: 'All' }), Object.values(BANDS).map((b) => h('option', { value: b, text: b })))),
          h('div', { class: 'field-row' }, h('label', { for: 'f-avail', text: 'Availability' }),
            h('select', { class: 'input', id: 'f-avail', onchange: (e) => { state.avail = e.target.value; renderPeople(); } }, h('option', { value: '', text: 'All' }), Object.values(STATES).map((s) => h('option', { value: s, text: s })))),
          h('div', { class: 'field-row' }, h('label', { for: 'f-site', text: 'Base site' }),
            h('select', { class: 'input', id: 'f-site', onchange: (e) => { state.site = e.target.value; renderPeople(); } }, h('option', { value: '', text: 'All sites' }), siteOptions.map((s) => h('option', { value: s, text: s })))),
          h('div', { class: 'field-row' }, h('label', { for: 'f-dept', text: 'Department' }),
            h('select', { class: 'input', id: 'f-dept', onchange: (e) => { state.dept = e.target.value; renderPeople(); } }, h('option', { value: '', text: 'All departments' }), deptOptions.map((c) => h('option', { value: c, text: departmentName(c) }))))),
        h('div', { class: 'row', style: 'margin-top:12px;justify-content:space-between' }, h('span', { id: 'count', class: 'muted small' }),
          can(session, ACTIONS.EXPORT_DATA) ? h('button', { class: 'btn', type: 'button', id: 'export', onclick: exportList }, h('i', { class: 'fa-solid fa-file-csv', 'aria-hidden': 'true' }), ' Export CSV') : null),
        h('div', { id: 'people-area', style: 'margin-top:12px' }))));
  $('f-band').value = state.band; $('f-avail').value = state.avail; $('f-site').value = state.site; $('f-dept').value = state.dept;
  renderPeople();
}

async function load() {
  state.data = await getPerformanceReport(session);
  render();
}

if (session) {
  try {
    await ensureSeeded();
    await load();
    for (const topic of ['employees', 'performanceReviews']) subscribe(topic, () => load().catch((e) => showFatal(e.message)));
  } catch (err) { showFatal(err.message); }
}
