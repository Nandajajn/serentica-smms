// Activity: the audit history of changes, limited to what this user may see.
// (Notifications come from notification-service.js.)
import { getAll } from '../core/store.js';
import { ACTIONS, assertCan } from '../core/access-control.js';
import { ROLES } from '../core/constants.js';
import { getAuditHistory } from './audit-service.js';
import { getEmployees } from './employee-service.js';
import { getDeploymentRequests } from './deployment-service.js';
import { getRecallRequests } from './recall-service.js';

/** "DEPLOYMENT_START_REVIEW" -> "Deployment start review" */
export function humanAction(action) {
  const words = String(action || '').toLowerCase().replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

const RECORD_PAGES = { employee: 'employee-profile.html', deploymentRequest: 'deployments.html', recallRequest: 'recalls.html' };
export const RECORD_LABELS = Object.freeze({
  employee: 'Employee', deploymentRequest: 'Deployment request', recallRequest: 'Recall request',
  importBatch: 'Excel import', uploadedFile: 'Uploaded file', user: 'User', system: 'System',
});

/** Link to the record an event or notification is about, or null if there is no page for it. */
export function recordLink(recordType, recordID) {
  const page = RECORD_PAGES[recordType];
  return page && recordID ? `${page}?id=${encodeURIComponent(recordID)}` : null;
}

/**
 * Audit events this user may see, newest first, each with the actor's name.
 * Admin sees everything. A Lead or PM sees events about records they can open (employees in their sites,
 * requests they can see) plus everything they did themselves. Events about imports, files and users are
 * visible only to the person who did them, because those records have no site.
 */
export async function getVisibleAuditEvents(user) {
  assertCan(user, ACTIONS.VIEW_AUDIT);
  const events = await getAuditHistory(user);
  const names = new Map((await getAll('users')).map((u) => [u.userID, u.displayName || u.username || u.userID]));
  const label = (e) => (e.actorUserID ? names.get(e.actorUserID) || e.actorUserID : 'System');
  const decorate = (list) => list.map((e) => ({ ...e, actorName: label(e) }));
  if (user.systemRole === ROLES.ADMIN) return decorate(events);

  const [employees, deployments, recalls] = await Promise.all([getEmployees(user), getDeploymentRequests(user), getRecallRequests(user)]);
  const visible = {
    employee: new Set(employees.map((e) => e.employeeID)),
    deploymentRequest: new Set(deployments.map((r) => r.requestID)),
    recallRequest: new Set(recalls.map((r) => r.requestID)),
  };
  return decorate(events.filter((e) => e.actorUserID === user.userID || visible[e.recordType]?.has(e.recordID)));
}
