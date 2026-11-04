// Recall requests: Lead asks to bring a deployed employee back -> PM reviews -> approves/rejects/sends back -> PM confirms.
// Approved is NOT confirmed: the employee stays deployed until the PM confirms.
// Every step checks permissions, validates, and saves the change, history, audit event and notification in ONE transaction.
import { getAll, getOne, write } from '../core/store.js';
import { ACTIONS, PermissionError, assertCan } from '../core/access-control.js';
import { ROLES } from '../core/constants.js';
import { newID, nowISO } from '../core/utils.js';
import { ValidationError } from '../core/validators.js';
import { OPEN_STATUSES, nextStatus } from '../core/workflow.js';
import { addAudit } from './audit-service.js';
import { addNotification } from './notification-service.js';
import { getEmployees } from './employee-service.js';

const STORES = ['recallRequests', 'employees', 'assignments', 'decisions', 'notifications', 'auditEvents'];
const today = () => new Date().toISOString().slice(0, 10);
const text = (v) => String(v ?? '').trim();

/* ---------- who may see which request ---------- */
function canSee(user, r) {
  if (user.systemRole === ROLES.ADMIN) return true;
  if (user.systemRole === ROLES.LEAD) return r.requestedByUserID === user.userID;
  if (r.status === 'Draft') return false; // a Lead's draft is private until it is submitted
  const scope = user.siteScope || [];
  return scope.includes(r.assignmentSite) || scope.includes(r.employeeBaseSite);
}

export async function getRecallRequests(user) {
  assertCan(user, ACTIONS.VIEW_PAGES);
  return (await getAll('recallRequests')).filter((r) => canSee(user, r)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getRecallRequest(user, requestID) {
  assertCan(user, ACTIONS.VIEW_PAGES);
  const r = await getOne('recallRequests', requestID);
  return r && canSee(user, r) ? r : null;
}

/** Deployed employees a Lead may ask to recall: in scope, with an active assignment, and no open recall. */
export async function getRecallableEmployees(user) {
  assertCan(user, ACTIONS.RECALL_CREATE);
  const open = new Set((await getAll('recallRequests')).filter((r) => OPEN_STATUSES.includes(r.status)).map((r) => r.employeeID));
  const depts = user.departmentScope || [];
  const assignments = new Map((await getAll('assignments')).filter((a) => a.status === 'Active').map((a) => [a.assignmentID, a]));
  return (await getEmployees(user))
    .filter((e) => e.activeAssignmentID && assignments.has(e.activeAssignmentID) && !open.has(e.employeeID)
      && (user.systemRole !== ROLES.LEAD || depts.includes(e.department)) && (user.siteScope || []).includes(e.baseSite))
    .map((e) => ({ employee: e, assignment: assignments.get(e.activeAssignmentID) }));
}

/* ---------- checks ---------- */
const stamp = (user, action, from, to, comment = '') => ({ at: nowISO(), byUserID: user.userID, byRole: user.systemRole, byName: user.displayName || user.username || user.userID, action, from, to, comment });

function checkFields(d, assignment, { requireFutureDate }) {
  const errors = {};
  if (!d.employeeID) errors.employeeID = 'Choose an employee.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.proposedRecallDate) || Number.isNaN(new Date(d.proposedRecallDate).getTime())) errors.proposedRecallDate = 'Enter a valid recall date.';
  else if (assignment && d.proposedRecallDate < assignment.startDate) errors.proposedRecallDate = `The recall date cannot be before the deployment started (${assignment.startDate}).`;
  else if (requireFutureDate && d.proposedRecallDate < today()) errors.proposedRecallDate = 'The recall date cannot be in the past.';
  if (d.reason.length < 3) errors.reason = 'Give a reason for the recall.';
  return errors;
}

// Used when submitting AND again when confirming.
async function checkEligibility(tx, emp, assignmentID, ignoreRequestID) {
  const problems = [];
  const asg = assignmentID ? await tx.get('assignments', assignmentID) : null;
  if (!asg || asg.status !== 'Active' || asg.employeeID !== emp.employeeID || emp.activeAssignmentID !== assignmentID) {
    problems.push(`${emp.employeeName} is not currently deployed on this assignment, so there is nothing to recall.`);
  }
  const others = (await tx.getAll('recallRequests')).filter((r) => r.employeeID === emp.employeeID && r.requestID !== ignoreRequestID && OPEN_STATUSES.includes(r.status));
  if (others.length) problems.push(`${emp.employeeName} is already in another open recall request (${others[0].requestID}, ${others[0].status}).`);
  return problems;
}

const inEmployeeScope = (user, emp) => (user.siteScope || []).includes(emp.baseSite) || (user.siteScope || []).includes(emp.currentSite);
const clean = (d) => ({ employeeID: text(d.employeeID).toUpperCase(), proposedRecallDate: text(d.proposedRecallDate), reason: text(d.reason), remarks: text(d.remarks) });

/* ---------- create / edit (Lead) ---------- */
export async function createRecallRequest(user, data, { submit = true } = {}) {
  assertCan(user, ACTIONS.RECALL_CREATE);
  const d = clean(data);
  return write(STORES, async (tx) => {
    const emp = d.employeeID ? await tx.get('employees', d.employeeID) : null;
    if (!emp || !inEmployeeScope(user, emp)) throw new ValidationError({ employeeID: 'Choose an employee from your list.' });
    assertCan(user, ACTIONS.RECALL_CREATE, { site: emp.baseSite, department: emp.department });
    const asg = emp.activeAssignmentID ? await tx.get('assignments', emp.activeAssignmentID) : null;
    if (!asg || asg.status !== 'Active') throw new ValidationError({ employeeID: `${emp.employeeName} is not currently deployed.` });
    const errors = checkFields(d, asg, { requireFutureDate: submit });
    if (submit && !errors.employeeID) { const p = await checkEligibility(tx, emp, asg.assignmentID, null); if (p.length) errors.employeeID = p.join(' '); }
    if (Object.keys(errors).length) throw new ValidationError(errors);

    const now = nowISO();
    const status = submit ? 'Submitted' : 'Draft';
    const record = {
      requestID: newID('REC'), ...d, assignmentID: asg.assignmentID, status, version: 1, createdAt: now, updatedAt: now,
      requestedByUserID: user.userID, requestedByName: user.displayName || user.username,
      employeeName: emp.employeeName, employeeDepartment: emp.department, employeeBaseSite: emp.baseSite,
      assignmentSite: asg.site, assignmentProject: asg.project, assignmentRole: asg.role, assignmentStart: asg.startDate,
      history: [stamp(user, submit ? 'Submitted' : 'Saved as draft', null, status, d.reason)],
      decisionID: null, confirmedAt: null, confirmedBy: null,
    };
    await tx.put('recallRequests', record);
    await addAudit(tx, { actor: user, action: submit ? 'RECALL_SUBMITTED' : 'RECALL_DRAFT_SAVED', recordType: 'recallRequest', recordID: record.requestID, after: { employeeID: emp.employeeID, assignmentID: asg.assignmentID, status } });
    if (submit) await addNotification(tx, { type: 'RECALL_SUBMITTED', message: `${record.requestedByName} asked to recall ${emp.employeeName} from ${asg.site} (${asg.project}).`, targetRole: ROLES.PM, relatedRecordType: 'recallRequest', relatedRecordID: record.requestID });
    return record;
  });
}

/** Lead edits their own Draft or Returned request, optionally submitting it again. */
export async function updateRecallRequest(user, requestID, data, { submit = false, expectedVersion } = {}) {
  assertCan(user, ACTIONS.RECALL_CREATE);
  const d = clean(data);
  return write(STORES, async (tx) => {
    const r = await tx.get('recallRequests', requestID);
    if (!r || !canSee(user, r)) throw new Error('Request not found.');
    if (r.requestedByUserID !== user.userID) throw new PermissionError('You can edit only your own requests.');
    if (!['Draft', 'Returned'].includes(r.status)) throw new Error(`A request that is "${r.status}" can no longer be edited.`);
    if (expectedVersion != null && expectedVersion !== r.version) throw new Error('This request was changed by someone else. Reload the page and try again.');
    const emp = await tx.get('employees', r.employeeID);
    const asg = await tx.get('assignments', r.assignmentID);
    d.employeeID = r.employeeID;
    const errors = checkFields(d, asg, { requireFutureDate: submit });
    if (submit) { const p = await checkEligibility(tx, emp, r.assignmentID, r.requestID); if (p.length) errors.employeeID = p.join(' '); }
    if (Object.keys(errors).length) throw new ValidationError(errors);

    const to = submit ? nextStatus('submit', r.status) : r.status;
    const record = { ...r, ...d, status: to, version: r.version + 1, updatedAt: nowISO(), history: [...r.history, stamp(user, submit ? 'Resubmitted' : 'Edited', r.status, to, d.reason)] };
    await tx.put('recallRequests', record);
    await addAudit(tx, { actor: user, action: submit ? 'RECALL_RESUBMITTED' : 'RECALL_EDITED', recordType: 'recallRequest', recordID: r.requestID, before: { status: r.status }, after: { status: to } });
    if (submit) await addNotification(tx, { type: 'RECALL_SUBMITTED', message: `${record.requestedByName} resubmitted the recall request for ${record.employeeName}.`, targetRole: ROLES.PM, relatedRecordType: 'recallRequest', relatedRecordID: r.requestID });
    return record;
  });
}

/* ---------- decisions and actions ---------- */
const ACTION_RULES = {
  submit:      { label: 'Submitted', needsComment: false },
  startReview: { label: 'Review started', needsComment: false, perm: ACTIONS.RECALL_REVIEW },
  approve:     { label: 'Approved', needsComment: false, perm: ACTIONS.RECALL_DECIDE, decision: 'Approved' },
  reject:      { label: 'Rejected', needsComment: true, perm: ACTIONS.RECALL_DECIDE, decision: 'Rejected' },
  return:      { label: 'Sent back to the Lead', needsComment: true, perm: ACTIONS.RECALL_RETURN, decision: 'Returned' },
  confirm:     { label: 'Confirmed', needsComment: false, perm: ACTIONS.RECALL_CONFIRM },
  cancel:      { label: 'Cancelled', needsComment: false, perm: ACTIONS.RECALL_CANCEL },
};

export async function actOnRecall(user, requestID, action, { comment = '', expectedVersion } = {}) {
  const rule = ACTION_RULES[action];
  if (!rule) throw new Error(`Unknown action: ${action}`);
  const note = text(comment);

  return write(STORES, async (tx) => {
    const r = await tx.get('recallRequests', requestID);
    if (!r || !canSee(user, r)) throw new Error('Request not found.');
    if (expectedVersion != null && expectedVersion !== r.version) throw new Error('This request was changed by someone else. Reload the page and try again.');

    if (action === 'submit') {
      assertCan(user, ACTIONS.RECALL_CREATE, { site: r.employeeBaseSite, department: r.employeeDepartment });
      if (r.requestedByUserID !== user.userID) throw new PermissionError('You can submit only your own requests.');
    } else if (action === 'cancel') {
      assertCan(user, ACTIONS.RECALL_CANCEL, { requestedByUserID: r.requestedByUserID, site: r.assignmentSite });
      if (user.systemRole === ROLES.LEAD && !['Draft', 'Submitted', 'Returned'].includes(r.status)) throw new PermissionError('Only the Project Manager can cancel a request that is under review or approved.');
      if (user.systemRole === ROLES.PM && note.length < 3) throw new ValidationError({ comment: 'Give a reason for cancelling.' });
    } else {
      assertCan(user, rule.perm, { site: r.assignmentSite, requestedByUserID: r.requestedByUserID });
      assertCan(user, rule.perm, { site: r.employeeBaseSite });
    }
    if (rule.needsComment && note.length < 3) throw new ValidationError({ comment: action === 'reject' ? 'Give a reason for rejecting.' : 'Say what the Lead needs to change.' });

    const to = nextStatus(action, r.status);
    const emp = await tx.get('employees', r.employeeID);
    const now = nowISO();
    let record = { ...r, status: to, version: r.version + 1, updatedAt: now, history: [...r.history, stamp(user, rule.label, r.status, to, note)] };

    if (action === 'submit' || action === 'confirm') {
      const problems = await checkEligibility(tx, emp, r.assignmentID, r.requestID);
      if (problems.length) throw new ValidationError({ employeeID: problems.join(' ') });
    }
    if (action === 'submit' && r.proposedRecallDate < today()) throw new ValidationError({ proposedRecallDate: 'The recall date is now in the past. Edit the request first.' });

    if (rule.decision) {
      const decision = { decisionID: newID('DEC'), requestType: 'recall', requestID: r.requestID, decision: rule.decision, decidedByUserID: user.userID, comment: note, decidedAt: now };
      await tx.put('decisions', decision);
      record.decisionID = decision.decisionID;
    }

    if (action === 'confirm') {
      const asg = await tx.get('assignments', r.assignmentID);
      await tx.put('assignments', { ...asg, status: 'Completed', endDate: r.proposedRecallDate, endedByRecallRequestID: r.requestID });
      const back = {
        ...emp, deploymentStatus: emp.status === 'Active' ? 'Available' : 'Unavailable', activeAssignmentID: null,
        currentSite: emp.baseSite, currentProject: '', updatedAt: now, updatedBy: user.userID,
      };
      await tx.put('employees', back);
      record = { ...record, confirmedAt: now, confirmedBy: user.userID };
      await addAudit(tx, { actor: user, action: 'EMPLOYEE_RECALLED', recordType: 'employee', recordID: emp.employeeID,
        before: { deploymentStatus: emp.deploymentStatus, currentSite: emp.currentSite, currentProject: emp.currentProject, activeAssignmentID: emp.activeAssignmentID },
        after: { deploymentStatus: back.deploymentStatus, currentSite: back.currentSite, currentProject: back.currentProject, activeAssignmentID: null }, reason: `Recall ${r.requestID} confirmed` });
    }

    await tx.put('recallRequests', record);
    await addAudit(tx, { actor: user, action: `RECALL_${action.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`, recordType: 'recallRequest', recordID: r.requestID, before: { status: r.status }, after: { status: to }, reason: note });

    if (action === 'submit') await addNotification(tx, { type: 'RECALL_SUBMITTED', message: `${r.requestedByName} submitted the recall request for ${r.employeeName}.`, targetRole: ROLES.PM, relatedRecordType: 'recallRequest', relatedRecordID: r.requestID });
    else if (action !== 'startReview') await addNotification(tx, { type: `RECALL_${to.toUpperCase().replace(' ', '_')}`, message: `Recall request ${r.requestID} for ${r.employeeName} is now: ${to}.${note ? ` Comment: ${note}` : ''}`, targetUserIDs: [r.requestedByUserID], relatedRecordType: 'recallRequest', relatedRecordID: r.requestID });
    return record;
  });
}
