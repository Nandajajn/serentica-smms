// Data Management page: choose Excel files, preview, map columns, check, import, review history.
import { initPage, showFatal } from '../core/app-init.js';
import { ACTIONS, can } from '../core/access-control.js';
import { ROLES } from '../core/constants.js';
import { subscribe } from '../core/store.js';
import { DEPARTMENTS, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, ORG_ROLES } from '../core/reference-data.js';
import { ensureSeeded } from '../services/seed-service.js';
import { getEmployees } from '../services/employee-service.js';
import {
  FIELD_LABELS, IMPORT_FIELDS, autoMapHeaders, commitImport, getImportHistory, getUploadedFiles, readWorkbook, removeUploadedFile,
} from '../services/import-engine.js';
import { buildBatchReportCSV, buildPlanReportCSV, getImportSites, previewImport } from '../services/import-preview.js';

const session = initPage({
  pageKey: 'data-management', title: 'Data Management',
  crumbs: [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Data Management' }],
});

/* ---------- small helpers ---------- */
function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  if (value !== undefined) node.value = value;
  return node;
}
const $ = (id) => document.getElementById(id);
// Like parent.append(...) but silently skips null/false, so no stray "null" text appears.
const put = (parent, ...kids) => parent.append(...kids.flat().filter((k) => k != null && k !== false));
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : '');
const deptName = (code) => DEPARTMENTS.find((d) => d.code === code)?.name || code || '';
const roleName = (code) => ORG_ROLES.find((r) => r.code === code)?.name || code || '';

function banner(type, text) {
  const box = $('banner');
  box.className = `alert alert-${type}`;
  box.setAttribute('role', type === 'error' ? 'alert' : 'status');
  box.textContent = text;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}
const clearBanner = () => { $('banner').hidden = true; };

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- state ---------- */
const canImport = session && can(session, ACTIONS.IMPORT_UPLOAD) && can(session, ACTIONS.IMPORT_CONFIRM);
const canRemove = session && can(session, ACTIONS.FILE_REMOVE);
const state = { files: [], defaults: { baseSite: '', department: '', role: '', employmentType: '', status: '' }, useSheetAsProject: false, plan: null, sites: [], busy: false };

/* ---------- 1. choosing files ---------- */
async function addFiles(fileList) {
  clearBanner();
  const problems = [];
  for (const file of fileList) {
    if (!/\.(xlsx|xls)$/i.test(file.name)) { problems.push(`${file.name}: only .xlsx and .xls files can be used.`); continue; }
    if (state.files.some((f) => f.name === file.name)) { problems.push(`${file.name}: this file is already selected.`); continue; }
    if (file.size > 15 * 1048576) { problems.push(`${file.name}: the file is larger than 15 MB.`); continue; }
    try {
      const sheets = readWorkbook(window.XLSX, await file.arrayBuffer()).map((s) => ({
        name: s.name, headers: s.headers, rows: s.rows, mapping: autoMapHeaders(s.headers), include: s.rows.length > 0,
      }));
      state.files.push({ name: file.name, size: file.size, sheets });
    } catch (err) {
      console.error('[SMMS] Could not read workbook', file.name, err);
      problems.push(`${file.name}: the file could not be read. Is it a damaged or password-protected workbook?`);
    }
  }
  state.plan = null;
  renderUpload();
  renderResults();
  if (problems.length) banner('error', problems.join(' '));
}

function removeFile(name) {
  state.files = state.files.filter((f) => f.name !== name);
  state.plan = null;
  renderUpload();
  renderResults();
}

function clearAll() {
  state.files = [];
  state.plan = null;
  clearBanner();
  renderUpload();
  renderResults();
}

/* ---------- sample template ---------- */
function downloadTemplate() {
  const XLSX = window.XLSX;
  const rows = [
    ['Emp Code', 'Emp Name', 'Designation', 'Department', 'Role', 'Reporting Manager', 'Contact', 'Email ID', 'Onroll / Off-role', 'Site', 'Status', 'Joining Date', 'Residential District'],
    ['SAMPLE-001', 'Sample Project Manager', 'Project Manager', 'Project Management', 'Project Manager', '', '0000000001', 'sample.pm@example.com', 'On-roll', 'Koppal', 'Active', '2022-01-10', 'Koppal'],
    ['SAMPLE-002', 'Sample Civil Lead', 'Civil Lead', 'Civil', 'Lead', 'SAMPLE-001', '0000000002', 'sample.lead@example.com', 'On-roll', 'Koppal', 'Active', '2022-03-01', 'Koppal'],
    ['SAMPLE-003', 'Sample Civil Engineer', 'Civil Engineer', 'Civil', 'Employee', 'SAMPLE-002', '0000000003', 'sample.eng@example.com', 'Off-role', 'Koppal', 'Active', '2023-06-15', 'Koppal'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Employees');
  XLSX.writeFile(wb, 'employee-upload-template.xlsx');
}

/* ---------- rendering: the upload card ---------- */
function mappingEditor(sheet) {
  const summary = h('summary');
  const refresh = () => { summary.textContent = `Column mapping (${Object.keys(sheet.mapping).length} of ${IMPORT_FIELDS.length} fields matched)`; };
  refresh();
  const rows = IMPORT_FIELDS.map((field) => h('tr', {},
    h('td', { text: FIELD_LABELS[field] + (field === 'employeeID' ? ' *' : '') }),
    h('td', {}, h('select', {
      class: 'input', 'aria-label': `Excel column for ${FIELD_LABELS[field]}`, value: sheet.mapping[field] == null ? '' : String(sheet.mapping[field]),
      onchange: (e) => {
        if (e.target.value === '') delete sheet.mapping[field]; else sheet.mapping[field] = Number(e.target.value);
        state.plan = null; renderResults(); refresh();
      },
    }, h('option', { value: '', text: '(not in this file)' }), sheet.headers.map((hd, i) => h('option', { value: String(i), text: hd }))))));
  return h('details', { class: 'mapping' }, summary,
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', { text: 'Employee field' }), h('th', { text: 'Excel column' }))), h('tbody', {}, rows))));
}

function sheetPreview(sheet) {
  const head = h('tr', {}, sheet.headers.map((hd) => h('th', { text: hd })));
  const body = sheet.rows.slice(0, 5).map((r) => h('tr', {}, sheet.headers.map((_, i) => h('td', { text: r.cells[i] ?? '' }))));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, head), h('tbody', {}, body)));
}

function renderUpload() {
  const card = $('upload-card');
  card.replaceChildren(h('h2', { text: 'Upload employee data' }));

  if (!canImport) {
    put(card, h('p', { class: 'muted', text: session.systemRole === ROLES.ADMIN
      ? 'Admin accounts are read-only, so uploading is turned off. You can review the import history and uploaded files below.'
      : 'Your role cannot upload employee data. You can review the import history below.' }));
    return;
  }

  const input = h('input', { type: 'file', id: 'file-input', accept: '.xlsx,.xls', multiple: true, class: 'visually-hidden',
    onchange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } });
  const zone = h('div', { class: 'dropzone', id: 'dropzone' },
    h('p', { text: 'Drag Excel files here, or' }),
    h('div', { class: 'row', style: 'justify-content:center' },
      h('button', { class: 'btn btn-primary', type: 'button', id: 'browse', onclick: () => input.click() }, h('i', { class: 'fa-solid fa-folder-open', 'aria-hidden': 'true' }), ' Browse for Excel files'),
      h('button', { class: 'btn', type: 'button', id: 'template', onclick: downloadTemplate }, h('i', { class: 'fa-solid fa-download', 'aria-hidden': 'true' }), ' Download sample template')),
    h('p', { class: 'small muted', text: '.xlsx or .xls, up to 15 MB each. You can choose several files.' }), input);
  for (const evt of ['dragenter', 'dragover']) zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('is-over'); });
  for (const evt of ['dragleave', 'drop']) zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove('is-over'); });
  zone.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));
  put(card, zone);

  if (!state.files.length) {
    put(card, h('p', { class: 'muted small', text: 'No file selected yet.' }));
    return;
  }

  put(card, h('div', { class: 'row', style: 'justify-content:space-between;margin-top:16px' },
    h('strong', { text: `${state.files.length} file(s) selected` }),
    h('button', { class: 'btn btn-sm', type: 'button', id: 'clear-all', onclick: clearAll }, h('i', { class: 'fa-solid fa-xmark', 'aria-hidden': 'true' }), ' Clear all')));

  for (const file of state.files) {
    const box = h('div', { class: 'file-item', 'data-file': file.name },
      h('div', { class: 'file-head' },
        h('div', {}, h('strong', { text: file.name }), h('span', { class: 'muted small', text: `  ${fmtSize(file.size)}` })),
        h('button', { class: 'btn btn-sm btn-danger remove-file', type: 'button', onclick: () => removeFile(file.name) }, h('i', { class: 'fa-solid fa-trash', 'aria-hidden': 'true' }), ' Remove from selection')));
    for (const sheet of file.sheets) {
      const check = h('input', { type: 'checkbox', checked: sheet.include, disabled: sheet.rows.length === 0, 'aria-label': `Include worksheet ${sheet.name}`,
        onchange: (e) => { sheet.include = e.target.checked; state.plan = null; renderResults(); updateButtons(); } });
      box.append(h('div', { class: 'sheet' },
        h('label', { class: 'row' }, check, h('strong', { text: `Worksheet "${sheet.name}"` }),
          h('span', { class: 'muted small', text: sheet.rows.length ? `${sheet.rows.length} data rows` : 'no data rows (skipped)' })),
        sheet.rows.length ? [sheetPreview(sheet), h('p', { class: 'small muted', text: `Preview of the first ${Math.min(5, sheet.rows.length)} rows.` }), mappingEditor(sheet)] : null));
    }
    put(card, box);
  }

  /* defaults for new employees */
  const select = (key, label, options) => h('div', { class: 'field-row' }, h('label', { for: `def-${key}`, text: label }),
    h('select', { class: 'input', id: `def-${key}`, value: state.defaults[key], onchange: (e) => { state.defaults[key] = e.target.value; state.plan = null; renderResults(); } },
      h('option', { value: '', text: '(none)' }), options.map(([v, t]) => h('option', { value: v, text: t }))));
  put(card, h('div', { class: 'file-item' },
    h('strong', { text: 'Defaults for new employees' }),
    h('p', { class: 'small muted', text: 'Used only when the file has no value for a new employee. Existing employees are never changed by these defaults. Anything applied is listed in the results.' }),
    h('div', { class: 'grid' },
      select('baseSite', 'Site', state.sites.map((s) => [s.siteCode, s.siteName])),
      select('department', 'Department', DEPARTMENTS.map((d) => [d.code, d.name])),
      select('role', 'Role (level)', ORG_ROLES.map((r) => [r.code, r.name])),
      select('employmentType', 'Employment type', EMPLOYMENT_TYPES.map((t) => [t, t])),
      select('status', 'Status', EMPLOYEE_STATUSES.map((s) => [s, s]))),
    h('label', { class: 'row small', style: 'margin-top:12px' },
      h('input', { type: 'checkbox', id: 'sheet-project', checked: state.useSheetAsProject, onchange: (e) => { state.useSheetAsProject = e.target.checked; state.plan = null; renderResults(); } }),
      'Use the worksheet name as the Project (for example Wind or Solar) when the file has no Project column')));

  put(card, h('div', { class: 'row', style: 'margin-top:16px' },
    h('button', { class: 'btn btn-primary', type: 'button', id: 'check', onclick: runCheck }, h('i', { class: 'fa-solid fa-list-check', 'aria-hidden': 'true' }), ' Check data'),
    h('span', { class: 'small muted', text: 'Checking shows what would happen. Nothing is saved until you confirm.' })));
  updateButtons();
}

function includedSheets() {
  return state.files.flatMap((f) => f.sheets.filter((s) => s.include).map((s) => ({
    fileName: f.name, sheetName: s.name, headers: s.headers, rows: s.rows, mapping: s.mapping, useSheetAsProject: state.useSheetAsProject,
  })));
}
function updateButtons() {
  const btn = $('check');
  if (btn) btn.disabled = state.busy || includedSheets().length === 0;
}
const cleanDefaults = () => Object.fromEntries(Object.entries(state.defaults).filter(([, v]) => v));

/* ---------- 2. checking and importing ---------- */
async function runCheck() {
  clearBanner();
  state.busy = true; updateButtons();
  try {
    state.plan = await previewImport(session, { sheets: includedSheets(), defaults: cleanDefaults() });
  } catch (err) {
    console.error('[SMMS] Check failed', err);
    state.plan = null;
    banner('error', `The data could not be checked: ${err.message}`);
  }
  state.busy = false; updateButtons();
  renderResults();
  $('results-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function runImport() {
  const { counts } = state.plan;
  const message = `Import ${counts.new} new and ${counts.updated} updated employee record(s)?\n\n${counts.invalid} invalid row(s) will be skipped.\nThis changes the shared employee data and is recorded in the audit history.`;
  if (!window.confirm(message)) return;
  const names = new Set(includedSheets().map((s) => s.fileName));
  const files = state.files.filter((f) => names.has(f.name)).map((f) => ({
    fileName: f.name, sizeBytes: f.size, sheets: f.sheets.map((s) => ({ name: s.name, rowCount: s.rows.length })),
  }));
  state.busy = true;
  $('confirm-import').disabled = true;
  try {
    const result = await commitImport(session, { files, sheets: includedSheets(), defaults: cleanDefaults() });
    state.files = []; state.plan = null;
    renderUpload(); renderResults();
    banner('success', `Import complete: ${result.counts.new} added, ${result.counts.updated} updated, ${result.counts.unchanged} unchanged, ${result.counts.invalid} skipped as invalid. The employee data is updated everywhere.`);
  } catch (err) {
    console.error('[SMMS] Import failed', err);
    banner('error', `The import failed and nothing was saved: ${err.message}`);
    $('confirm-import').disabled = false;
  }
  state.busy = false;
}

/* ---------- rendering: results ---------- */
function table(headers, rows) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, headers.map((x) => h('th', { text: x })))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', { class: String(c).length > 40 ? 'wrap' : '', text: String(c ?? '') })))))));
}
const stat = (label, n, cls = '') => h('div', { class: `stat ${cls}` }, h('b', { text: String(n) }), h('span', { class: 'small muted', text: label }));

function renderResults() {
  const card = $('results-card');
  card.replaceChildren();
  const plan = state.plan;
  card.hidden = !plan;
  if (!plan) return;
  const { counts } = plan;
  const items = (kind) => plan.items.filter((i) => i.kind === kind);

  put(card, h('h2', { text: 'Check results' }),
    h('div', { class: 'grid' },
      stat('Rows read', counts.total), stat('New employees', counts.new, 'good'), stat('Updated', counts.updated, 'good'),
      stat('Unchanged', counts.unchanged), stat('Invalid (skipped)', counts.invalid, counts.invalid ? 'bad' : ''), stat('With warnings', counts.warnings, counts.warnings ? 'warn' : '')));

  if (plan.defaultsUsed.length) put(card, h('h3', { text: 'Defaults that were applied', style: 'margin-top:16px' }),
    h('ul', {}, plan.defaultsUsed.map((d) => h('li', { text: `${FIELD_LABELS[d.field]}: "${d.value}" used for ${d.rows} new employee(s) with no value in the file.` }))));
  if (plan.notes.length) put(card, h('div', { class: 'alert alert-warning', style: 'margin-top:12px' }, plan.notes.map((n) => h('div', { text: n }))));

  const invalid = items('invalid');
  if (invalid.length) put(card, h('h3', { text: `Invalid rows (${invalid.length}) - these will be skipped`, style: 'margin-top:16px' }),
    table(['File', 'Worksheet', 'Row', 'Employee ID', 'Problems'], invalid.slice(0, 200).map((i) => [i.fileName, i.sheetName, i.rowNumber, i.employeeID, i.errors.join(' | ')])),
    invalid.length > 200 ? h('p', { class: 'small muted', text: 'Showing the first 200. Download the report for the full list.' }) : null);

  const updated = items('updated');
  if (updated.length) put(card, h('h3', { text: `Existing employees that would change (${updated.length})`, style: 'margin-top:16px' }),
    table(['Employee ID', 'Worksheet / row', 'Field', 'Before', 'After'], updated.slice(0, 100).flatMap((i) =>
      Object.entries(i.changes).map(([f, c]) => [i.employeeID, `${i.sheetName} / ${i.rowNumber}`, FIELD_LABELS[f] || f, c.from ?? '(empty)', c.to ?? '(empty)']))),
    updated.length > 100 ? h('p', { class: 'small muted', text: 'Showing the first 100 employees. Download the report for all.' }) : null);

  const added = items('new');
  if (added.length) put(card, h('h3', { text: `New employees (${added.length})`, style: 'margin-top:16px' }),
    table(['Employee ID', 'Name', 'Department', 'Role', 'Site', 'Type', 'Reports to'], added.slice(0, 50).map((i) => [
      i.employeeID, i.record.employeeName, deptName(i.record.department), roleName(i.record.role), i.record.baseSite, i.record.employmentType, i.record.reportingManagerID || ''])),
    added.length > 50 ? h('p', { class: 'small muted', text: 'Showing the first 50 new employees.' }) : null);

  const warned = plan.items.filter((i) => i.warnings.length);
  if (warned.length) put(card, h('h3', { text: `Warnings (${warned.length}) - these rows are still imported`, style: 'margin-top:16px' }),
    table(['Worksheet', 'Row', 'Employee ID', 'Warning'], warned.slice(0, 100).map((i) => [i.sheetName, i.rowNumber, i.employeeID, i.warnings.join(' | ')])));

  put(card, h('div', { class: 'row', style: 'margin-top:20px' },
    h('button', { class: 'btn btn-primary', type: 'button', id: 'confirm-import', disabled: counts.new + counts.updated === 0, onclick: runImport },
      h('i', { class: 'fa-solid fa-check', 'aria-hidden': 'true' }), ` Confirm import (${counts.new + counts.updated} record${counts.new + counts.updated === 1 ? '' : 's'})`),
    h('button', { class: 'btn', type: 'button', id: 'download-report', onclick: () => download('import-check-report.csv', buildPlanReportCSV(plan), 'text/csv;charset=utf-8') },
      h('i', { class: 'fa-solid fa-file-csv', 'aria-hidden': 'true' }), ' Download report (CSV)'),
    counts.new + counts.updated === 0 ? h('span', { class: 'small muted', text: 'Nothing to import: fix the problems above, or change the column mapping or defaults.' }) : null));
}

/* ---------- 3. history and uploaded files (live) ---------- */
async function renderHistory() {
  const card = $('history-card');
  const batches = await getImportHistory(session);
  const employees = await getEmployees(session);
  card.replaceChildren(h('h2', { text: 'Import history' }),
    h('p', { class: 'small muted', id: 'employee-count', text: `Employees currently in the system: ${employees.length}` }));
  if (!batches.length) { put(card, h('p', { class: 'muted', id: 'history-empty', text: 'No imports yet.' })); return; }
  put(card, table(['Date', 'File', 'Worksheet', 'Status', 'New', 'Updated', 'Unchanged', 'Invalid', 'Report'].map((x) => x), []));
  const body = card.querySelector('tbody');
  for (const b of batches) {
    body.append(h('tr', { 'data-batch': b.batchID },
      h('td', { text: fmtDate(b.importedAt) }), h('td', { text: b.fileName }), h('td', { text: b.sheetName || '' }),
      h('td', {}, h('span', { class: `badge ${b.status === 'Completed' ? 'badge-ok' : 'badge-bad'}`, text: b.status })),
      h('td', { text: b.newRows }), h('td', { text: b.updatedRows }), h('td', { text: b.unchangedRows }), h('td', { text: b.invalidRows }),
      h('td', {}, (b.errors || []).length
        ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => download(`import-report-${b.batchID}.csv`, buildBatchReportCSV(b), 'text/csv;charset=utf-8') }, 'Download')
        : h('span', { class: 'muted', text: 'none' }))));
  }
}

async function renderFiles() {
  const card = $('files-card');
  const files = await getUploadedFiles(session);
  card.replaceChildren(h('h2', { text: 'Uploaded files' }),
    h('p', { class: 'small muted', text: 'Removing a file deletes only its record here. The employees that were imported from it stay exactly as they are. The file itself was never stored by this prototype, only read in your browser.' }));
  if (!files.length) { put(card, h('p', { class: 'muted', id: 'files-empty', text: 'No uploaded files yet.' })); return; }
  put(card, table(['File', 'Size', 'Uploaded', 'Worksheets', 'Status', ''], []));
  const body = card.querySelector('tbody');
  for (const f of files) {
    body.append(h('tr', { 'data-file-id': f.fileID },
      h('td', { text: f.fileName }), h('td', { text: fmtSize(f.sizeBytes) }), h('td', { text: fmtDate(f.uploadedAt) }),
      h('td', { text: f.sheets.map((s) => s.name).join(', ') }),
      h('td', {}, h('span', { class: `badge ${f.status === 'Active' ? 'badge-ok' : ''}`, text: f.status })),
      h('td', {}, canRemove && f.status === 'Active'
        ? h('button', { class: 'btn btn-sm btn-danger remove-uploaded', type: 'button', onclick: () => removeUploaded(f) }, h('i', { class: 'fa-solid fa-trash', 'aria-hidden': 'true' }), ' Remove file')
        : null)));
  }
}

async function removeUploaded(file) {
  const ok = window.confirm(`Remove the uploaded file "${file.fileName}"?\n\nThis removes only the file record. The employees imported from it will NOT be deleted.`);
  if (!ok) return;
  try {
    await removeUploadedFile(session, file.fileID);
    banner('success', `"${file.fileName}" was removed. The employees imported from it were kept.`);
  } catch (err) {
    banner('error', `The file could not be removed: ${err.message}`);
  }
}

/* ---------- start ---------- */
async function start() {
  if (!session) return;
  if (!window.XLSX) {
    showFatal('The Excel library (SheetJS) did not load. Check your internet connection and reload the page.');
    return;
  }
  try {
    await ensureSeeded();
    state.sites = canImport ? await getImportSites(session) : [];
    renderUpload();
    await Promise.all([renderHistory(), renderFiles()]);
    // Live updates: any change made here, in another tab, or by another page redraws the lists.
    subscribe('importBatches', () => renderHistory());
    subscribe('employees', () => renderHistory());
    subscribe('uploadedFiles', () => renderFiles());
  } catch (err) {
    showFatal(err.message);
  }
}
start();
