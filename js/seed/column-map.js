// Excel heading -> employee field. Headings are compared after removing spaces,
// punctuation and capitals, so "Emp Code", "EMP_CODE" and "emp code" all match.
export const normaliseHeading = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const FIELD_ALIASES = {
  employeeID: ['empcode', 'employeeid', 'employeecode', 'empid', 'employeeno', 'empno'],
  employeeName: ['empname', 'employeename', 'name'],
  designation: ['designation', 'jobtitle'],
  department: ['department', 'dept'],
  role: ['role', 'employeerole', 'jobrole'],
  reportingManager: ['reportingmanager', 'manager', 'reportingmanagerid'],
  phone: ['contact', 'contactnumber', 'phone', 'phonenumber', 'mobile', 'mobilenumber'],
  email: ['emailid', 'email', 'emailaddress'],
  employmentType: ['onrolloffrole', 'onrolloffroll', 'employmenttype'],
  address: ['residentialdistrict', 'address', 'district'],
  baseSite: ['site', 'currentsite', 'basesite'],
  currentProject: ['project', 'currentproject'],
  status: ['status', 'employeestatus'],
  deploymentStatus: ['deploymentstatus'],
  joiningDate: ['joiningdate', 'dateofjoining', 'doj'],
  experienceYears: ['experience', 'experienceyears', 'yearsofexperience'],
  shift: ['shift'],
  company: ['company'],
  gender: ['gender'],
  dateOfBirth: ['dateofbirth', 'dob'],
  bloodGroup: ['bloodgroup'],
  emergencyContact: ['emergencycontact', 'emergencycontactnumber'],
};

export const FIELD_LABELS = {
  employeeID: 'Employee ID', employeeName: 'Employee name', designation: 'Designation', department: 'Department',
  role: 'Role', reportingManager: 'Reporting manager', phone: 'Phone', email: 'Email', employmentType: 'Employment type',
  address: 'Address / district', baseSite: 'Site', currentProject: 'Project', status: 'Status',
  deploymentStatus: 'Deployment status (ignored)', joiningDate: 'Joining date', experienceYears: 'Experience (years)',
  shift: 'Shift', company: 'Company', gender: 'Gender', dateOfBirth: 'Date of birth', bloodGroup: 'Blood group',
  emergencyContact: 'Emergency contact',
};

export const IMPORT_FIELDS = Object.keys(FIELD_ALIASES);

/** headers: string[] -> { fieldName: columnIndex } (only fields that were recognised) */
export function autoMapHeaders(headers) {
  const mapping = {};
  headers.forEach((header, index) => {
    const key = normaliseHeading(header);
    if (!key) return;
    const field = IMPORT_FIELDS.find((f) => FIELD_ALIASES[f].includes(key));
    if (field && mapping[field] == null) mapping[field] = index;
  });
  return mapping;
}
