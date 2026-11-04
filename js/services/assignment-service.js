// Read-only view of an employee's deployment assignments (created when a deployment is confirmed,
// completed when a recall is confirmed).
import { getAll } from '../core/store.js';
import { ACTIONS, assertCan } from '../core/access-control.js';
import { getEmployeeById } from './employee-service.js';

/** Newest first. Returns [] if the employee is not visible to this user. */
export async function getEmployeeAssignments(user, employeeID) {
  assertCan(user, ACTIONS.VIEW_EMPLOYEES);
  if (!(await getEmployeeById(user, employeeID))) return [];
  return (await getAll('assignments')).filter((a) => a.employeeID === employeeID).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
