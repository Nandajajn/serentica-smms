// Helpers for the Data Management page: preview without saving, site list, CSV reports.
import { getAll } from '../core/store.js';
import { ACTIONS, assertCan } from '../core/access-control.js';
import { ROLES } from '../core/constants.js';
import { planImport } from './import-engine.js';

/** Works out what an import WOULD do. Saves nothing. */
export async function previewImport(user, { sheets, defaults }) {
  assertCan(user, ACTIONS.IMPORT_UPLOAD);
  const [existing, sites] = await Promise.all([getAll('employees'), getAll('sites')]);
  return planImport({ sheets, defaults, existing, sites, user });
}

/** Sites this user may import into. */
export async function getImportSites(user) {
  assertCan(user, ACTIONS.VIEW_PAGES);
  const sites = await getAll('sites');
  return user.systemRole === ROLES.ADMIN ? sites : sites.filter((s) => (user.siteScope || []).includes(s.siteCode));
}

/* ---------- CSV reports ---------- */
// A cell that starts with = + - @ could run as a formula when opened in Excel, so it is neutralised.
function cell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
const toCSV = (rows) => '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n');

const describeChanges = (changes) =>
  Object.entries(changes).map(([f, c]) => `${f}: ${c.from ?? ''} -> ${c.to ?? ''}`).join('; ');

export function buildPlanReportCSV(plan) {
  const rows = [['File', 'Worksheet', 'Row', 'Employee ID', 'Result', 'Changes', 'Errors', 'Warnings']];
  for (const i of plan.items) {
    rows.push([i.fileName, i.sheetName, i.rowNumber, i.employeeID, i.kind, describeChanges(i.changes), i.errors.join(' | '), i.warnings.join(' | ')]);
  }
  return toCSV(rows);
}

export function buildBatchReportCSV(batch) {
  const rows = [['File', 'Worksheet', 'Status', 'Row', 'Employee ID', 'Problems']];
  for (const e of batch.errors || []) rows.push([batch.fileName, batch.sheetName, batch.status, e.rowNumber ?? '', e.employeeID, (e.messages || []).join(' | ')]);
  return toCSV(rows);
}
