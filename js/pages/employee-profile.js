// One employee: details, reporting line, availability, and the audit history of changes.
import { initPage, showFatal } from '../core/app-init.js';
import { ACTIONS, can } from '../core/access-control.js';
import { subscribe } from '../core/store.js';
import { DEPARTMENTS, ORG_ROLES } from '../core/reference-data.js';
import { ensureSeeded } from '../services/seed-service.js';
import { deriveLeadership, getEmployeeById, getEmployees, getReportingChain } from '../services/employee-service.js';
import { getAuditHistory } from '../services/audit-service.js';
import { availabilityOf } from '../services/availability-service.js';
import { $, fmtDateTime, h, put } from '../ui/dom.js';

const session = initPage({
  pageKey: 'employees', title: 'Employee Profile',
  crumbs: [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Employees', href: 'employees.html' }, { label: 'Profile' }],
});

const id = new URLSearchParams(location.search).get('id') || '';
const deptName = (c) => DEPARTMENTS.find((d) => d.code === c)?.name || c || '';
const roleName = (c) => ORG_ROLES.find((r) => r.code === c)?.name || c || '';
const show = (v) => (v === null || v === undefined || v === '' ? '-' : String(v));

const facts = (pairs) => h('dl', { class: 'facts' }, pairs.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', {}, v instanceof Node ? v : show(v))]));
const card = (title, ...kids) => h('section', { class: 'card' }, h('h2', { text: title }), kids);
const link = (e) => h('a', { href: `employee-profile.html?id=${encodeURIComponent(e.employeeID)}`, text: `${e.employeeName} (${e.employeeID})` });
const badge = (text, kind) => h('span', { class: `badge badge-${kind}`, text });

const ACTION_LABELS = {
  EMPLOYEE_ADD: 'Added', EMPLOYEE_UPDATE: 'Updated', EMPLOYEE_IMPORT_ADD: 'Created by Excel import', EMPLOYEE_IMPORT_UPDATE: 'Updated by Excel import',
};
function describeChange(ev) {
  if (!ev.before && ev.after) return ev.action.endsWith('ADD') ? 'Record created' : '';
  return Object.keys(ev.after || {}).slice(0, 5).map((k) => `${k}: ${show(ev.before?.[k])} -> ${show(ev.after[k])}`).join('; ');
}

async function render() {
  const root = $('profile');
  const emp = await getEmployeeById(session, id);
  if (!emp) {
    root.replaceChildren(h('div', { class: 'card', id: 'not-found' },
      h('h1', { text: 'Employee not found' }),
      h('p', { text: id ? `There is no employee "${id}" that you are allowed to see.` : 'No employee was chosen.' }),
      h('a', { class: 'btn btn-primary', href: 'employees.html' }, 'Back to the employee list')));
    return;
  }
  const all = await getEmployees(session);
  const byId = new Map(all.map((e) => [e.employeeID, e]));
  const { teamLead, projectManager } = deriveLeadership(all, emp.employeeID);
  const chain = getReportingChain(all, emp.employeeID);
  const reports = all.filter((e) => e.reportingManagerID === emp.employeeID).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  const avail = availabilityOf(emp);
  const history = (await getAuditHistory(session)).filter((e) => e.recordType === 'employee' && e.recordID === emp.employeeID).slice(0, 25);

  const out = [
    h('div', { class: 'card' },
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('div', {}, h('h1', { id: 'emp-name', text: emp.employeeName, style: 'margin-bottom:4px' }),
          h('p', { class: 'muted', text: `${emp.employeeID}  |  ${show(emp.designation)}  |  ${deptName(emp.department)}` })),
        h('div', { class: 'row' },
          badge(emp.status, emp.status === 'Active' ? 'ok' : emp.status === 'On Leave' ? 'warn' : 'off'),
          badge(avail.available ? 'Available' : emp.deploymentStatus, avail.available ? 'ok' : 'off'),
          emp.isDemo ? h('span', { class: 'badge badge-demo', text: 'DEMO' }) : null,
          can(session, ACTIONS.EMPLOYEE_EDIT_OPERATIONAL, { site: emp.baseSite, department: emp.department }) ? h('a', { class: 'btn btn-primary', id: 'edit-employee', href: `employee-form.html?id=${encodeURIComponent(emp.employeeID)}` }, h('i', { class: 'fa-solid fa-pen', 'aria-hidden': 'true' }), ' Edit') : null))),
    h('div', { class: 'cols' },
      card('Employment', facts([
        ['Designation', emp.designation], ['Department', deptName(emp.department)], ['Role (level)', roleName(emp.role)],
        ['Employment type', emp.employmentType], ['Company', emp.company], ['Joining date', emp.joiningDate],
        ['Experience (years)', emp.experienceYears], ['Shift', emp.shift]])),
      card('Contact', facts([['Phone', emp.phone], ['Email', emp.email], ['Address / district', emp.address]])),
      card('Site and availability', facts([
        ['Base site', emp.baseSite], ['Current site', emp.currentSite], ['Current project', emp.currentProject],
        ['Deployment status', emp.deploymentStatus], ['Available now', h('span', {}, avail.available ? 'Yes' : `No. ${avail.reason}`)]])),
      card('Reporting line', facts([
        ['Reports to', emp.reportingManagerID ? (byId.has(emp.reportingManagerID) ? link(byId.get(emp.reportingManagerID)) : emp.reportingManagerID) : '-'],
        ['Team lead', teamLead ? link(teamLead) : '-'], ['Project manager', projectManager ? link(projectManager) : '-'],
        ['Chain of command', chain.length ? h('span', {}, chain.map((m, i) => [i ? ' > ' : '', link(m)])) : '-']]),
        h('h2', { text: `Direct reports (${reports.length})`, style: 'margin-top:16px' }),
        reports.length ? h('ul', { class: 'plain' }, reports.map((r) => h('li', {}, link(r)))) : h('p', { class: 'muted small', text: 'Nobody reports to this employee.' }))),
    h('div', { class: 'cols' },
      can(session, ACTIONS.VIEW_SENSITIVE)
        ? card('Personal details', facts([['Gender', emp.gender], ['Date of birth', emp.dateOfBirth], ['Blood group', emp.bloodGroup], ['Emergency contact', emp.emergencyContact]]))
        : card('Personal details', h('p', { class: 'muted small', text: 'These details are hidden for your role.' })),
      card('Performance', h('p', { class: 'muted', text: 'Not assessed' }), h('p', { class: 'small muted', text: 'Performance reviews will appear here once that module is built.' })),
      card('Deployment and recall history', h('p', { class: 'muted', text: 'No deployments or recalls recorded yet.' }),
        h('p', { class: 'small muted', text: 'History appears here once the deployment and recall workflows are built.' })),
      card('Training and documents', h('p', { class: 'muted', text: 'Not available yet.' }))),
    card('Change history',
      history.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'history-table' },
        h('thead', {}, h('tr', {}, ['When', 'What', 'By', 'Details'].map((t) => h('th', { text: t })))),
        h('tbody', {}, history.map((ev) => h('tr', {}, h('td', { text: fmtDateTime(ev.timestamp) }), h('td', { text: ACTION_LABELS[ev.action] || ev.action }),
          h('td', { text: ev.actorUserID ? `${ev.actorRole} (${ev.actorUserID})` : ev.actorRole }), h('td', { text: describeChange(ev) || ev.reason || '' }))))))
        : h('p', { class: 'muted', text: 'No recorded changes.' })),
    h('p', {}, h('a', { href: 'employees.html' }, 'Back to the employee list')),
  ];
 if (new URLSearchParams(location.search).get('saved')) {
    out.unshift(h('div', { class: 'alert', role: 'status', id: 'saved-banner', style: 'background:var(--success-bg);border-color:var(--success);color:var(--success)', text: 'Saved. The change is recorded in the history below.' }));
  }
  root.replaceChildren(h('div', { class: 'stack' }, out));
}

async function start() {
  if (!session) return;
  try {
    await ensureSeeded();
    await render();
    subscribe('employees', () => render());
    subscribe('auditEvents', () => render());
  } catch (err) {
    showFatal(err.message);
  }
}
start();
