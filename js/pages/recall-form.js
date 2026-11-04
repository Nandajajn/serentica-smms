// Raise a recall request (Lead). Also edits a Draft or a request the Project Manager sent back (?id=REC-...).
import { initPage, showFatal } from '../core/app-init.js';
import { ACTIONS, can } from '../core/access-control.js';
import { ValidationError } from '../core/validators.js';
import { ensureSeeded } from '../services/seed-service.js';
import { createRecallRequest, getRecallRequest, getRecallableEmployees, updateRecallRequest } from '../services/recall-service.js';
import { $, h } from '../ui/dom.js';

const id = new URLSearchParams(location.search).get('id') || '';
const editing = Boolean(id);
const session = initPage({
  pageKey: 'recalls', title: editing ? 'Edit recall request' : 'New recall request',
  crumbs: [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Recalls', href: 'recalls.html' }, { label: editing ? 'Edit' : 'New request' }],
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
    if (!can(session, ACTIONS.RECALL_CREATE)) {
      stop('Only Leads can raise requests', 'Recall requests are raised by Leads. The Project Manager reviews, approves and confirms them.', 'recalls.html', 'Back to recalls');
      return;
    }
    const [choices, req] = await Promise.all([getRecallableEmployees(session), editing ? getRecallRequest(session, id) : null]);
    if (editing) {
      if (!req || req.requestedByUserID !== session.userID) { stop('Request not found', 'You can edit only your own requests.', 'recalls.html', 'Back to recalls'); return; }
      if (!['Draft', 'Returned'].includes(req.status)) { stop('This request can no longer be edited', `It is "${req.status}". Only drafts and requests sent back by the Project Manager can be edited.`, `recalls.html?id=${encodeURIComponent(id)}`, 'Back to the request'); return; }
    }
    draw({ choices, req });
  } catch (err) {
    showFatal(err.message);
  }
}

function draw({ choices, req }) {
  const errorBoxes = {};
  const inputs = {};
  const today = new Date().toISOString().slice(0, 10);
  const wrap = (name, label, control, { required = false, hint = '', wide = false } = {}) => {
    inputs[name] = control;
    errorBoxes[name] = h('span', { class: 'field-error', id: `err-${name}` });
    return h('div', { class: `field${wide ? ' wide' : ''}` }, h('label', { for: control.id }, label, required ? h('span', { class: 'req', text: ' *' }) : null), control, hint ? h('span', { class: 'hint', text: hint }) : null, errorBoxes[name]);
  };
  const val = (k) => (req ? req[k] ?? '' : '');
  const byID = new Map(choices.map((c) => [c.employee.employeeID, c]));

  const employeeControl = editing
    ? h('input', { class: 'input', id: 'f-employeeID', readonly: true, value: `${req.employeeName} (${req.employeeID})` })
    : h('select', { class: 'input', id: 'f-employeeID', required: true },
      h('option', { value: '', text: choices.length ? 'Choose a deployed employee...' : 'No deployed employees are available to recall' }),
      choices.map(({ employee: e, assignment: a }) => h('option', { value: e.employeeID, text: `${e.employeeName} (${e.employeeID}) - at ${a.site} / ${a.project}` })));
  const info = h('div', { class: 'hint', id: 'assignment-info' });
  const showInfo = () => {
    const a = editing ? { site: req.assignmentSite, project: req.assignmentProject, role: req.assignmentRole, startDate: req.assignmentStart } : byID.get(employeeControl.value)?.assignment;
    info.textContent = a ? `Current deployment: ${a.site} / ${a.project}, ${a.role}, started ${a.startDate}. On recall the employee returns to their base site.` : '';
  };
  if (!editing) { employeeControl.value = ''; employeeControl.addEventListener('change', showInfo); }
  showInfo();

  const lastReturn = req?.status === 'Returned' ? [...req.history].reverse().find((x) => x.to === 'Returned') : null;
  const form = h('form', { id: 'recall-form' },
    lastReturn ? h('div', { class: 'returned', id: 'returned-note' }, h('strong', { text: 'The Project Manager sent this back: ' }), lastReturn.comment) : null,
    h('fieldset', {}, h('legend', { text: 'Who' }), h('div', { class: 'form-grid' },
      wrap('employeeID', 'Employee', employeeControl, { required: true, wide: true, hint: editing ? 'The employee cannot be changed on an existing request.' : 'Only deployed employees in your department who are not already in a recall request are listed.' }), info)),
    h('fieldset', {}, h('legend', { text: 'When and why' }), h('div', { class: 'form-grid' },
      wrap('proposedRecallDate', 'Proposed recall date', h('input', { class: 'input', id: 'f-proposedRecallDate', type: 'date', min: today, value: val('proposedRecallDate'), required: true }), { required: true }),
      wrap('reason', 'Reason', h('textarea', { class: 'input', id: 'f-reason', required: true, maxlength: '500' }), { required: true, wide: true, hint: 'The Project Manager reads this when deciding.' }),
      wrap('remarks', 'Remarks', h('textarea', { class: 'input', id: 'f-remarks', maxlength: '500' }), { wide: true, hint: 'Optional supporting notes.' }))),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', id: 'submit-request', onclick: () => save(true) }, h('i', { class: 'fa-solid fa-paper-plane', 'aria-hidden': 'true' }), editing && req.status === 'Returned' ? ' Save and submit again' : ' Submit for approval'),
      h('button', { class: 'btn', type: 'button', id: 'save-draft', onclick: () => save(false) }, 'Save as draft'),
      h('a', { class: 'btn', id: 'cancel', href: editing ? `recalls.html?id=${encodeURIComponent(id)}` : 'recalls.html' }, 'Cancel')));
  inputs.reason.value = val('reason'); inputs.remarks.value = val('remarks');

  $('form-root').replaceChildren(h('div', { class: 'page-head' }, h('h1', { text: editing ? `Edit request ${req.requestID}` : 'New recall request' }),
    h('p', { text: 'Submitting sends the request to the Project Manager. The employee stays deployed until the Project Manager approves and confirms the recall.' })), form);

  async function save(submit) {
    $('banner').hidden = true;
    Object.values(errorBoxes).forEach((b) => { b.textContent = ''; });
    if (submit && !form.reportValidity()) return;
    const data = { employeeID: editing ? req.employeeID : inputs.employeeID.value, proposedRecallDate: inputs.proposedRecallDate.value, reason: inputs.reason.value, remarks: inputs.remarks.value };
    const buttons = document.querySelectorAll('#recall-form button');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const record = editing ? await updateRecallRequest(session, id, data, { submit, expectedVersion: req.version }) : await createRecallRequest(session, data, { submit });
      location.assign(`recalls.html?id=${encodeURIComponent(record.requestID)}&saved=1`);
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
