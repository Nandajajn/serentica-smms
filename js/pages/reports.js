// Reports: pick a report, read it as a table, export it to CSV.
import { initPage, showFatal } from '../core/app-init.js';
import { ACTIONS, can } from '../core/access-control.js';
import { subscribe } from '../core/store.js';
import { ensureSeeded } from '../services/seed-service.js';
import { getReports, reportToCSV } from '../services/report-service.js';
import { $, download, h } from '../ui/dom.js';

const session = initPage({ pageKey: 'reports', title: 'Reports', crumbs: [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Reports' }] });
const state = { reports: [], key: new URLSearchParams(location.search).get('r') || 'headcount' };

function current() { return state.reports.find((r) => r.key === state.key) || state.reports[0]; }

function exportCurrent() {
  const r = current();
  download(`smms-${r.key}-${new Date().toISOString().slice(0, 10)}.csv`, reportToCSV(r), 'text/csv;charset=utf-8');
}

function renderReport() {
  const r = current();
  const area = $('report-area');
  const numeric = (i) => i > 0 && r.rows.length && r.rows.every((row) => typeof row[i] === 'number' || row[i] === '-' || /^\d+(\.\d+)?%?$/.test(String(row[i])));
  area.replaceChildren(
    h('h2', { id: 'report-title', text: r.title }),
    h('p', { class: 'muted small', id: 'report-desc', text: r.description }),
    r.rows.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'report-table' },
        h('thead', {}, h('tr', {}, r.columns.map((c, i) => h('th', { text: c, style: numeric(i) ? 'text-align:right' : null })))),
        h('tbody', {}, r.rows.map((row) => h('tr', { class: row[0] === 'Total' ? 'total-row' : null },
          row.map((cell, i) => h('td', { text: String(cell), style: numeric(i) ? 'text-align:right' : null })))))))
      : h('div', { class: 'empty', id: 'report-empty' }, h('p', { text: 'Nothing to report yet.' })),
    h('div', { class: 'row', style: 'margin-top:12px' },
      can(session, ACTIONS.EXPORT_DATA) ? h('button', { class: 'btn', type: 'button', id: 'export', onclick: exportCurrent }, h('i', { class: 'fa-solid fa-file-csv', 'aria-hidden': 'true' }), ' Export CSV') : null,
      h('span', { class: 'muted small', text: `${r.rows.length} row${r.rows.length === 1 ? '' : 's'}` })));
}

function render() {
  $('view').replaceChildren(
    h('div', { class: 'page-head' }, h('h1', { text: 'Reports' }),
      h('p', { text: 'Headcount, availability and request reports for the sites you can see. Numbers use the same rules as the Availability, Deployments and Recalls pages.' })),
    h('div', { class: 'card' },
      h('div', { class: 'toolbar' },
        h('div', { class: 'field-row' }, h('label', { for: 'report', text: 'Report' }),
          h('select', { class: 'input', id: 'report', onchange: (e) => { state.key = e.target.value; history.replaceState(null, '', `?r=${encodeURIComponent(state.key)}`); renderReport(); } },
            state.reports.map((r) => h('option', { value: r.key, text: r.title }))))),
      h('div', { id: 'report-area', style: 'margin-top:16px' })));
  $('report').value = current().key;
  renderReport();
}

async function load() {
  state.reports = await getReports(session);
  render();
}

if (session) {
  try {
    await ensureSeeded();
    await load();
    for (const topic of ['employees', 'deploymentRequests', 'recallRequests']) subscribe(topic, () => load().catch((e) => showFatal(e.message)));
  } catch (err) { showFatal(err.message); }
}
