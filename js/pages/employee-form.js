// Add a new employee, or edit an existing one (?id=EMP-001). All rules live in employee-service.js.
import { initPage, showFatal } from '../core/app-init.js';
import { ACTIONS, can, check } from '../core/access-control.js';
import { ROLES } from '../core/constants.js';
import { BLOOD_GROUPS, DEPARTMENTS, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, ORG_ROLES } from '../core/reference-data.js';
import { ValidationError } from '../core/validators.js';
import { ensureSeeded } from '../services/seed-service.js';
import { addEmployee, getEmployeeById, getEmployees, updateEmployee } from '../services/employee-service.js';
import { getImportSites } from '../services/import-preview.js';
import { $, h } from '../ui/dom.js';

const id = new URLSearchParams(location.search).get('id') || '';
const editing = Boolean(id);
const session = initPage({
  pageKey: 'employees', title: editing ? 'Edit Employee' : 'Add Employee',
  crumbs: [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Employees', href: 'employees.html' }, { label: editing ? 'Edit' : 'Add' }],
});

function banner(text) {
  const box = $('banner');
  box.className = 'alert alert-error';
  box.setAttribute('role', 'alert');
  box.textContent = text;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}

function readOnlyCard(title, message, backHref, backLabel) {
  $('form-root').replaceChildren(h('div', { class: 'card', id: 'no-access' }, h('h1', { text: title }), h('p', { text: message }),
    h('a', { class: 'btn btn-primary', href: backHref }, backLabel)));
}

async function start() {
  if (!session) return;
  try {
    await ensureSeeded();
    if (session.systemRole === ROLES.ADMIN) {
      readOnlyCard('Read-only access', 'Admin accounts cannot add or edit employees. You can view all employee records.', 'employees.html', 'Back to the employee list');
      return;
    }
    const [sites, people, emp] = await Promise.all([getImportSites(session), getEmployees(session), editing ? getEmployeeById(session, id) : null]);
    if (editing && !emp) { readOnlyCard('Employee not found', `There is no employee "${id}" that you are allowed to see.`, 'employees.html', 'Back to the employee list'); return; }

    if (editing) {
      const verdict = check(session, ACTIONS.EMPLOYEE_EDIT_RESTRICTED, { site: emp.baseSite, department: emp.department });
      if (!verdict.allowed) { readOnlyCard('You cannot edit this employee', verdict.reason, `employee-profile.html?id=${encodeURIComponent(id)}`, 'Back to the profile'); return; }
    } else if (!can(session, ACTIONS.EMPLOYEE_ADD)) {
      readOnlyCard('You cannot add employees', 'Your role is not allowed to add employees.', 'employees.html', 'Back to the employee list');
      return;
    }
    draw({ sites, people, emp });
  } catch (err) {
    showFatal(err.message);
  }
}

function draw({ sites, people, emp }) {
  const allowedDepts = session.systemRole === ROLES.LEAD ? DEPARTMENTS.filter((d) => (session.departmentScope || []).includes(d.code)) : DEPARTMENTS;
  const managers = people.filter((p) => p.employeeID !== id).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  const showSensitive = can(session, ACTIONS.VIEW_SENSITIVE);

  const GROUPS = [
    { title: 'Identity', fields: [
      { name: 'employeeID', label: 'Employee ID', required: true, addOnly: true, hint: 'Letters, numbers, - or _. It cannot be changed later.' },
      { name: 'employeeName', label: 'Full name', required: true }] },
    { title: 'Job', fields: [
      { name: 'designation', label: 'Designation' },
      { name: 'department', label: 'Department', required: true, options: allowedDepts.map((d) => [d.code, d.name]) },
      { name: 'role', label: 'Role (level)', required: true, options: ORG_ROLES.map((r) => [r.code, r.name]) },
      { name: 'employmentType', label: 'Employment type', required: true, options: EMPLOYMENT_TYPES.map((t) => [t, t]) },
      { name: 'status', label: 'Status', required: true, options: EMPLOYEE_STATUSES.map((s) => [s, s]), initial: 'Active' },
      { name: 'reportingManagerID', label: 'Reports to', options: managers.map((m) => [m.employeeID, `${m.employeeName} (${m.employeeID})`]), blank: '(nobody)' },
      { name: 'baseSite', label: 'Base site', required: true, options: sites.map((s) => [s.siteCode, s.siteName]) },
      { name: 'company', label: 'Company' }, { name: 'currentProject', label: 'Project' },
      { name: 'joiningDate', label: 'Joining date', type: 'date' },
      { name: 'experienceYears', label: 'Experience (years)', type: 'number', min: '0', max: '60', step: '0.5' },
      { name: 'shift', label: 'Shift' }] },
    { title: 'Contact', fields: [
      { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'address', label: 'Address / district' }] },
  ];
  if (showSensitive) GROUPS.push({ title: 'Personal details (restricted)', fields: [
    { name: 'gender', label: 'Gender', options: ['Male', 'Female', 'Other', 'Prefer not to say'].map((g) => [g, g]) },
    { name: 'dateOfBirth', label: 'Date of birth', type: 'date' },
    { name: 'bloodGroup', label: 'Blood group', options: BLOOD_GROUPS.map((b) => [b, b]) },
    { name: 'emergencyContact', label: 'Emergency contact', type: 'tel' }] });

  const inputs = {};
  const errorBoxes = {};
  const fieldBlock = (f) => {
    const fid = `f-${f.name}`;
    const readonly = editing && f.addOnly;
    const control = f.options
      ? h('select', { class: 'input', id: fid, name: f.name, required: f.required }, h('option', { value: '', text: f.required ? 'Choose...' : (f.blank || '(none)') }),
        f.options.map(([v, t]) => h('option', { value: v, text: t })))
      : h('input', { class: 'input', id: fid, name: f.name, type: f.type || 'text', required: f.required, readonly, autocomplete: 'off', min: f.min, max: f.max, step: f.step });
    control.value = emp ? String(emp[f.name] ?? '') : (f.initial || '');
    inputs[f.name] = control;
    const err = h('span', { class: 'field-error', id: `err-${f.name}` });
    errorBoxes[f.name] = err;
    return h('div', { class: 'field' }, h('label', { for: fid }, f.label, f.required ? h('span', { class: 'req', text: ' *' }) : null), control, f.hint ? h('span', { class: 'hint', text: f.hint }) : null, err);
  };

  const reason = editing ? h('div', { class: 'field' }, h('label', { for: 'f-reason', text: 'Reason for the change (optional, saved in the history)' }),
    h('input', { class: 'input', id: 'f-reason', maxlength: '200', autocomplete: 'off' })) : null;

  const form = h('form', { id: 'employee-form', novalidate: false },
    GROUPS.map((g) => h('fieldset', {}, h('legend', { text: g.title }), h('div', { class: 'form-grid' }, g.fields.map(fieldBlock)))),
    reason,
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'submit', id: 'save' }, h('i', { class: 'fa-solid fa-floppy-disk', 'aria-hidden': 'true' }), editing ? ' Save changes' : ' Add employee'),
      h('a', { class: 'btn', id: 'cancel', href: editing ? `employee-profile.html?id=${encodeURIComponent(id)}` : 'employees.html' }, 'Cancel')));

  const system = editing ? h('fieldset', {}, h('legend', { text: 'Set by deployments and recalls (not editable here)' }),
    h('dl', { class: 'facts' }, [['Deployment status', emp.deploymentStatus], ['Current site', emp.currentSite], ['Active assignment', emp.activeAssignmentID || 'None']]
      .flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v ?? '-') })]))) : null;

  $('form-root').replaceChildren(h('div', { class: 'page-head' }, h('h1', { text: editing ? `Edit ${emp.employeeName}` : 'Add employee' }),
    h('p', { text: editing ? `${emp.employeeID}. Fields marked * are required.` : 'Fields marked * are required. The new employee starts as Available and is placed at their base site.' })), form, system);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('banner').hidden = true;
    Object.values(errorBoxes).forEach((b) => { b.textContent = ''; });
    const values = {};
    for (const g of GROUPS) for (const f of g.fields) if (!(editing && f.addOnly)) values[f.name] = inputs[f.name].value;

    let payload = values;
    if (editing) {
      payload = Object.fromEntries(Object.entries(values).filter(([k, v]) => String(emp[k] ?? '') !== v)); // send only real changes
      if (!Object.keys(payload).length) { banner('Nothing was changed, so there is nothing to save.'); return; }
    }
    const save = $('save');
    save.disabled = true;
    try {
      const record = editing
        ? await updateEmployee(session, id, payload, $('f-reason').value.trim())
        : await addEmployee(session, { ...values, employeeID: inputs.employeeID.value });
      location.assign(`employee-profile.html?id=${encodeURIComponent(record.employeeID || id)}&saved=1`);
    } catch (err) {
      save.disabled = false;
      if (err instanceof ValidationError) {
        const misc = [];
        for (const [field, message] of Object.entries(err.errors)) (errorBoxes[field] ? (errorBoxes[field].textContent = message) : misc.push(message));
        banner(misc.length ? misc.join(' ') : 'Please fix the highlighted fields.');
        const first = Object.keys(err.errors).find((k) => inputs[k]);
        if (first) inputs[first].focus();
      } else {
        banner(err.message);
      }
    }
  });
}
start();
