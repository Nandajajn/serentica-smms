// Deployment requests: Lead raises -> PM reviews -> PM approves/rejects/sends back -> PM confirms.
// Approved is NOT confirmed. The employee only changes when the PM confirms.
// Every step checks permissions, validates, and saves the change, its history entry, the audit event and the
// notification in ONE transaction.
import { getAll, getOne, write } from '../core/store.js';
import { ACTIONS, PermissionError, assertCan } from '../core/access-control.js';
import { ROLES } from '../core/constants.js';
import { newID, nowISO } from '../core/utils.js';
import { ValidationError } from '../core/validators.js';
import { OPEN_STATUSES, nextStatus } from '../core/workflow.js';
import { availabilityOf } from './availability-service.js';
import { addAudit } from './audit-service.js';
import { addNotification } from './notification-service.js';
import { getEmployees } from './employee-service.js';

const STORES = ['deploymentRequests', 'employees', 'sites', 'assignments', 'decisions', 'notifications', 'auditEvents'];
const today = () => new Date().toISOString().slice(0, 10);
const text = (v) => String(v ?? '').trim();

/* ---------- who may see which request ---------- */
function canSee(user, r) {
  if (user.systemRole === ROLES.ADMIN) return true;
  if (user.systemRole === ROLES.LEAD) return r.requestedByUserID === user.userID;
  if (r.status === 'Draft') return false; // a Lead's draft is private until it is submitted
  const scope = user.siteScope || [];
  return scope.includes(r.targetSite) || scope.includes(r.employeeBaseSite);
}

export async function getDeploymentRequests(user) {
  assertCan(user, ACTIONS.VIEW_PAGES);
  return (await getAll('deploymentRequests')).filter((r) => canSee(user, r)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDeploymentRequest(user, requestID) {
  assertCan(user, ACTIONS.VIEW_PAGES);
  const r = await getOne('deploymentRequests', requestID);
  return r && canSee(user, r) ? r : null;
}

/** Employees a Lead may put in a request now: in scope, available, and not already in an open request. */
export async function getDeployableEmployees(user) {
  assertCan(user, ACTIONS.DEPLOYMENT_CREATE);
  const open = new Set((await getAll('deploymentRequests')).filter((r) => OPEN_STATUSES.includes(r.status)).map((r) => r.employeeID));
  const depts = user.departmentScope || [];
  return (await getEmployees(user)).filter((e) => availabilityOf(e).available && !open.has(e.employeeID)
    && (user.systemRole !== ROLES.LEAD || depts.includes(e.department)) && (user.siteScope || []).includes(e.baseSite));
}

/* ---------- checks ---------- */
function checkFields(d, sites, { requireFutureStart }) {
  const errors = {};
  const site = sites.find((s) => s.siteCode === d.targetSite);
  if (!d.employeeID) errors.employeeID = 'Choose an employee.';
  if (!site) errors.targetSite = 'Choose a valid site.';
  if (!d.targetProject) errors.targetProject = 'Choose a project.';
  else if (site?.projectTypes?.length && !site.projectTypes.includes(d.targetProject)) errors.targetProject = 'This site has no such project.';
  if (!d.assignmentRole) errors.assignmentRole = 'Enter the role or assignment.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.startDate) || Number.isNaN(new Date(d.startDate).getTime())) errors.startDate = 'Enter a valid start date.';
  else if (requireFutureStart && d.startDate < today()) errors.startDate = 'The start date cannot be in the past.';
  if (d.expectedEndDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.expectedEndDate) || Number.isNaN(new Date(d.expectedEndDate).getTime())) errors.expectedEndDate = 'Enter a valid end date.';
    else if (!errors.startDate && d.expectedEndDate < d.startDate) errors.expectedEndDate = 'The end date cannot be before the start date.';
  }
  if (d.reason.length < 3) errors.reason = 'Give a reason for the deployment.';
  return errors;
}

// Used when submitting AND again when confirming, so nothing slips through in between.
async function checkEligibility(tx, emp, ignoreRequestID) {
  const problems = [];
  const a = availabilityOf(emp);
  if (!a.available) problems.push(`${emp.employeeName} is not available: ${a.reason}`);
  const others = (await tx.getAll('deploymentRequests')).filter((r) => r.employeeID === emp.employeeID && r.requestID !== ignoreRequestID && OPEN_STATUSES.includes(r.status));
  if (others.length) problems.push(`${emp.employeeName} is already in another open request (${others[0].requestID}, ${others[0].status}).`);
  const active = (await tx.getAll('assignments')).filter((x) => x.employeeID === emp.employeeID && x.status === 'Active');
  if (active.length) problems.push(`${emp.employeeName} already has an active assignment (${active[0].assignmentID}).`);
  return problems;
}

function inEmployeeScope(user, emp) {
  const scope = user.siteScope || [];
  return scope.includes(emp.baseSite) || scope.includes(emp.currentSite);
}

const stamp = (user, action, from, to, comment = '') => ({ at: nowISO(), byUserID: user.userID, byRole: user.systemRole, byName: user.displayName || user.username || user.userID, action, from, to, comment });

/* ---------- create / edit (Lead) ---------- */
function clean(data) {
  return {
    employeeID: text(data.employeeID).toUpperCase(), targetSite: text(data.targetSite), targetProject: text(data.targetProject),
    assignmentRole: text(data.assignmentRole), startDate: text(data.startDate), expectedEndDate: text(data.expectedEndDate),
    reason: text(data.reason), remarks: text(data.remarks),
  };
}

export async function createDeploymentRequest(user, data, { submit = true } = {}) {
  assertCan(user, ACTIONS.DEPLOYMENT_CREATE);
  const d = clean(data);
  return write(STORES, async (tx) => {
    const emp = d.employeeID ? await tx.get('employees', d.employeeID) : null;
    if (!emp || !inEmployeeScope(user, emp)) throw new ValidationError({ employeeID: 'Choose an employee from your list.' });
    assertCan(user, ACTIONS.DEPLOYMENT_CREATE, { site: emp.baseSite, department: emp.department });
    const errors = checkFields(d, await tx.getAll('sites'), { requireFutureStart: submit });
    if (!errors.targetSite) assertCan(user, ACTIONS.DEPLOYMENT_CREATE, { site: d.targetSite });
    if (submit && !errors.employeeID) { const p = await checkEligibility(tx, emp, null); if (p.length) errors.employeeID = p.join(' '); }
    if (Object.keys(errors).length) throw new ValidationError(errors);

    const now = nowISO();
    const status = submit ? 'Submitted' : 'Draft';
    const record = {
      requestID: newID('DEP'), ...d, status, version: 1, createdAt: now, updatedAt: now,
      requestedByUserID: user.userID, requestedByName: user.displayName || user.username,
      employeeName: emp.employeeName, employeeDepartment: emp.department, employeeBaseSite: emp.baseSite,
      history: [stamp(user, submit ? 'Submitted' : 'Saved as draft', null, status, d.reason)],
      decisionID: null, confirmedAt: null, confirmedBy: null, resultingAssignmentID: null,
    };
    await tx.put('deploymentRequests', record);
    await addAudit(tx, { actor: user, action: submit ? 'DEPLOYMENT_SUBMITTED' : 'DEPLOYMENT_DRAFT_SAVED', recordType: 'deploymentRequest', recordID: record.requestID, after: { employeeID: emp.employeeID, targetSite: d.targetSite, status } });
    if (submit) await addNotification(tx, { type: 'DEPLOYMENT_SUBMITTED', message: `${record.requestedByName} requested a deployment for ${emp.employeeName} to ${d.targetSite} (${d.targetProject}).`, targetRole: ROLES.PM, relatedRecordType: 'deploymentRequest', relatedRecordID: record.requestID });
    return record;
  });
}

/** Lead edits their own Draft or Returned request, optionally submitting it again. */
export async function updateDeploymentRequest(user, requestID, data, { submit = false, expectedVersion } = {}) {
  assertCan(user, ACTIONS.DEPLOYMENT_CREATE);
  const d = clean(data);
  return write(STORES, async (tx) => {
    const r = await tx.get('deploymentRequests', requestID);
    if (!r || !canSee(user, r)) throw new Error('Request not found.');
    if (r.requestedByUserID !== user.userID) throw new PermissionError('You can edit only your own requests.');
    if (!['Draft', 'Returned'].includes(r.status)) throw new Error(`A request that is "${r.status}" can no longer be edited.`);
    if (expectedVersion != null && expectedVersion !== r.version) throw new Error('This request was changed by someone else. Reload the page and try again.');
    const emp = await tx.get('employees', r.employeeID);
    d.employeeID = r.employeeID; // the employee cannot be swapped on an existing request
    const errors = checkFields(d, await tx.getAll('sites'), { requireFutureStart: submit });
    if (!errors.targetSite) assertCan(user, ACTIONS.DEPLOYMENT_CREATE, { site: d.targetSite });
    if (submit) { const p = await checkEligibility(tx, emp, r.requestID); if (p.length) errors.employeeID = p.join(' '); }
    if (Object.keys(errors).length) throw new ValidationError(errors);

    const to = submit ? nextStatus('submit', r.status) : r.status;
    const record = { ...r, ...d, status: to, version: r.version + 1, updatedAt: nowISO(), history: [...r.history, stamp(user, submit ? 'Resubmitted' : 'Edited', r.status, to, d.reason)] };
    await tx.put('deploymentRequests', record);
    await addAudit(tx, { actor: user, action: submit ? 'DEPLOYMENT_RESUBMITTED' : 'DEPLOYMENT_EDITED', recordType: 'deploymentRequest', recordID: r.requestID, before: { status: r.status }, after: { status: to } });
    if (submit) await addNotification(tx, { type: 'DEPLOYMENT_SUBMITTED', message: `${record.requestedByName} resubmitted the deployment request for ${record.employeeName}.`, targetRole: ROLES.PM, relatedRecordType: 'deploymentRequest', relatedRecordID: r.requestID });
    return record;
  });
}

/* ---------- decisions and actions ---------- */
const ACTION_RULES = {
  submit:      { label: 'Submitted', needsComment: false },
  startReview: { label: 'Review started', needsComment: false, perm: ACTIONS.DEPLOYMENT_REVIEW },
  approve:     { label: 'Approved', needsComment: false, perm: ACTIONS.DEPLOYMENT_DECIDE, decision: 'Approved' },
  reject:      { label: 'Rejected', needsComment: true, perm: ACTIONS.DEPLOYMENT_DECIDE, decision: 'Rejected' },
  return:      { label: 'Sent back to the Lead', needsComment: true, perm: ACTIONS.DEPLOYMENT_RETURN, decision: 'Returned' },
  confirm:     { label: 'Confirmed', needsComment: false, perm: ACTIONS.DEPLOYMENT_CONFIRM },
  cancel:      { label: 'Cancelled', needsComment: false, perm: ACTIONS.DEPLOYMENT_CANCEL },
};

/** One entry point for every step after creation. */
export async function actOnDeployment(user, requestID, action, { comment = '', expectedVersion } = {}) {
  const rule = ACTION_RULES[action];
  if (!rule) throw new Error(`Unknown action: ${action}`);
  const note = text(comment);

  return write(STORES, async (tx) => {
    const r = await tx.get('deploymentRequests', requestID);
    if (!r || !canSee(user, r)) throw new Error('Request not found.');
    if (expectedVersion != null && expectedVersion !== r.version) throw new Error('This request was changed by someone else. Reload the page and try again.');

    /* permissions (the buttons on the page are only a convenience) */
    if (action === 'submit') {
      assertCan(user, ACTIONS.DEPLOYMENT_CREATE, { site: r.employeeBaseSite, department: r.employeeDepartment });
      if (r.requestedByUserID !== user.userID) throw new PermissionError('You can submit only your own requests.');
    } else if (action === 'cancel') {
      assertCan(user, ACTIONS.DEPLOYMENT_CANCEL, { requestedByUserID: r.requestedByUserID, site: r.targetSite });
      if (user.systemRole === ROLES.LEAD && !['Draft', 'Submitted', 'Returned'].includes(r.status)) throw new PermissionError('Only the Project Manager can cancel a request that is under review or approved.');
      if (user.systemRole === ROLES.PM && note.length < 3) throw new ValidationError({ comment: 'Give a reason for cancelling.' });
    } else {
      assertCan(user, rule.perm, { site: r.targetSite, requestedByUserID: r.requestedByUserID });
      assertCan(user, rule.perm, { site: r.employeeBaseSite });
    }
    if (rule.needsComment && note.length < 3) throw new ValidationError({ comment: action === 'reject' ? 'Give a reason for rejecting.' : 'Say what the Lead needs to change.' });

    const to = nextStatus(action, r.status); // refuses impossible steps, e.g. approving twice
    const emp = await tx.get('employees', r.employeeID);
    const now = nowISO();
    let record = { ...r, status: to, version: r.version + 1, updatedAt: now, history: [...r.history, stamp(user, rule.label, r.status, to, note)] };

    if (action === 'submit' || action === 'confirm') {
      const problems = await checkEligibility(tx, emp, r.requestID);
      if (problems.length) throw new ValidationError({ employeeID: problems.join(' ') });
    }
    if (action === 'submit' && r.startDate < today()) throw new ValidationError({ startDate: 'The start date is now in the past. Edit the request first.' });

    if (rule.decision) {
      const decision = { decisionID: newID('DEC'), requestType: 'deployment', requestID: r.requestID, decision: rule.decision, decidedByUserID: user.userID, comment: note, decidedAt: now };
      await tx.put('decisions', decision);
      record.decisionID = decision.decisionID;
    }

    if (action === 'confirm') {
      const assignment = {
        assignmentID: newID('ASG'), employeeID: emp.employeeID, site: r.targetSite, project: r.targetProject, role: r.assignmentRole,
        startDate: r.startDate, endDate: r.expectedEndDate || null, status: 'Active', sourceDeploymentRequestID: r.requestID,
        endedByRecallRequestID: null, createdAt: now,
      };
      const updatedEmp = { ...emp, deploymentStatus: 'Deployed', activeAssignmentID: assignment.assignmentID, currentSite: r.targetSite, currentProject: r.targetProject, updatedAt: now, updatedBy: user.userID };
      await tx.put('assignments', assignment);
      await tx.put('employees', updatedEmp);
      record = { ...record, confirmedAt: now, confirmedBy: user.userID, resultingAssignmentID: assignment.assignmentID };
      await addAudit(tx, { actor: user, action: 'EMPLOYEE_DEPLOYED', recordType: 'employee', recordID: emp.employeeID,
        before: { deploymentStatus: emp.deploymentStatus, currentSite: emp.currentSite, currentProject: emp.currentProject },
        after: { deploymentStatus: 'Deployed', currentSite: r.targetSite, currentProject: r.targetProject, activeAssignmentID: assignment.assignmentID }, reason: `Deployment ${r.requestID} confirmed` });
    }

    await tx.put('deploymentRequests', record);
    await addAudit(tx, { actor: user, action: `DEPLOYMENT_${action.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`, recordType: 'deploymentRequest', recordID: r.requestID, before: { status: r.status }, after: { status: to }, reason: note });

    if (action === 'submit') await addNotification(tx, { type: 'DEPLOYMENT_SUBMITTED', message: `${r.requestedByName} submitted the deployment request for ${r.employeeName}.`, targetRole: ROLES.PM, relatedRecordType: 'deploymentRequest', relatedRecordID: r.requestID });
    else if (action !== 'startReview') await addNotification(tx, { type: `DEPLOYMENT_${to.toUpperCase().replace(' ', '_')}`, message: `Deployment request ${r.requestID} for ${r.employeeName} is now: ${to}.${note ? ` Comment: ${note}` : ''}`, targetUserIDs: [r.requestedByUserID], relatedRecordType: 'deploymentRequest', relatedRecordID: r.requestID });
    return record;
  });
}
