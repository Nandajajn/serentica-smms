// Validation rules for employee records. Used by the service layer, so the rules
// apply no matter which page (or import) the data comes from.
import {
  BLOOD_GROUPS, DEPARTMENTS, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, ORG_ROLES,
} from './reference-data.js';

export class ValidationError extends Error {
  constructor(errors) {
    super(Object.values(errors).join(' '));
    this.name = 'ValidationError';
    this.errors = errors; // { fieldName: 'message' }
  }
}

/** Trim text, upper-case IDs, lower-case email, tidy empty values. */
export function normaliseEmployee(data) {
  const out = { ...data };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === 'string') out[key] = value.trim();
  }
  if (out.employeeID) out.employeeID = out.employeeID.toUpperCase();
  if (out.email) out.email = out.email.toLowerCase();
  if ('reportingManagerID' in out) out.reportingManagerID = out.reportingManagerID ? String(out.reportingManagerID).toUpperCase() : null;
  if ('experienceYears' in out) out.experienceYears = out.experienceYears === '' || out.experienceYears == null ? null : Number(out.experienceYears);
  return out;
}

const ID_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {object} emp   normalised employee
 * @param {{employees:object[], siteCodes:string[], isNew:boolean}} ctx
 * @returns {Record<string,string>} errors by field (empty object = valid)
 */
export function validateEmployee(emp, { employees, siteCodes, isNew }) {
  const errors = {};
  const others = employees.filter((e) => e.employeeID !== emp.employeeID);

  if (!emp.employeeID) errors.employeeID = 'Employee ID is required.';
  else if (!ID_PATTERN.test(emp.employeeID)) errors.employeeID = 'Employee ID must be 2 to 20 letters, numbers, dashes or underscores.';
  else if (isNew && employees.some((e) => e.employeeID === emp.employeeID)) errors.employeeID = `Employee ID ${emp.employeeID} already exists.`;

  if (!emp.employeeName || emp.employeeName.length < 2) errors.employeeName = 'Employee name is required.';

  if (!DEPARTMENTS.some((d) => d.code === emp.department)) errors.department = 'Choose a valid department.';
  if (!ORG_ROLES.some((r) => r.code === emp.role)) errors.role = 'Choose a valid role.';
  if (!EMPLOYMENT_TYPES.includes(emp.employmentType)) errors.employmentType = 'Employment type must be On-roll or Off-role.';
  if (!EMPLOYEE_STATUSES.includes(emp.status)) errors.status = 'Choose a valid status.';
  if (!siteCodes.includes(emp.baseSite)) errors.baseSite = 'Choose a valid site.';

  if (emp.email) {
    if (!EMAIL_PATTERN.test(emp.email)) errors.email = 'Enter a valid email address.';
    else if (others.some((e) => e.email && e.email.toLowerCase() === emp.email)) errors.email = 'Another employee already uses this email.';
  }
  if (emp.phone && !/^\+?\d{7,15}$/.test(emp.phone.replace(/[\s\-()]/g, ''))) errors.phone = 'Enter a valid phone number (7 to 15 digits).';
  if (emp.bloodGroup && !BLOOD_GROUPS.includes(emp.bloodGroup)) errors.bloodGroup = 'Choose a valid blood group.';

  if (emp.joiningDate) {
    const parsed = new Date(emp.joiningDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(emp.joiningDate) || Number.isNaN(parsed.getTime())) errors.joiningDate = 'Use the date format YYYY-MM-DD.';
    else if (parsed > new Date()) errors.joiningDate = 'Joining date cannot be in the future.';
  }
  if (emp.experienceYears != null && (Number.isNaN(emp.experienceYears) || emp.experienceYears < 0 || emp.experienceYears > 60)) {
    errors.experienceYears = 'Experience must be a number from 0 to 60.';
  }

  if (emp.reportingManagerID) {
    const byId = new Map(employees.map((e) => [e.employeeID, e]));
    if (emp.reportingManagerID === emp.employeeID) errors.reportingManagerID = 'An employee cannot report to themselves.';
    else if (!byId.has(emp.reportingManagerID)) errors.reportingManagerID = `Manager ${emp.reportingManagerID} does not exist.`;
    else {
      // Walk up the chain: if we meet this employee again, the change would create a loop.
      let cursor = byId.get(emp.reportingManagerID);
      const seen = new Set();
      while (cursor && !seen.has(cursor.employeeID)) {
        if (cursor.employeeID === emp.employeeID) { errors.reportingManagerID = 'This change would create a reporting loop.'; break; }
        seen.add(cursor.employeeID);
        cursor = cursor.reportingManagerID ? byId.get(cursor.reportingManagerID) : null;
      }
    }
  }
  return errors;
}
