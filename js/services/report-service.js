// Reports. Every report is a plain table {key, title, description, columns, rows} so one page can show
// any of them and one function can export any of them to CSV. Numbers come from the same services the
// other pages use, so a report can never disagree with a page.
import { ACTIONS, assertCan } from '../core/access-control.js';
import { ROLES } from '../core/constants.js';
import { DEPARTMENTS } from '../core/reference-data.js';
import { OPEN_STATUSES, STATUS_LABELS } from '../core/workflow.js';
import { toCSV } from '../core/csv.js';
import { getEmployees } from './employee-service.js';
import { getDeploymentRequests } from './deployment-service.js';
import { getRecallRequests } from './recall-service.js';
import { departmentName, getAvailabilityReport, isCurrentStaff } from './availability-service.js';

const DAY = 24 * 60 * 60 * 1000;
export const STALE_AFTER_DAYS = 3; // an open request waiting longer than this is flagged
const STATUS_ORDER = ['Draft', 'Submitted', 'Under Review', 'Returned', 'Approved', 'Rejected', 'Confirmed', 'Cancelled'];
const days = (from, to) => (new Date(to) - new Date(from)) / DAY;
const avg = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null);

/* ---------- pure builders (tested without a database) ---------- */

/** Department x base site. Exited employees are left out. */
export function headcountTable(employees, siteCodes) {
  const staff = employees.filter(isCurrentStaff);
  const sites = [...new Set([...siteCodes, ...staff.map((e) => e.baseSite)])].sort();
  const depts = [...DEPARTMENTS.map((d) => d.code), ...new Set(staff.map((e) => e.department).filter((d) => d && !DEPARTMENTS.some((x) => x.code === d)))];
  const rows = depts.map((d) => {
    const counts = sites.map((s) => staff.filter((e) => e.department === d && e.baseSite === s).length);
    return [departmentName(d), ...counts, counts.reduce((a, b) => a + b, 0)];
  }).filter((r) => r[r.length - 1] > 0);
  const totals = sites.map((s, i) => rows.reduce((sum, r) => sum + r[i + 1], 0));
  rows.push(['Total', ...totals, totals.reduce((a, b) => a + b, 0)]);
  return { columns: ['Department', ...sites, 'Total'], rows };
}

/** Employment type x employee status. */
export function statusTable(employees) {
  const staff = employees.filter(isCurrentStaff);
  const statuses = ['Active', 'On Leave', 'Inactive'];
  const types = [...new Set(staff.map((e) => e.employmentType || '(not set)'))].sort();
  const rows = types.map((t) => {
    const counts = statuses.map((s) => staff.filter((e) => (e.employmentType || '(not set)') === t && e.status === s).length);
    return [t, ...counts, counts.reduce((a, b) => a + b, 0)];
  });
  const totals = statuses.map((_, i) => rows.reduce((sum, r) => sum + r[i + 1], 0));
  rows.push(['Total', ...totals, totals.reduce((a, b) => a + b, 0)]);
  return { columns: ['Employment type', ...statuses, 'Total'], rows };
}

function firstAt(request, predicate) {
  return (request.history || []).find(predicate)?.at || null;
}

/** One row per kind of request: counts by status, how long decisions take, and what is stuck. */
export function workflowSummary(kind, requests, now = new Date()) {
  const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
  const toDecision = [];
  const toConfirm = [];
  const stale = [];
  for (const r of requests) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const submitted = firstAt(r, (h) => h.to === 'Submitted');
    const decided = firstAt(r, (h) => h.to === 'Approved' || h.to === 'Rejected');
    const confirmed = firstAt(r, (h) => h.to === 'Confirmed');
    if (submitted && decided) toDecision.push(days(submitted, decided));
    if (submitted && confirmed) toConfirm.push(days(submitted, confirmed));
    if (OPEN_STATUSES.includes(r.status)) {
      const waiting = days(r.updatedAt, now);
      if (waiting >= STALE_AFTER_DAYS) {
        stale.push({ kind, requestID: r.requestID, employee: r.employeeName, status: r.status,
          waitingOn: r.status === 'Returned' ? 'Lead' : 'Project Manager', daysWaiting: Math.floor(waiting) });
      }
    }
  }
  const decided = byStatus.Approved + byStatus.Rejected + byStatus.Confirmed;
  return {
    kind, total: requests.length, byStatus,
    open: requests.filter((r) => OPEN_STATUSES.includes(r.status)).length,
    rejectionRate: decided ? Math.round((byStatus.Rejected / decided) * 100) : null,
    avgDaysToDecision: avg(toDecision), avgDaysToConfirm: avg(toConfirm), stale,
  };
}

/* ---------- reports for one user (scope is applied by the services below) ---------- */
export async function getReports(user, now = new Date()) {
  assertCan(user, ACTIONS.VIEW_PAGES);
  const [employees, availability, deployments, recalls] = await Promise.all([
    getEmployees(user), getAvailabilityReport(user), getDeploymentRequests(user), getRecallRequests(user)]);
  const siteCodes = availability.bySite.map((s) => s.site);
  const own = user.systemRole === ROLES.LEAD;
  const scopeNote = own ? 'Shows only the requests you raised.' : user.systemRole === ROLES.PM ? 'Shows requests for your sites (drafts are private to the Lead).' : 'Shows all requests.';

  const headcount = headcountTable(employees.filter((e) => siteCodes.includes(e.baseSite) || user.systemRole === ROLES.ADMIN), siteCodes);
  const status = statusTable(employees.filter((e) => siteCodes.includes(e.baseSite) || user.systemRole === ROLES.ADMIN));
  const flows = [workflowSummary('Deployment', deployments, now), workflowSummary('Recall', recalls, now)];
  const stale = flows.flatMap((f) => f.stale).sort((a, b) => b.daysWaiting - a.daysWaiting);
  const money = (v) => (v === null ? '-' : v);

  return [
    { key: 'headcount', title: 'Headcount by department and base site', description: 'Current staff (Active, On Leave, Inactive). Exited employees are not counted.', ...headcount },
    { key: 'status', title: 'Headcount by employment type and status', description: 'Current staff only.', ...status },
    { key: 'availability-site', title: 'Availability by site',
      description: 'Based at the site. Base headcount = Available + Deployed + Unavailable. "Deployed in" are people from other sites working here.',
      columns: ['Site', 'Base headcount', 'Available', 'Deployed', 'Unavailable', 'Deployed in from other sites'],
      rows: availability.bySite.map((s) => [s.site, s.headcount, s.available, s.deployed, s.unavailable, s.deployedIn]) },
    { key: 'availability-dept', title: 'Availability by department', description: 'Same definition of available as the Availability page.',
      columns: ['Department', 'Headcount', 'Available', 'Deployed', 'Unavailable'],
      rows: availability.byDepartment.map((d) => [d.name, d.headcount, d.available, d.deployed, d.unavailable]) },
    { key: 'allocation', title: 'Who is deployed where', description: 'People on an active deployment, by the site and project they are working on now.',
      columns: ['Site', 'Project', 'People deployed'], rows: availability.allocation.map((a) => [a.site, a.project, a.count]) },
    { key: 'workflow', title: 'Deployment and recall requests', description: `${scopeNote} Days are counted from first submission.`,
      columns: ['Type', 'Total', ...STATUS_ORDER.map((s) => STATUS_LABELS[s] || s), 'Open now', 'Rejection rate', 'Avg days to decision', 'Avg days to confirm'],
      rows: flows.map((f) => [f.kind, f.total, ...STATUS_ORDER.map((s) => f.byStatus[s] || 0), f.open, f.rejectionRate === null ? '-' : `${f.rejectionRate}%`, money(f.avgDaysToDecision), money(f.avgDaysToConfirm)]) },
    { key: 'stale', title: `Requests waiting more than ${STALE_AFTER_DAYS} days`, description: 'Open requests that have not moved. The "waiting on" column says who has to act next.',
      columns: ['Type', 'Request', 'Employee', 'Status', 'Waiting on', 'Days waiting'],
      rows: stale.map((s) => [s.kind, s.requestID, s.employee, STATUS_LABELS[s.status] || s.status, s.waitingOn, s.daysWaiting]) },
  ];
}

/** CSV text for one report. Cells that start with = + - @ are neutralised by toCSV. */
export function reportToCSV(report) {
  return toCSV([report.columns, ...report.rows]);
}
