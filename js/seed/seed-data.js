// DEMO DATA ONLY. Fictional accounts and placeholder site details for the prototype.
// Nothing here is real Serentica employee, credential or organisation data.
import { ROLES } from '../core/constants.js';

export const SITES = [
  { siteCode: 'KOPPAL', siteName: 'Koppal', state: 'Karnataka', projectTypes: ['Wind', 'Solar'], isActive: true, isDemo: true },
  { siteCode: 'FATEHGARH', siteName: 'Fatehgarh', state: 'Rajasthan', projectTypes: ['Wind', 'Solar'], isActive: true, isDemo: true },
];

// Passwords are shown on the login page on purpose (demo). Only salted hashes are
// stored in the database. Scope: demo accounts cover both sites so every page can be
// demonstrated; the Lead is limited to the Civil department to show scope rules.
export const DEMO_USER_SEEDS = [
  { userID: 'U-DEMO-ADMIN', username: 'admin.demo', email: 'admin@demo.serentica.example', password: 'Admin@123',
    displayName: 'Demo Admin', systemRole: ROLES.ADMIN, siteScope: [], departmentScope: [] },
  { userID: 'U-DEMO-LEAD', username: 'lead.demo', email: 'lead@demo.serentica.example', password: 'Lead@123',
    displayName: 'Demo Lead', systemRole: ROLES.LEAD, siteScope: ['KOPPAL', 'FATEHGARH'], departmentScope: ['CIVIL'] },
  { userID: 'U-DEMO-PM', username: 'pm.demo', email: 'pm@demo.serentica.example', password: 'Manager@123',
    displayName: 'Demo Project Manager', systemRole: ROLES.PM, siteScope: ['KOPPAL', 'FATEHGARH'], departmentScope: [] },
];
/* ---------- Demo employees ---------- */
// Fictional people only. Names are generated from generic lists; IDs start with DEMO-.
const FIRST_NAMES = ['Aarav', 'Vihaan', 'Ishaan', 'Kabir', 'Rohan', 'Arjun', 'Dev', 'Neel', 'Rahul', 'Karan',
  'Anaya', 'Diya', 'Meera', 'Isha', 'Kavya', 'Riya', 'Sneha', 'Tara', 'Nisha', 'Pooja'];
const LAST_NAMES = ['Rao', 'Nair', 'Menon', 'Gupta', 'Sharma', 'Verma', 'Singh', 'Reddy', 'Iyer', 'Patel',
  'Joshi', 'Kulkarni', 'Das', 'Bose', 'Mehta', 'Shetty', 'Hegde', 'Chauhan', 'Yadav', 'Pillai'];

const DEPT_DEFS = [
  { code: 'CIVIL', lead: 'Civil Lead', asst: 'Assistant Civil Manager', staff: 'Civil Engineer' },
  { code: 'MECHANICAL', lead: 'Mechanical Lead', asst: 'Assistant Mechanical Manager', staff: 'Mechanical Engineer' },
  { code: 'ELECTRICAL', lead: 'Electrical Lead', asst: 'Assistant Electrical Manager', staff: 'Electrical Engineer' },
  { code: 'QHSE', lead: 'QHSE Lead', asst: 'Assistant QHSE Manager', staff: 'QHSE Officer' },
  { code: 'LAND', lead: 'Land Lead', asst: 'Assistant Land Manager', staff: 'Land Executive' },
  { code: 'ROW', lead: 'ROW Lead', asst: 'Assistant ROW Manager', staff: 'ROW Executive' },
  { code: 'OM', lead: 'O&M Lead', asst: 'Assistant O&M Manager', staff: 'O&M Technician' },
  { code: 'ADMINISTRATION', lead: 'Admin Lead', asst: 'Assistant Admin Manager', staff: 'Admin Executive' },
];
const SITE_SHORT = { KOPPAL: 'KOP', FATEHGARH: 'FAT' };

/**
 * Per site: PMO, Project Manager, then for each department a Lead, an Assistant Manager
 * and two staff. Reporting lines: Lead -> PM, Assistant -> Lead, staff -> Assistant,
 * PMO -> PM (configurable in the real site structure).
 */
export function buildDemoEmployees() {
  const out = [];
  let counter = 0;
  const created = new Date().toISOString();

  for (const site of SITES) {
    const short = SITE_SHORT[site.siteCode];
    let seq = 0;
    const make = (department, role, designation, reportingManagerID, employmentType = 'On-roll', status = 'Active') => {
      seq += 1; counter += 1;
      const employeeID = `DEMO-${short}-${String(seq).padStart(3, '0')}`;
      const first = FIRST_NAMES[counter % 20];
      const last = LAST_NAMES[(counter * 7 + 3) % 20];
      const joining = new Date(Date.UTC(2019, 0, 1) + ((counter * 53) % 2500) * 86400000).toISOString().slice(0, 10);
      const record = {
        employeeID, employeeName: `${first} ${last}`, designation, department, role,
        reportingManagerID, email: `${first}.${last}.${employeeID}`.toLowerCase() + '@demo.serentica.example',
        phone: `0000000${String(counter).padStart(3, '0')}`, company: 'Serentica (demo)',
        baseSite: site.siteCode, currentSite: site.siteCode, currentProject: '',
        employmentType, joiningDate: joining, experienceYears: 1 + (counter % 14), shift: 'General', address: '',
        status, deploymentStatus: status === 'Active' ? 'Available' : 'Unavailable', activeAssignmentID: null,
        isDemo: true, sourceBatchID: null, createdAt: created, updatedAt: created, updatedBy: 'SEED',
      };
      out.push(record);
      return record;
    };

    const pm = make('PROJECT_MGMT', 'PROJECT_MANAGER', 'Project Manager', null);
    make('PMO', 'PMO', 'PMO Coordinator', pm.employeeID);
    for (const d of DEPT_DEFS) {
      const lead = make(d.code, 'DEPT_LEAD', d.lead, pm.employeeID);
      const asst = make(d.code, 'ASSISTANT_MANAGER', d.asst, lead.employeeID);
      for (let k = 0; k < 2; k++) {
        const status = counter % 13 === 0 ? 'Inactive' : counter % 11 === 0 ? 'On Leave' : 'Active';
        make(d.code, 'EMPLOYEE', d.staff, asst.employeeID, counter % 3 === 0 ? 'Off-role' : 'On-roll', status);
      }
    }
  }
  return out;
}
