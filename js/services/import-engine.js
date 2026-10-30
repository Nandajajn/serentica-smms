// Excel import: read workbooks, map columns, check every row, show what would change,
// and (only after confirmation) save everything in ONE transaction.
// The Excel library (SheetJS) is passed in, so this file never depends on a global.
import { getAll, write } from '../core/store.js';
import { ACTIONS, assertCan } from '../core/access-control.js';
import { ROLES } from '../core/constants.js';
import { newID, nowISO } from '../core/utils.js';
import { DEPARTMENTS, EMPLOYEE_STATUSES, ORG_ROLES } from '../core/reference-data.js';
import { validateEmployee } from '../core/validators.js';
import { FIELD_LABELS, IMPORT_FIELDS, autoMapHeaders } from '../seed/column-map.js';
import { addAudit } from './audit-service.js';

export { autoMapHeaders, FIELD_LABELS, IMPORT_FIELDS };

/* ---------- 1. Reading a workbook ---------- */
function cellText(value) {
  if (value instanceof Date) {
    const d = new Date(value.getTime() + 12 * 3600 * 1000); // noon avoids time-zone day shifts
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (value == null) return '';
  return String(value).trim();
}

/** @returns {{name:string, headers:string[], rows:{rowNumber:number, cells:string[]}[]}[]} */
export function readWorkbook(XLSX, arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet || !sheet['!ref']) return { name, headers: [], rows: [] };
    const firstRow = XLSX.utils.decode_range(sheet['!ref']).s.r;
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: true });
    const lines = grid.map((r) => r.map(cellText));
    const headerAt = lines.findIndex((r) => r.some((c) => c !== ''));
    if (headerAt < 0) return { name, headers: [], rows: [] };
    const headers = lines[headerAt].map((h, i) => h || `Column ${i + 1}`);
    const rows = [];
    for (let i = headerAt + 1; i < lines.length; i++) {
      if (lines[i].every((c) => c === '')) continue; // skip empty rows
      rows.push({ rowNumber: firstRow + i + 1, cells: lines[i] });
    }
    return { name, headers, rows };
  });
}

/* ---------- 2. Turning cell text into clean values ---------- */
const key = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9&]/g, '');
const DEPT_SYNONYMS = { admin: 'ADMINISTRATION', oandm: 'OM', projectmanagement: 'PROJECT_MGMT' };
const ROLE_SYNONYMS = {
  lead: 'DEPT_LEAD', deptlead: 'DEPT_LEAD', teamlead: 'DEPT_LEAD', departmentlead: 'DEPT_LEAD',
  assistantmanager: 'ASSISTANT_MANAGER', asstmanager: 'ASSISTANT_MANAGER',
  staff: 'EMPLOYEE', pm: 'PROJECT_MANAGER',
};

function toISODate(text) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); // day first, e.g. 31/12/2022
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

// Each returns { value } or { error } or { warning }
function makeNormalisers(sites) {
  return {
    employeeName: (t) => ({ value: t }),
    designation: (t) => ({ value: t }),
    department: (t) => {
      const k = key(t);
      const hit = DEPARTMENTS.find((d) => key(d.code) === k || key(d.name) === k);
      const code = hit?.code || DEPT_SYNONYMS[k];
      return code ? { value: code } : { error: `Department "${t}" is not recognised.` };
    },
    role: (t) => {
      const k = key(t);
      const hit = ORG_ROLES.find((r) => key(r.code) === k || key(r.name) === k);
      const code = hit?.code || ROLE_SYNONYMS[k];
      return code ? { value: code } : { warning: `Role "${t}" is not a recognised level; the default role is used.` };
    },
    employmentType: (t) => {
      const k = key(t);
      if (['onroll', 'onrole'].includes(k)) return { value: 'On-roll' };
      if (['offroll', 'offrole'].includes(k)) return { value: 'Off-role' };
      return { error: `Employment type "${t}" must be On-roll or Off-role.` };
    },
    status: (t) => {
      const hit = EMPLOYEE_STATUSES.find((s) => key(s) === key(t));
      return hit ? { value: hit } : { error: `Status "${t}" is not recognised.` };
    },
    baseSite: (t) => {
      const k = key(t);
      const hit = sites.find((s) => key(s.siteCode) === k || key(s.siteName) === k);
      return hit ? { value: hit.siteCode } : { error: `Site "${t}" does not exist.` };
    },
    email: (t) => ({ value: t.toLowerCase() }),
    phone: (t) => ({ value: t.replace(/\.0+$/, '') }),
    address: (t) => ({ value: t }),
    currentProject: (t) => ({ value: t }),
    shift: (t) => ({ value: t }),
    company: (t) => ({ value: t }),
    gender: (t) => ({ value: t }),
    emergencyContact: (t) => ({ value: t.replace(/\.0+$/, '') }),
    bloodGroup: (t) => ({ value: t.toUpperCase().replace(/\s+/g, '') }),
    joiningDate: (t) => { const d = toISODate(t); return d ? { value: d } : { error: `Joining date "${t}" is not a valid date.` }; },
    dateOfBirth: (t) => { const d = toISODate(t); return d ? { value: d } : { error: `Date of birth "${t}" is not a valid date.` }; },
    experienceYears: (t) => { const n = Number(t); return Number.isNaN(n) ? { error: `Experience "${t}" is not a number.` } : { value: n }; },
  };
}

/* ---------- 3. Checking every row and working out what would change ---------- */
const REQUIRED_FOR_NEW = ['employeeName', 'department', 'role', 'employmentType', 'baseSite'];

/**
 * @param sheets  [{ fileName, sheetName, headers, rows, mapping, useSheetAsProject }]
 * @param defaults { baseSite, department, role, employmentType, status } used only for NEW employees when the file has no value
 */
export function planImport({ sheets, defaults = {}, existing, sites, user }) {
  const siteCodes = sites.map((s) => s.siteCode);
  const normalisers = makeNormalisers(sites);
  const existingById = new Map(existing.map((e) => [e.employeeID, e]));
  const scope = user.siteScope || [];
  const deptScope = user.departmentScope || [];
  const items = [];
  const notes = [];
  const defaultsUsed = {};
  const firstSeen = new Map();
  const now = nowISO();

  const useDefault = (field, value) => {
    defaultsUsed[field] ||= { value, rows: 0 };
    defaultsUsed[field].rows += 1;
    return value;
  };

  /* pass 1: read each row */
  for (const sheet of sheets) {
    const m = sheet.mapping || {};
    if (m.deploymentStatus != null) notes.push(`${sheet.sheetName}: the "Deployment status" column is ignored. Only deployments and recalls change it.`);
    if (m.employeeID == null) notes.push(`${sheet.sheetName}: no Employee ID column is mapped, so no rows can be imported.`);

    for (const row of sheet.rows) {
      const get = (f) => (m[f] == null ? '' : String(row.cells[m[f]] ?? '').trim());
      const item = {
        fileName: sheet.fileName, sheetName: sheet.sheetName, rowNumber: row.rowNumber,
        employeeID: get('employeeID').toUpperCase(), kind: '', errors: [], warnings: [], changes: {}, record: null,
        fields: {}, flagged: new Set(), managerRef: get('reportingManager'),
      };
      items.push(item);

      if (m.employeeID == null) { item.kind = 'invalid'; item.errors.push('No Employee ID column is mapped.'); continue; }
      if (!item.employeeID) { item.kind = 'invalid'; item.errors.push('Employee ID is empty.'); continue; }
      if (firstSeen.has(item.employeeID)) {
        item.kind = 'invalid';
        item.errors.push(`Duplicate Employee ID. It already appears in ${firstSeen.get(item.employeeID)}.`);
        continue;
      }
      firstSeen.set(item.employeeID, `${sheet.sheetName} row ${row.rowNumber}`);

      for (const field of IMPORT_FIELDS) {
        if (['employeeID', 'reportingManager', 'deploymentStatus'].includes(field)) continue;
        const text = get(field);
        if (text === '') continue; // an empty cell never erases existing data
        const result = normalisers[field](text);
        if (result.error) { item.errors.push(result.error); item.flagged.add(field); }
        else if (result.warning) item.warnings.push(result.warning);
        else item.fields[field] = result.value;
      }
      if (sheet.useSheetAsProject && !item.fields.currentProject) item.fields.currentProject = sheet.sheetName;

      const isExisting = existingById.has(item.employeeID);
      item.kind = isExisting ? 'existing' : 'new';
      if (!isExisting) {
        for (const f of [...REQUIRED_FOR_NEW, 'status']) {
          if (item.fields[f] === undefined && !item.flagged.has(f)) {
            const fallback = f === 'status' ? (defaults.status || 'Active') : defaults[f];
            if (fallback) item.fields[f] = useDefault(f, fallback);
            else if (f !== 'status') { item.errors.push(`${FIELD_LABELS[f]} is missing and no default was chosen.`); item.flagged.add(f); }
          }
        }
      }
    }
  }

  /* pass 2: find reporting managers (by Employee ID or by exact name) */
  const known = items.filter((i) => i.kind === 'new' || i.kind === 'existing');
  const idSet = new Set([...existingById.keys(), ...known.map((i) => i.employeeID)]);
  const names = new Map();
  const addName = (name, id) => { const k = String(name || '').toLowerCase(); if (k) names.set(k, [...(names.get(k) || []), id]); };
  existing.forEach((e) => addName(e.employeeName, e.employeeID));
  known.filter((i) => i.kind === 'new').forEach((i) => addName(i.fields.employeeName, i.employeeID));
  for (const item of known) {
    if (!item.managerRef) continue;
    const ref = item.managerRef.toUpperCase();
    if (idSet.has(ref)) item.fields.reportingManagerID = ref;
    else {
      const matches = names.get(item.managerRef.toLowerCase()) || [];
      if (matches.length === 1) item.fields.reportingManagerID = matches[0];
      else item.warnings.push(matches.length > 1
        ? `Reporting manager "${item.managerRef}" matches several employees; use the Employee ID instead.`
        : `Reporting manager "${item.managerRef}" was not found; the reporting line was left unchanged.`);
    }
  }

  /* pass 3: build records, compare with what is stored */
  for (const item of known) {
    if (item.errors.length) { item.kind = 'invalid'; continue; }
    const current = existingById.get(item.employeeID);
    if (!current) {
      const status = item.fields.status;
      item.kind = 'new';
      item.record = {
        ...item.fields, employeeID: item.employeeID, reportingManagerID: item.fields.reportingManagerID ?? null,
        deploymentStatus: status === 'Active' ? 'Available' : 'Unavailable', activeAssignmentID: null,
        currentSite: item.fields.baseSite, currentProject: item.fields.currentProject || '',
        isDemo: false, sourceBatchID: null, createdAt: now, updatedAt: now, updatedBy: user.userID,
      };
    } else {
      for (const [f, to] of Object.entries(item.fields)) {
        if (JSON.stringify(to ?? null) !== JSON.stringify(current[f] ?? null)) item.changes[f] = { from: current[f] ?? null, to };
      }
      if (!Object.keys(item.changes).length) { item.kind = 'unchanged'; continue; }
      item.kind = 'updated';
      item.record = { ...current, ...item.fields, updatedAt: now, updatedBy: user.userID };
      if (item.changes.baseSite && !current.activeAssignmentID) item.record.currentSite = item.record.baseSite;
      if (item.changes.status && item.record.status !== 'Active' && current.activeAssignmentID) {
        item.errors.push('This employee is currently deployed. Complete a recall before changing their status.');
      }
    }
    for (const site of new Set([item.record.baseSite, current?.baseSite].filter(Boolean))) {
      if (!scope.includes(site)) item.errors.push(`Site ${site} is outside your scope.`);
    }
    if (user.systemRole === ROLES.LEAD) {
      for (const dept of new Set([item.record.department, current?.department].filter(Boolean))) {
        if (!deptScope.includes(dept)) item.errors.push(`Department ${dept} is outside your scope.`);
      }
    }
    if (item.errors.length) { item.kind = 'invalid'; item.record = null; }
  }

  /* pass 4: apply the same rules as adding/editing one employee by hand */
  let active = items.filter((i) => i.record);
  for (let round = 0; round < 3; round++) {
    const merged = new Map(existingById);
    active.forEach((i) => merged.set(i.employeeID, i.record));
    const list = [...merged.values()];
    let dropped = false;
    for (const item of active) {
      const all = validateEmployee(item.record, { employees: list, siteCodes, isNew: false });
      for (const [field, message] of Object.entries(all)) {
        const relevant = item.kind === 'new' || field in item.changes;
        if (relevant && !item.flagged.has(field)) item.errors.push(message);
      }
      if (item.errors.length) { item.kind = 'invalid'; item.record = null; dropped = true; }
    }
    active = active.filter((i) => i.record);
    if (!dropped) break;
  }

  const count = (k) => items.filter((i) => i.kind === k).length;
  return {
    items, notes,
    defaultsUsed: Object.entries(defaultsUsed).map(([field, v]) => ({ field, ...v })),
    counts: {
      total: items.length, new: count('new'), updated: count('updated'), unchanged: count('unchanged'),
      invalid: count('invalid'), warnings: items.filter((i) => i.warnings.length).length,
    },
  };
}

/* ---------- 4. Saving ---------- */
const sheetKey = (fileName, sheetName) => `${fileName}||${sheetName}`;

/**
 * @param files  [{ fileName, sizeBytes, sheets:[{name,rowCount}] }]  (file bytes are NOT kept)
 * @param sheets same shape as planImport
 */
export async function commitImport(user, { files, sheets, defaults }) {
  assertCan(user, ACTIONS.IMPORT_UPLOAD);
  assertCan(user, ACTIONS.IMPORT_CONFIRM);
  const importedAt = nowISO();

  try {
    return await write(['employees', 'sites', 'importBatches', 'uploadedFiles', 'auditEvents'], async (tx) => {
      const existing = await tx.getAll('employees');
      const sites = await tx.getAll('sites');
      const plan = planImport({ sheets, defaults, existing, sites, user }); // re-checked against the latest data
      const writable = plan.items.filter((i) => i.kind === 'new' || i.kind === 'updated');
      if (!writable.length) throw new Error('There is nothing to import: no new or changed valid records.');

      const fileIDs = new Map();
      for (const f of files) {
        const fileID = newID('FILE');
        fileIDs.set(f.fileName, fileID);
        await tx.put('uploadedFiles', {
          fileID, fileName: f.fileName, sizeBytes: f.sizeBytes, uploadedAt: importedAt, uploadedBy: user.userID,
          sheets: f.sheets, bytesStored: false, status: 'Active', removedAt: null, removedBy: null,
        });
      }
      const batchIDs = new Map(sheets.map((s) => [sheetKey(s.fileName, s.sheetName), newID('BATCH')]));

      for (const item of writable) {
        const batchID = batchIDs.get(sheetKey(item.fileName, item.sheetName));
        const record = item.kind === 'new' ? { ...item.record, sourceBatchID: batchID } : item.record;
        await tx.put('employees', record);
        await addAudit(tx, {
          actor: user, action: item.kind === 'new' ? 'EMPLOYEE_IMPORT_ADD' : 'EMPLOYEE_IMPORT_UPDATE',
          recordType: 'employee', recordID: record.employeeID,
          before: item.kind === 'updated' ? Object.fromEntries(Object.entries(item.changes).map(([f, c]) => [f, c.from])) : null,
          after: item.kind === 'updated' ? Object.fromEntries(Object.entries(item.changes).map(([f, c]) => [f, c.to])) : record,
          reason: `Excel import ${batchID} (${item.fileName}, ${item.sheetName}, row ${item.rowNumber})`,
        });
      }

      for (const sheet of sheets) {
        const mine = plan.items.filter((i) => i.fileName === sheet.fileName && i.sheetName === sheet.sheetName);
        const n = (k) => mine.filter((i) => i.kind === k).length;
        const batchID = batchIDs.get(sheetKey(sheet.fileName, sheet.sheetName));
        const batch = {
          batchID, importedAt, importedBy: user.userID, fileID: fileIDs.get(sheet.fileName), fileName: sheet.fileName,
          sheetName: sheet.sheetName,
          mapping: Object.fromEntries(Object.entries(sheet.mapping).map(([f, i]) => [f, sheet.headers[i]])),
          totalRows: mine.length, newRows: n('new'), updatedRows: n('updated'), unchangedRows: n('unchanged'),
          invalidRows: n('invalid'), failedRows: 0,
          errors: mine.filter((i) => i.kind === 'invalid').slice(0, 500).map((i) => ({ rowNumber: i.rowNumber, employeeID: i.employeeID, messages: i.errors })),
          defaultsApplied: plan.defaultsUsed, status: 'Completed',
        };
        await tx.put('importBatches', batch);
        await addAudit(tx, {
          actor: user, action: 'IMPORT_COMPLETED', recordType: 'importBatch', recordID: batchID,
          after: { file: sheet.fileName, sheet: sheet.sheetName, new: batch.newRows, updated: batch.updatedRows, unchanged: batch.unchangedRows, invalid: batch.invalidRows },
        });
      }
      return { counts: plan.counts, batchIDs: [...batchIDs.values()], fileIDs: [...fileIDs.values()] };
    });
  } catch (err) {
    // The whole import was rolled back. Record the failure separately.
    try {
      await write(['importBatches', 'auditEvents'], async (tx) => {
        const batchID = newID('BATCH');
        await tx.put('importBatches', {
          batchID, importedAt, importedBy: user.userID, fileID: null, fileName: files.map((f) => f.fileName).join(', '), sheetName: '',
          mapping: null, totalRows: 0, newRows: 0, updatedRows: 0, unchangedRows: 0, invalidRows: 0, failedRows: 0,
          errors: [{ rowNumber: null, employeeID: '', messages: [String(err.message)] }], defaultsApplied: [], status: 'Failed',
        });
        await addAudit(tx, { actor: user, action: 'IMPORT_FAILED', recordType: 'importBatch', recordID: batchID, reason: String(err.message) });
      });
    } catch { /* could not even record the failure */ }
    throw err;
  }
}

/* ---------- 5. History and file removal ---------- */
export async function getImportHistory(user) {
  assertCan(user, ACTIONS.VIEW_PAGES);
  return (await getAll('importBatches')).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

export async function getUploadedFiles(user) {
  assertCan(user, ACTIONS.VIEW_PAGES);
  return (await getAll('uploadedFiles')).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/** Removes the file record only. Employees that were imported from it stay exactly as they are. */
export async function removeUploadedFile(user, fileID) {
  assertCan(user, ACTIONS.FILE_REMOVE);
  return write(['uploadedFiles', 'auditEvents'], async (tx) => {
    const file = await tx.get('uploadedFiles', fileID);
    if (!file || file.status === 'Removed') throw new Error('This file is not available to remove.');
    const updated = { ...file, status: 'Removed', removedAt: nowISO(), removedBy: user.userID };
    await tx.put('uploadedFiles', updated);
    await addAudit(tx, {
      actor: user, action: 'UPLOADED_FILE_REMOVED', recordType: 'uploadedFile', recordID: fileID,
      before: { status: 'Active' }, after: { status: 'Removed' },
      reason: 'File record removed. Employee records imported from it were NOT deleted.',
    });
    return updated;
  });
}
