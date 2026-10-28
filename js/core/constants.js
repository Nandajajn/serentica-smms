// Shared constants. Single place for role codes, storage keys and navigation.
export const APP_NAME = 'Serentica Site Manpower Management System';

export const ROLES = Object.freeze({ ADMIN: 'ADMIN', LEAD: 'LEAD', PM: 'PM' });
export const ROLE_LABELS = Object.freeze({
  ADMIN: 'Admin',
  LEAD: 'Lead',
  PM: 'Project Manager',
});

export const STORAGE_KEYS = Object.freeze({
  session: 'smm.session.v1', // sessionStorage: cleared when the tab closes
});

const ALL = [ROLES.ADMIN, ROLES.LEAD, ROLES.PM];

// `stage` = build stage in which the page becomes available.
// Pages with built:false are shown disabled so no link points to a missing file.
export const NAV_ITEMS = Object.freeze([
  { key: 'dashboard',       label: 'Welcome',         href: 'dashboard.html',       icon: 'fa-house',            roles: ALL, built: true,  stage: 2,
    desc: 'Overview of the system and where to start.' },
  { key: 'employees',       label: 'Employees',       href: 'employees.html',       icon: 'fa-users',            roles: ALL, built: false, stage: 4,
    desc: 'Search the employee directory and open employee profiles.' },
  { key: 'organisation',    label: 'Organisation',    href: 'organisation.html',    icon: 'fa-sitemap',          roles: ALL, built: false, stage: 5,
    desc: 'See reporting lines by site, department and manager.' },
  { key: 'deployments',     label: 'Deployments',     href: 'deployments.html',     icon: 'fa-people-arrows',    roles: ALL, built: false, stage: 7,
    desc: 'Raise, review, approve and confirm deployment requests.' },
  { key: 'recalls',         label: 'Recalls',         href: 'recalls.html',         icon: 'fa-rotate-left',      roles: ALL, built: false, stage: 8,
    desc: 'Raise, review, approve and confirm recall requests.' },
  { key: 'availability',    label: 'Availability',    href: 'availability.html',    icon: 'fa-calendar-check',   roles: ALL, built: false, stage: 9,
    desc: 'Workforce availability and allocation by site.' },
  { key: 'performance',     label: 'Performance',     href: 'performance.html',     icon: 'fa-chart-line',       roles: ALL, built: false, stage: 10,
    desc: 'Performance indicators to support deployment decisions.' },
  { key: 'notifications',   label: 'Activity',        href: 'notifications.html',   icon: 'fa-bell',             roles: ALL, built: false, stage: 9,
    desc: 'Notifications and the audit history of changes.' },
  { key: 'reports',         label: 'Reports',         href: 'reports.html',         icon: 'fa-chart-column',     roles: ALL, built: false, stage: 9,
    desc: 'Headcount, availability and workflow reports.' },
  { key: 'data-management', label: 'Data Management', href: 'data-management.html', icon: 'fa-file-excel',       roles: ALL, built: false, stage: 6,
    desc: 'Import employee data from Excel and review import history.' },
]);
