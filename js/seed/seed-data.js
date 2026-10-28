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
