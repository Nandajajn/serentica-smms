// Fixed lists used by forms, validation and permissions. One place, one spelling.
export const DEPARTMENTS = Object.freeze([
  { code: 'PMO', name: 'PMO' },
  { code: 'PROJECT_MGMT', name: 'Project Management' },
  { code: 'CIVIL', name: 'Civil' },
  { code: 'MECHANICAL', name: 'Mechanical' },
  { code: 'ELECTRICAL', name: 'Electrical' },
  { code: 'QHSE', name: 'QHSE' },
  { code: 'LAND', name: 'Land' },
  { code: 'ROW', name: 'ROW' },
  { code: 'OM', name: 'O&M' },
  { code: 'ADMINISTRATION', name: 'Administration' },
]);

// Organisational level (not the same thing as the system login role).
export const ORG_ROLES = Object.freeze([
  { code: 'PMO', name: 'PMO', level: 1 },
  { code: 'PROJECT_MANAGER', name: 'Project Manager', level: 1 },
  { code: 'DEPT_LEAD', name: 'Department Lead', level: 2 },
  { code: 'ASSISTANT_MANAGER', name: 'Assistant Manager', level: 3 },
  { code: 'EMPLOYEE', name: 'Employee', level: 4 },
]);

export const EMPLOYMENT_TYPES = Object.freeze(['On-roll', 'Off-role']);
export const EMPLOYEE_STATUSES = Object.freeze(['Active', 'Inactive', 'On Leave', 'Exited']);
export const DEPLOYMENT_STATUSES = Object.freeze(['Available', 'Deployed', 'Unavailable']);
export const BLOOD_GROUPS = Object.freeze(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);

// Who may edit which field (see access-control.js):
//   OPERATIONAL: Lead (in scope) and Project Manager.
//   RESTRICTED:  Project Manager only. A Lead must raise a change request.
//   SYSTEM:      never edited directly. Deployment and recall workflows change these.
export const OPERATIONAL_FIELDS = Object.freeze(['phone', 'email', 'shift', 'address']);
export const RESTRICTED_FIELDS = Object.freeze([
  'employeeName', 'designation', 'department', 'role', 'reportingManagerID', 'employmentType', 'status',
  'company', 'baseSite', 'currentProject', 'joiningDate', 'experienceYears',
  'gender', 'dateOfBirth', 'bloodGroup', 'emergencyContact',
]);
export const SYSTEM_FIELDS = Object.freeze([
  'employeeID', 'deploymentStatus', 'activeAssignmentID', 'currentSite',
  'isDemo', 'sourceBatchID', 'createdAt', 'updatedAt', 'updatedBy',
]);
// Only the Project Manager and Admin may see these.
export const SENSITIVE_FIELDS = Object.freeze(['gender', 'dateOfBirth', 'bloodGroup', 'emergencyContact']);
