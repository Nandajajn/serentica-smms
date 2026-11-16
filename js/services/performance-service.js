// Performance: a Project Manager records a review per employee per quarter (five criteria, rated 1 to 5).
// The overall rating is the average, worked out here and never typed in. Ratings help deployment decisions:
// the Performance page shows who is strong AND available. Every save writes the review and its audit event
// in ONE transaction. The audit event is filed against the employee so it shows in their history.
import { getAll, write } from '../core/store.js';
import { ACTIONS, PermissionError, assertCan } from '../core/access-control.js';
import { ROLES } from '../core/constants.js';
import { newID, nowISO } from '../core/utils.js';
import { ValidationError } from '../core/validators.js';
import { addAudit } from './audit-service.js';
import { getEmployees } from './employee-service.js';
import { availabilityState, departmentName, isCurrentStaff } from './availability-service.js';

export const CRITERIA = Object.freeze([
  { key: 'quality', label: 'Work quality' },
  { key: 'safety', label: 'Safety compliance' },
  { key: 'punctuality', label: 'Attendance and punctuality' },
  { key: 'teamwork', label: 'Teamwork' },
  { key: 'technical', label: 'Technical skill' },
]);
export const RATING_LABELS = Object.freeze({ 5: 'Excellent', 4: 'Good', 3: 'Meets expectations', 2: 'Below expectations', 1: 'Poor' });
export const BANDS = Object.freeze({ STRONG: 'Strong', SATISFACTORY: 'Satisfactory', SUPPORT: 'Needs support', NONE: 'Not assessed' });
export const STRONG_FROM = 4;   // overall 4.0 or more
export const SUPPORT_BELOW = 3; // overall under 3.0

const round1 = (n) => Math.round(n * 10) / 10;
const text = (v) => String(v ?? '').trim();
const PERIOD_PATTERN = /^\d{4}-Q[1-4]$/;

/* ---------- pure rules (tested without a database) ---------- */

export const overallOf = (ratings) => round1(CRITERIA.reduce((sum, c) => sum + Number(ratings[c.key]), 0) / CRITERIA.length);

export function bandOf(overall) {
  if (overall === null || overall === undefined) return BANDS.NONE;
  if (overall >= STRONG_FROM) return BANDS.STRONG;
  if (overall >= SUPPORT_BELOW) return BANDS.SATISFACTORY;
  return BANDS.SUPPORT;
}

export const periodOf = (date = new Date()) => `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;

/** The current quarter and the three before it, newest first. */
export function periodOptions(now = new Date()) {
  let year = now.getFullYear();
  let q = Math.floor(now.getMonth() / 3) + 1;
  const out = [];
  for (let i = 0; i < 4; i += 1) {
    out.push(`${year}-Q${q}`);
    q -= 1;
    if (q === 0) { q = 4; year -= 1; }
  }
  return out;
}

/** Returns { field: message }. Empty object means the review is valid. */
export function validateReview(d) {
  const errors = {};
  if (!d.employeeID) errors.employeeID = 'Choose an employee.';
  if (!PERIOD_PATTERN.test(d.period)) errors.period = 'Choose a review period such as 2026-Q4.';
  let complete = true;
  for (const c of CRITERIA) {
    const v = Number(d.ratings?.[c.key]);
    if (!Number.isInteger(v) || v < 1 || v > 5) { errors[c.key] = `Rate ${c.label.toLowerCase()} from 1 to 5.`; complete = false; }
  }
  if (d.comments.length > 500) errors.comments = 'Keep the comment under 500 characters.';
  if (complete && overallOf(d.ratings) < SUPPORT_BELOW && d.comments.length < 3) {
    errors.comments = 'Add a short comment explaining a rating below 3.';
  }
  return errors;
}

const newerFirst = (a, b) => b.period.localeCompare(a.period) || b.updatedAt.localeCompare(a.updatedAt);

/**
 * Counts and averages by site and department, from each person's LATEST review.
 * A person belongs to their base site, as on the Availability page. Exited employees are left out.
 * @param {object[]} employees
 * @param {object[]} reviews
 * @param {{scope?: string[]|null, sites?: string[]}} [options] scope null = every site
 */
export function summarisePerformance(employees, reviews, { scope = null, sites = [] } = {}) {
  const inScope = (code) => !scope || scope.includes(code);
  const latest = new Map();
  for (const r of [...reviews].sort(newerFirst)) if (!latest.has(r.employeeID)) latest.set(r.employeeID, r);
  const count = new Map();
  for (const r of reviews) count.set(r.employeeID, (count.get(r.employeeID) || 0) + 1);

  const people = employees.filter(isCurrentStaff).map((e) => {
    const r = latest.get(e.employeeID) || null;
    const overall = r ? r.overall : null;
    return { ...e, state: availabilityState(e), overall, band: bandOf(overall), latestPeriod: r ? r.period : '', reviewCount: count.get(e.employeeID) || 0 };
  });

  const blank = () => ({ headcount: 0, assessed: 0, sum: 0, strong: 0, satisfactory: 0, support: 0, notAssessed: 0 });
  const bump = (row, p) => {
    row.headcount += 1;
    if (p.overall === null) { row.notAssessed += 1; return; }
    row.assessed += 1; row.sum += p.overall;
    if (p.band === BANDS.STRONG) row.strong += 1; else if (p.band === BANDS.SATISFACTORY) row.satisfactory += 1; else row.support += 1;
  };
  const finish = ({ sum, ...row }) => ({ ...row, average: row.assessed ? round1(sum / row.assessed) : null });

  const totals = blank();
  const bySite = new Map(sites.filter(inScope).map((s) => [s, { site: s, ...blank() }]));
  const byDept = new Map();
  for (const p of people.filter((x) => inScope(x.baseSite))) {
    bump(totals, p);
    if (!bySite.has(p.baseSite)) bySite.set(p.baseSite, { site: p.baseSite, ...blank() });
    bump(bySite.get(p.baseSite), p);
    const d = p.department || '';
    if (!byDept.has(d)) byDept.set(d, { department: d, name: departmentName(d), ...blank() });
    bump(byDept.get(d), p);
  }
  return {
    totals: finish(totals),
    bySite: [...bySite.values()].map(finish).sort((a, b) => a.site.localeCompare(b.site)),
    byDepartment: [...byDept.values()].map(finish).sort((a, b) => b.headcount - a.headcount || a.name.localeCompare(b.name)),
    people,
  };
}

/* ---------- reads (scope comes from getEmployees, so nobody sees a review for someone they cannot see) ---------- */

async function visibleReviews(user) {
  const ids = new Set((await getEmployees(user)).map((e) => e.employeeID));
  return (await getAll('performanceReviews')).filter((r) => ids.has(r.employeeID)).sort(newerFirst);
}

export async function getEmployeeReviews(user, employeeID) {
  assertCan(user, ACTIONS.VIEW_PAGES);
  const id = text(employeeID).toUpperCase();
  return (await visibleReviews(user)).filter((r) => r.employeeID === id);
}

export async function getPerformanceReport(user) {
  assertCan(user, ACTIONS.VIEW_PAGES);
  const employees = await getEmployees(user);
  const ids = new Set(employees.map((e) => e.employeeID));
  const reviews = (await getAll('performanceReviews')).filter((r) => ids.has(r.employeeID));
  const scope = user.systemRole === ROLES.ADMIN ? null : (user.siteScope || []);
  const siteCodes = (await getAll('sites')).map((s) => s.siteCode);
  return summarisePerformance(employees, reviews, { scope, sites: siteCodes });
}

/* ---------- write (Project Manager only) ---------- */

/**
 * Record a review, or replace the existing one for the same employee and period.
 * @param {object} user
 * @param {{employeeID:string, period:string, ratings:Record<string,number|string>, comments?:string}} data
 */
export async function saveReview(user, data) {
  assertCan(user, ACTIONS.REVIEW_RECORD); // Admin and Lead stop here
  const input = {
    employeeID: text(data.employeeID).toUpperCase(),
    period: text(data.period),
    ratings: Object.fromEntries(CRITERIA.map((c) => [c.key, Number(data.ratings?.[c.key])])),
    comments: text(data.comments),
  };
  const errors = validateReview(input);
  if (Object.keys(errors).length) throw new ValidationError(errors);

  return write(['performanceReviews', 'employees', 'auditEvents'], async (tx) => {
    const emp = await tx.get('employees', input.employeeID);
    const scope = user.siteScope || [];
    if (!emp || !(scope.includes(emp.baseSite) || scope.includes(emp.currentSite))) throw new Error('Employee not found.'); // out of scope looks the same as missing
    if (emp.status === 'Exited') throw new ValidationError({ employeeID: `${emp.employeeName} has exited, so a new review cannot be recorded.` });
    if (user.linkedEmployeeID && user.linkedEmployeeID === emp.employeeID) throw new PermissionError('You cannot review yourself.');

    const existing = (await tx.getAll('performanceReviews')).find((r) => r.employeeID === emp.employeeID && r.period === input.period) || null;
    const record = {
      reviewID: existing ? existing.reviewID : newID('REV'),
      employeeID: emp.employeeID, employeeName: emp.employeeName, baseSite: emp.baseSite, department: emp.department,
      period: input.period, ratings: input.ratings, overall: overallOf(input.ratings), comments: input.comments,
      reviewerUserID: user.userID, reviewerName: user.displayName || user.username || user.userID,
      createdAt: existing ? existing.createdAt : nowISO(), updatedAt: nowISO(),
    };
    await tx.put('performanceReviews', record);
    await addAudit(tx, {
      actor: user, action: existing ? 'PERFORMANCE_REVIEW_UPDATE' : 'PERFORMANCE_REVIEW_ADD', recordType: 'employee', recordID: emp.employeeID,
      before: existing ? { period: existing.period, overall: existing.overall } : null, after: { period: record.period, overall: record.overall },
      reason: `${existing ? 'Updated' : 'Recorded'} review for ${record.period}: overall ${record.overall} of 5 (${bandOf(record.overall)}).`,
    });
    return record;
  });
}
