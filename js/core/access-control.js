// Central permission rules. Every service function will call assertCan() before it
// reads or writes protected data, and the UI uses can() to hide or disable controls.
// The interface is never the security boundary. In production the same rules must be
// enforced again on the server.
//
// Default is DENY: an action that is not listed for a role is refused.
import { ROLES } from './constants.js';

export const ACTIONS = Object.freeze({
  // reading
  VIEW_PAGES: 'view.pages',                  // dashboards, org, requests, reports, history
  VIEW_EMPLOYEES: 'view.employees',
  VIEW_SENSITIVE: 'view.sensitive',          // date of birth, blood group, emergency contact
  VIEW_AUDIT: 'view.audit',
  EXPORT_DATA: 'export.data',
  // employee changes
  EMPLOYEE_ADD: 'employee.add',
  EMPLOYEE_EDIT_OPERATIONAL: 'employee.editOperational', // phone, email, shift, address
  EMPLOYEE_EDIT_RESTRICTED: 'employee.editRestricted',   // all other editable fields
  // deployment
  DEPLOYMENT_CREATE: 'deployment.create',
  DEPLOYMENT_CANCEL: 'deployment.cancel',
  DEPLOYMENT_REVIEW: 'deployment.review',
  DEPLOYMENT_DECIDE: 'deployment.decide',    // approve or reject
  DEPLOYMENT_RETURN: 'deployment.return',    // send back to the Lead for changes
  DEPLOYMENT_CONFIRM: 'deployment.confirm',
  // recall
  RECALL_CREATE: 'recall.create',
  RECALL_CANCEL: 'recall.cancel',
  RECALL_REVIEW: 'recall.review',
  RECALL_DECIDE: 'recall.decide',
  RECALL_RETURN: 'recall.return',
  RECALL_CONFIRM: 'recall.confirm',
  // Excel import
  IMPORT_UPLOAD: 'import.upload',
  IMPORT_CONFIRM: 'import.confirm',
  FILE_REMOVE: 'file.remove',                // removes the file reference only
});
const A = ACTIONS;

// Admin is read-only: ONLY these actions, nothing that changes data.
const READ_ONLY_ACTIONS = [A.VIEW_PAGES, A.VIEW_EMPLOYEES, A.VIEW_SENSITIVE, A.VIEW_AUDIT, A.EXPORT_DATA];

const RULES = {
  [ROLES.ADMIN]: READ_ONLY_ACTIONS,
  // Lead: edits employee records (within scope) and raises requests. No approvals.
  [ROLES.LEAD]: [
    A.VIEW_PAGES, A.VIEW_EMPLOYEES, A.VIEW_SENSITIVE, A.VIEW_AUDIT, A.EXPORT_DATA,
    A.EMPLOYEE_ADD, A.EMPLOYEE_EDIT_OPERATIONAL, A.EMPLOYEE_EDIT_RESTRICTED,
    A.DEPLOYMENT_CREATE, A.DEPLOYMENT_CANCEL,
    A.RECALL_CREATE, A.RECALL_CANCEL,
  ],
  // Project Manager: same edit rights as a Lead, plus the ONLY approval authority.
  [ROLES.PM]: [
    A.VIEW_PAGES, A.VIEW_EMPLOYEES, A.VIEW_SENSITIVE, A.VIEW_AUDIT, A.EXPORT_DATA,
    A.EMPLOYEE_ADD, A.EMPLOYEE_EDIT_OPERATIONAL, A.EMPLOYEE_EDIT_RESTRICTED,
    A.DEPLOYMENT_REVIEW, A.DEPLOYMENT_DECIDE, A.DEPLOYMENT_RETURN, A.DEPLOYMENT_CONFIRM, A.DEPLOYMENT_CANCEL,
    A.RECALL_REVIEW, A.RECALL_DECIDE, A.RECALL_RETURN, A.RECALL_CONFIRM, A.RECALL_CANCEL,
    A.IMPORT_UPLOAD, A.IMPORT_CONFIRM, A.FILE_REMOVE,
  ],
};

const DECISION_ACTIONS = [A.DEPLOYMENT_DECIDE, A.DEPLOYMENT_RETURN, A.DEPLOYMENT_CONFIRM, A.RECALL_DECIDE, A.RECALL_RETURN, A.RECALL_CONFIRM];
const CANCEL_ACTIONS = [A.DEPLOYMENT_CANCEL, A.RECALL_CANCEL];

export class PermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermissionError';
  }
}

/**
 * @param {{userID?:string, systemRole:string, siteScope?:string[], departmentScope?:string[]}|null} user
 * @param {string} action  one of ACTIONS
 * @param {{site?:string, department?:string, requestedByUserID?:string, status?:string}} [context]
 * @returns {{allowed:boolean, reason:string}}
 */
export function check(user, action, context = {}) {
  if (!user || !Object.values(ROLES).includes(user.systemRole)) return deny('You are not signed in.');
  if (!Object.values(ACTIONS).includes(action)) return deny(`Unknown action: ${action}`);
  if (!RULES[user.systemRole].includes(action)) return deny('Your role is not allowed to do this.');

  // Admin sees everything; Lead and PM are limited to their assigned sites/departments.
  // An empty scope means NO access (never "everything").
  if (user.systemRole !== ROLES.ADMIN) {
    if (context.site && !(user.siteScope || []).includes(context.site)) {
      return deny('This record is outside your site.');
    }
    if (user.systemRole === ROLES.LEAD && context.department
        && !(user.departmentScope || []).includes(context.department)) {
      return deny('This record is outside your department.');
    }
  }
  // Nobody may approve or confirm a request they raised themselves.
  if (DECISION_ACTIONS.includes(action) && context.requestedByUserID && context.requestedByUserID === user.userID) {
    return deny('You cannot approve or confirm your own request.');
  }
  // A Lead may cancel only their own request, and only before approval.
  if (CANCEL_ACTIONS.includes(action) && user.systemRole === ROLES.LEAD) {
    if (context.requestedByUserID !== user.userID) return deny('You can cancel only your own requests.');
  }
  if (CANCEL_ACTIONS.includes(action) && context.status && !['Draft', 'Submitted', 'Approved'].includes(context.status)) {
    return deny('This request can no longer be cancelled.');
  }
  if (CANCEL_ACTIONS.includes(action) && user.systemRole === ROLES.LEAD && context.status === 'Approved') {
    return deny('Only the Project Manager can cancel an approved request.');
  }
  return { allowed: true, reason: '' };
}

function deny(reason) {
  return { allowed: false, reason };
}

export const can = (user, action, context) => check(user, action, context).allowed;

/** Use inside services: throws PermissionError instead of returning false. */
export function assertCan(user, action, context) {
  const result = check(user, action, context);
  if (!result.allowed) throw new PermissionError(result.reason);
}

export const isReadOnly = (user) => user?.systemRole === ROLES.ADMIN;
