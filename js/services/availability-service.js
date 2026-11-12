// One definition of "available", used by every page so the numbers can never disagree.
// An employee is available only if they are Active, marked Available, and have no active assignment.
import { getAll } from '../core/store.js';
import { ACTIONS, assertCan } from '../core/access-control.js';
import { ROLES } from '../core/constants.js';
import { DEPARTMENTS } from '../core/reference-data.js';
import { getEmployees } from './employee-service.js';

export function availabilityOf(emp) {
  if (emp.status !== 'Active') return { available: false, reason: `Employee status is ${emp.status}.` };
  if (emp.activeAssignmentID) return { available: false, reason: 'Currently assigned to a deployment.' };
  if (emp.deploymentStatus !== 'Available') return { available: false, reason: `Deployment status is ${emp.deploymentStatus}.` };
  return { available: true, reason: '' };
}

export const STATES = Object.freeze({ AVAILABLE: 'Available', DEPLOYED: 'Deployed', UNAVAILABLE: 'Unavailable' });

/** Every employee is in exactly one of three states, so the counts always add up. */
export function availabilityState(emp) {
  if (availabilityOf(emp).available) return STATES.AVAILABLE;
  if (emp.status === 'Active' && emp.activeAssignmentID) return STATES.DEPLOYED;
  return STATES.UNAVAILABLE;
}

/** Exited employees are no longer part of the workforce, so reports leave them out. */
export const isCurrentStaff = (emp) => emp.status !== 'Exited';

export const departmentName = (code) => DEPARTMENTS.find((d) => d.code === code)?.name || code || '(none)';

const blank = () => ({ headcount: 0, available: 0, deployed: 0, unavailable: 0 });
const bump = (row, state) => { row.headcount += 1; row[state.toLowerCase()] += 1; };

/**
 * Pure function: counts people by site, department and project.
 * - A person belongs to their BASE site. Base headcount = Available + Deployed + Unavailable.
 * - "Deployed in" counts people from other sites who are currently working at this site.
 * @param {object[]} employees
 * @param {{scope?: string[]|null, sites?: string[]}} [options] scope null = every site; sites = rows to show even when empty
 */
export function summariseAvailability(employees, { scope = null, sites = [] } = {}) {
  const inScope = (code) => !scope || scope.includes(code);
  const staff = employees.filter(isCurrentStaff);
  const totals = blank();
  const bySite = new Map(sites.filter(inScope).map((s) => [s, { site: s, ...blank(), deployedIn: 0 }]));
  const byDept = new Map();
  const alloc = new Map();
  const siteRow = (code) => {
    if (!bySite.has(code)) bySite.set(code, { site: code, ...blank(), deployedIn: 0 });
    return bySite.get(code);
  };

  for (const e of staff) {
    const state = availabilityState(e);
    if (inScope(e.baseSite)) {
      bump(totals, state);
      bump(siteRow(e.baseSite), state);
      const d = e.department || '';
      if (!byDept.has(d)) byDept.set(d, { department: d, name: departmentName(d), ...blank() });
      bump(byDept.get(d), state);
    }
    if (state === STATES.DEPLOYED && inScope(e.currentSite)) {
      if (e.currentSite !== e.baseSite) siteRow(e.currentSite).deployedIn += 1;
      const key = `${e.currentSite}|${e.currentProject || '(no project)'}`;
      const row = alloc.get(key) || { site: e.currentSite, project: e.currentProject || '(no project)', count: 0 };
      row.count += 1;
      alloc.set(key, row);
    }
  }
  return {
    totals,
    bySite: [...bySite.values()].sort((a, b) => a.site.localeCompare(b.site)),
    byDepartment: [...byDept.values()].sort((a, b) => b.headcount - a.headcount || a.name.localeCompare(b.name)),
    allocation: [...alloc.values()].sort((a, b) => a.site.localeCompare(b.site) || a.project.localeCompare(b.project)),
  };
}

/** What this user may see: the summary tables plus the list of people, each with their state. */
export async function getAvailabilityReport(user) {
  assertCan(user, ACTIONS.VIEW_PAGES);
  const employees = (await getEmployees(user)).filter(isCurrentStaff);
  const scope = user.systemRole === ROLES.ADMIN ? null : (user.siteScope || []);
  const siteCodes = (await getAll('sites')).map((s) => s.siteCode);
  const summary = summariseAvailability(employees, { scope, sites: siteCodes });
  const people = employees.map((e) => ({ ...e, state: availabilityState(e), reason: availabilityOf(e).reason }));
  return { ...summary, people };
}
