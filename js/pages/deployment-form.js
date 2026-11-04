// Raise a deployment request (Lead). Also edits a Draft or a request the Project Manager sent back (?id=DEP-...).
import { initPage, showFatal } from '../core/app-init.js';
import { ACTIONS, can } from '../core/access-control.js';
import { ValidationError } from '../core/validators.js';
import { ensureSeeded } from '../services/seed-service.js';
import { getImportSites } from '../services/import-preview.js';
import { createDeploymentRequest, getDeployableEmployees, getDeploymentRequest, updateDeploymentRequest } from '../services/deployment-service.js';
import { $, h } from '../ui/dom.js';
const id = new URLSearchParams(location.search).get('id') || '';
const editing = Boolean(id);
const session = initPage({
  pageKey: 'deployments', title: editing ? 'Edit deployment request' : 'New deployment request',
  crumbs: [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Deployments', href: 'deployments.html' }, { label: editing ? 'Edit' : 'New request' }],
});

function banner(text) {
  const box = $('banner');
  box.className = 'alert alert-error';
  box.setAttribute('role', 'alert');
  box.textContent = text;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}
const stop = (title, message, href, label) => $('form-root').replaceChildren(h('div', { class: 'card', id: 'no-access' }, h('h1', { text: title }), h('p', { text: message }), h('a', { class: 'btn btn-primary', href }, label)));

async function start() {
  if (!session) return;
  try {
    await ensureSeeded();
    if (!can(session, ACTIONS.DEPLOYMENT_CREATE)) {
      stop('Only Leads can raise requests', 'Deployment requests are raised by Leads. The Project Manager reviews, approves and confirms them.', 'deployments.html', 'Back to deployments');
      return;
    }
    const [sites, people, req] = await Promise.all([getImportSites(session), getDeployableEmployees(session), editing ? getDeploymentRequest(session, id) : null]);
    if (editing) {
      if (!req || req.requestedByUserID !== session.userID) { stop('Request not found', 'You can edit only your own requests.', 'deployments.html', 'Back to deployments'); return; }
      if (!['Draft', 'Returned'].includes(req.status)) { stop('This request can no longer be edited', `It is "${req.status}". Only drafts and requests sent back by the Project Manager can be edited.`, `deployments.html?id=${encodeURIComponent(id)}`, 'Back to the request'); return; }
    }
    draw({ sites, people, req });
  } catch (err) {
    showFatal(err.message);
  }
}

function draw({ sites, people, req }) {
  const errorBoxes = {};
  const inputs = {};
  const today = new Date().toISOString().slice(0, 10);
  const errBox = (n) => (errorBoxes[n] = h('span', { class: 'field-error', id: `err-${n}` }));
  const wrap = (name, label, control, { required = false, hint = '', wide = false } = {}) => {
    inputs[name] = control;
    return h('div', { class: `field${wide ? ' wide' : ''}` }, h('label', { for: control.id }, label, required ? h('span', { class: 'req', text: ' *' }) : null), control, hint ? h('span', { class: 'hint', text: hint }) : null, errBox(name));
  };
  const val = (k, d = '') => (req ? req[k] ?? d : d);

  // employee
  const employeeControl = editing
    ? h('input', { class: 'input', id: 'f-employeeID', readonly: true, value: `${req.employeeName} (${req.employeeID})` })
    : h('select', { class: 'input', id: 'f-employeeID', required: true },
      h('option', { value: '', text: people.length ? 'Choose an employee...' : 'No employees are available' }),
      people.map((e) => h('option', { value: e.employeeID, text: `${e.employeeName} (${e.employeeID}) - ${e.designation || e.role}, ${e.baseSite}` })));
  // site and project
  const siteControl = h('select', { class: 'input', id: 'f-targetSite', required: true }, h('option', { value: '', text: 'Choose a site...' }), sites.map((s) => h('option', { value: s.siteCode, text: s.siteName })));
  const projectControl = h('select', { class: 'input', id: 'f-targetProject', required: true });
  const fillProjects = () => {
    const site = sites.find((s) => s.siteCode === siteControl.value);
    const keep = projectControl.value;
    projectControl.replaceChildren(h('option', { value: '', text: site ? 'Choose a project...' : 'Choose a site first' }), ...(site?.projectTypes || []).map((p) => h('option', { value: p, text: p })));
    if ((site?.projectTypes || []).includes(keep)) projectControl.value = keep;
  };
  siteControl.addEventListener('change', fillProjects);
  siteControl.value = val('targetSite'); fillProjects(); projectControl.value = val('targetProject');
  if (!editing) employeeControl.value = '';

  const lastReturn = req?.status === 'Returned' ? [...req.history].reverse().find((x) => x.to === 'Returned') : null;
  const form = h('form', { id: 'deployment-form' },
    lastReturn ? h('div', { class: 'returned', id: 'returned-note' }, h('strong', { text: 'The Project Manager sent this back: ' }), lastReturn.comment) : null,
    h('fieldset', {}, h('legend', { text: 'Who and where' }), h('div', { class: 'form-grid' },
      wrap('employeeID', 'Employee', employeeControl, { required: true, hint: editing ? 'The employee cannot be changed on an existing request.' : 'Only available employees in your department who are not already in a request are listed.', wide: true }),
      wrap('targetSite', 'Deploy to site', siteControl, { required: true }),
      wrap('targetProject', 'Project', projectControl, { required: true }),
      wrap('assignmentRole', 'Role / assignment', h('input', { class: 'input', id: 'f-assignmentRole', value: val('assignmentRole'), required: true, autocomplete: 'off' }), { required: true, hint: 'For example: Site engineer, commissioning support.' }))),
    h('fieldset', {}, h('legend', { text: 'When' }), h('div', { class: 'form-grid' },
      wrap('startDate', 'Start date', h('input', { class: 'input', id: 'f-startDate', type: 'date', min: today, value: val('startDate'), required: true }), { required: true }),
      wrap('expectedEndDate', 'Expected end date', h('input', { class: 'input', id: 'f-expectedEndDate', type: 'date', min: today, value: val('expectedEndDate') }), { hint: 'Optional.' }))),
    h('fieldset', {}, h('legend', { text: 'Why' }), h('div', { class: 'form-grid' },
      wrap('reason', 'Reason', h('textarea', { class: 'input', id: 'f-reason', required: true, maxlength: '500' }), { required: true, wide: true, hint: 'The Project Manager reads this when deciding.' }),
      wrap('remarks', 'Remarks', h('textarea', { class: 'input', id: 'f-remarks', maxlength: '500' }), { wide: true, hint: 'Optional supporting notes.' }))),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', id: 'submit-request', onclick: () => save(true) }, h('i', { class: 'fa-solid fa-paper-plane', 'aria-hidden': 'true' }), editing && req.status === 'Returned' ? ' Save and submit again' : ' Submit for approval'),
      h('button', { class: 'btn', type: 'button', id: 'save-draft', onclick: () => save(false) }, 'Save as draft'),
      h('a', { class: 'btn', id: 'cancel', href: editing ? `deployments.html?id=${encodeURIComponent(id)}` : 'deployments.html' }, 'Cancel')));
  inputs.reason.value = val('reason'); inputs.remarks.value = val('remarks');

  $('form-root').replaceChildren(h('div', { class: 'page-head' }, h('h1', { text: editing ? `Edit request ${req.requestID}` : 'New deployment request' }),
    h('p', { text: 'Submitting sends the request to the Project Manager. Nothing changes for the employee until the Project Manager approves and confirms it.' })), form);

  async function save(submit) {
    $('banner').hidden = true;
    Object.values(errorBoxes).forEach((b) => { b.textContent = ''; });
    if (submit && !form.reportValidity()) return;
    const data = Object.fromEntries(['employeeID', 'targetSite', 'targetProject', 'assignmentRole', 'startDate', 'expectedEndDate', 'reason', 'remarks'].map((k) => [k, k === 'employeeID' && editing ? req.employeeID : inputs[k].value]));
    const buttons = document.querySelectorAll('#deployment-form button');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const record = editing
        ? await updateDeploymentRequest(session, id, data, { submit, expectedVersion: req.version })
        : await createDeploymentRequest(session, data, { submit });
      location.assign(`deployments.html?id=${encodeURIComponent(record.requestID)}&saved=1`);
    } catch (err) {
      buttons.forEach((b) => { b.disabled = false; });
      if (err instanceof ValidationError) {
        const misc = [];
        for (const [f, m] of Object.entries(err.errors)) (errorBoxes[f] ? (errorBoxes[f].textContent = m) : misc.push(m));
        banner(misc.length ? misc.join(' ') : 'Please fix the highlighted fields.');
        const first = Object.keys(err.errors).find((k) => inputs[k]);
        if (first) inputs[first].focus();
      } else banner(err.message);
    }
  }
}
start();
