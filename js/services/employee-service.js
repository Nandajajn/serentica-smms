// Employee master data. The only code that creates or changes employee records.
// Every function checks permissions first, validates, and writes the change and its
// audit record in ONE transaction.
import { getAll, getOne, write } from '../core/store.js';
import { ACTIONS, assertCan, can } from '../core/access-control.js';
import { ROLES } from '../core/constants.js';
import { nowISO } from '../core/utils.js';
import { OPERATIONAL_FIELDS, RESTRICTED_FIELDS, SENSITIVE_FIELDS } from '../core/reference-data.js';
import { ValidationError, normaliseEmployee, validateEmployee } from '../core/validators.js';
import { addAudit } from './audit-service.js';

/* ---------- visibility ---------- */
// Admin sees every site. Lead and PM see only the sites in their scope (an empty scope sees nothing).
function canSee(user, emp) {
  if (user.systemRole === ROLES.ADMIN) return true;
  const scope = user.siteScope || [];
  return scope.includes(emp.baseSite) || scope.includes(emp.currentSite);
}

function present(user, emp) {
  const copy = { ...emp };
  if (!can(user, ACTIONS.VIEW_SENSITIVE)) for (const f of SENSITIVE_FIELDS) delete copy[f];
  return copy;
}

/* ---------- reads ---------- */
export async function getEmployees(user) {
  assertCan(user, ACTIONS.VIEW_EMPLOYEES);
  return (await getAll('employees')).filter((e) => canSee(user, e)).map((e) => present(user, e));
}

export async function getEmployeeById(user, employeeID) {
  assertCan(user, ACTIONS.VIEW_EMPLOYEES);
  const emp = await getOne('employees', String(employeeID || '').toUpperCase());
  return emp && canSee(user, emp) ? present(user, emp) : null; // out-of-scope looks the same as missing
}

/** Managers above this employee, nearest first. Pure function: pass in the employee list. */
export function getReportingChain(employees, employeeID) {
  const byId = new Map(employees.map((e) => [e.employeeID, e]));
  const chain = [];
  const seen = new Set([employeeID]);
  let cursor = byId.get(byId.get(employeeID)?.reportingManagerID);
  while (cursor && !seen.has(cursor.employeeID)) {
    chain.push(cursor);
    seen.add(cursor.employeeID);
    cursor = byId.get(cursor.reportingManagerID);
  }
  return chain;
}

/** Team lead and project manager are worked out from the chain, never stored. */
export function deriveLeadership(employees, employeeID) {
  const chain = getReportingChain(employees, employeeID);
  return {
    teamLead: chain.find((e) => e.role === 'DEPT_LEAD') || null,
    projectManager: chain.find((e) => e.role === 'PROJECT_MANAGER') || null,
  };
}

/* ---------- add ---------- */
export async function addEmployee(user, data) {
  const input = normaliseEmployee(data);
  assertCan(user, ACTIONS.EMPLOYEE_ADD, { site: input.baseSite, department: input.department });

  return write(['employees', 'sites', 'auditEvents'], async (tx) => {
    const employees = await tx.getAll('employees');
    const siteCodes = (await tx.getAll('sites')).map((s) => s.siteCode);

    const record = {
      ...input,
      status: input.status || 'Active',
      reportingManagerID: input.reportingManagerID ?? null,
      deploymentStatus: 'Available',
      activeAssignmentID: null,
      currentSite: input.baseSite,
      currentProject: input.currentProject || '',
      isDemo: false,
      sourceBatchID: null,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      updatedBy: user.userID,
    };
    const errors = validateEmployee(record, { employees, siteCodes, isNew: true });
    if (Object.keys(errors).length) throw new ValidationError(errors);

    await tx.put('employees', record);
    await addAudit(tx, { actor: user, action: 'EMPLOYEE_ADD', recordType: 'employee', recordID: record.employeeID, after: record });
    return record;
  });
}

/* ---------- update ---------- */
export async function updateEmployee(user, employeeID, changes, reason = '') {
  assertCan(user, ACTIONS.EMPLOYEE_EDIT_OPERATIONAL); // role gate: Admin stops here
  const editable = [...OPERATIONAL_FIELDS, ...RESTRICTED_FIELDS];
  const unknown = Object.keys(changes).filter((k) => !editable.includes(k));
  if (unknown.length) throw new ValidationError({ _fields: `These fields cannot be edited here: ${unknown.join(', ')}.` });
  const id = String(employeeID || '').toUpperCase();

  return write(['employees', 'sites', 'auditEvents'], async (tx) => {
    const current = await tx.get('employees', id);
    if (!current || !canSee(user, current)) throw new Error('Employee not found.');

    const merged = normaliseEmployee({ ...current, ...changes });
    const changed = Object.keys(changes).filter((k) => JSON.stringify(merged[k] ?? null) !== JSON.stringify(current[k] ?? null));
    if (!changed.length) return present(user, current); // nothing to do, nothing to audit

        const context = { site: current.baseSite, department: current.department };
    if (changed.some((k) => RESTRICTED_FIELDS.includes(k))) assertCan(user, ACTIONS.EMPLOYEE_EDIT_RESTRICTED, context);
    if (changed.some((k) => OPERATIONAL_FIELDS.includes(k))) assertCan(user, ACTIONS.EMPLOYEE_EDIT_OPERATIONAL, context);
    // The new site or department must also be inside the user's scope (no moving people out of reach).
    if (changed.includes('baseSite') || changed.includes('department')) {
      assertCan(user, ACTIONS.EMPLOYEE_EDIT_RESTRICTED, { site: merged.baseSite, department: merged.department });
    }

    const employees = await tx.getAll('employees');
    const siteCodes = (await tx.getAll('sites')).map((s) => s.siteCode);
    const all = validateEmployee(merged, { employees, siteCodes, isNew: false });
    const errors = Object.fromEntries(Object.entries(all).filter(([field]) => changed.includes(field)));
    if (changed.includes('status') && merged.status !== 'Active' && current.activeAssignmentID) {
      errors.status = 'This employee is currently deployed. Complete a recall before changing their status.';
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);

    const record = { ...merged, updatedAt: nowISO(), updatedBy: user.userID };
    const pick = (obj) => Object.fromEntries(changed.map((k) => [k, obj[k] ?? null]));
    await tx.put('employees', record);
    await addAudit(tx, { actor: user, action: 'EMPLOYEE_UPDATE', recordType: 'employee', recordID: id, before: pick(current), after: pick(record), reason });
    return present(user, record);
  });
}

export function updateReportingRelationship(user, employeeID, managerID, reason = '') {
  return updateEmployee(user, employeeID, { reportingManagerID: managerID || null }, reason);
}
