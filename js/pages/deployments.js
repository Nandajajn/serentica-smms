// Deployments: the list of requests, and one request in detail with the actions your role may take.
import { initPage, showFatal } from '../core/app-init.js';
import { ACTIONS, can } from '../core/access-control.js';
import { ROLES } from '../core/constants.js';
import { subscribe } from '../core/store.js';
import { STATUS_LABELS } from '../core/workflow.js';
import { ValidationError } from '../core/validators.js';
import { ensureSeeded } from '../services/seed-service.js';
import { getEmployees } from '../services/employee-service.js';
import { availabilityOf } from '../services/availability-service.js';
import { actOnDeployment, getDeploymentRequest, getDeploymentRequests } from '../services/deployment-service.js';
import { $, fmtDateTime, h, put } from '../ui/dom.js';

const id = new URLSearchParams(location.search).get('id') || '';
const session = initPage({
  pageKey: 'deployments', title: 'Deployments',
  crumbs: id ? [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Deployments', href: 'deployments.html' }, { label: id }]
    : [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Deployments' }],
});

const KIND = { Draft: 'off', Submitted: 'primary', 'Under Review': 'primary', Returned: 'warn', Approved: 'warn', Rejected: 'bad', Confirmed: 'ok', Cancelled: 'off' };
const statusBadge = (s) => h('span', { class: `badge badge-${KIND[s] || 'off'}`, text: STATUS_LABELS[s] || s });
const show = (v) => (v === null || v === undefined || v === '' ? '-' : String(v));
const state = { requests: [], people: new Map(), filter: '', q: '' };

function banner(type, message) {
  const box = $('banner');
  box.className = `alert alert-${type}`;
  box.setAttribute('role', type === 'error' ? 'alert' : 'status');
  box.textContent = message;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}

/* ---------- list ---------- */
function actionNeeded(r) {
  if (session.systemRole === ROLES.PM) return ['Submitted', 'Under Review', 'Approved'].includes(r.status);
  if (session.systemRole === ROLES.LEAD) return r.status === 'Returned';
  return false;
}

function matches(r) {
  if (state.filter === 'action') return actionNeeded(r);
  if (state.filter && r.status !== state.filter) return false;
  const q = state.q.trim().toLowerCase();
  return !q || [r.requestID, r.employeeName, r.employeeID, r.targetSite, r.targetProject, r.requestedByName].some((v) => String(v || '').toLowerCase().includes(q));
}

// The table is redrawn on every search or filter change; the controls above it are not, so typing is never interrupted.
function renderTable() {
  const area = $('table-area');
  if (!area) return;
  const rows = state.requests.filter(matches);
  document.querySelectorAll('.tile').forEach((t) => t.classList.toggle('is-on', t.dataset.filter === state.filter));
  const sel = $('status');
  if (sel) sel.value = state.filter;

  if (!state.requests.length) {
    area.replaceChildren(h('div', { class: 'empty', id: 'empty-all' }, h('p', { text: 'There are no deployment requests yet.' }),
      can(session, ACTIONS.DEPLOYMENT_CREATE) ? h('a', { class: 'btn btn-primary', href: 'deployment-form.html' }, 'Create the first request') : null));
    return;
  }
  if (!rows.length) {
    area.replaceChildren(h('div', { class: 'empty', id: 'empty-filter' }, h('p', { text: 'No requests match.' }),
      h('button', { class: 'btn', type: 'button', onclick: () => { state.filter = ''; state.q = ''; $('q').value = ''; renderTable(); } }, 'Clear filters')));
    return;
  }
  const head = h('tr', {}, ['Request', 'Employee', 'Deploy to', 'Dates', 'Status', 'Requested by', 'Updated'].map((t) => h('th', { text: t })));
  const body = rows.map((r) => h('tr', { 'data-id': r.requestID },
    h('td', {}, h('a', { href: `deployments.html?id=${encodeURIComponent(r.requestID)}`, text: r.requestID })),
    h('td', {}, h('a', { href: `employee-profile.html?id=${encodeURIComponent(r.employeeID)}`, text: r.employeeName }), h('div', { class: 'muted small', text: r.employeeID })),
    h('td', { text: `${r.targetSite} / ${r.targetProject}` }),
    h('td', { text: `${r.startDate}${r.expectedEndDate ? ' to ' + r.expectedEndDate : ''}` }),
    h('td', {}, statusBadge(r.status)),
    h('td', { text: r.requestedByName || '' }),
    h('td', { text: fmtDateTime(r.updatedAt) })));
  area.replaceChildren(h('div', { class: 'table-wrap', style: 'margin-top:16px' },
    h('table', { class: 'table', id: 'request-table' }, h('thead', {}, head), h('tbody', {}, body))));
}

function renderList() {
  const count = (s) => state.requests.filter((r) => r.status === s).length;
  const needed = state.requests.filter(actionNeeded).length;
  const tile = (key, label, n) => h('button', { class: 'tile', type: 'button', 'data-filter': key,
    onclick: () => { state.filter = state.filter === key ? '' : key; renderTable(); } }, h('b', { text: String(n) }), h('span', { class: 'small muted', text: label }));
  const intro = session.systemRole === ROLES.LEAD ? 'Your deployment requests. The Project Manager makes the final decision.'
    : session.systemRole === ROLES.PM ? 'Requests from Leads. You approve, reject or send back, and confirm approved requests.'
      : 'All deployment requests (read-only).';

  $('view').replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('h1', { text: 'Deployments' }),
        can(session, ACTIONS.DEPLOYMENT_CREATE)
          ? h('a', { class: 'btn btn-primary', id: 'new-request', href: 'deployment-form.html' }, h('i', { class: 'fa-solid fa-plus', 'aria-hidden': 'true' }), ' New deployment request') : null),
      h('p', { text: intro })),
    h('div', { class: 'stack' },
      h('div', { class: 'tiles' },
        tile('action', session.systemRole === ROLES.LEAD ? 'Sent back to you' : 'Waiting for you', needed), tile('Submitted', 'Submitted', count('Submitted')),
        tile('Under Review', 'Under review', count('Under Review')), tile('Approved', 'Approved, to confirm', count('Approved')),
        tile('Confirmed', 'Confirmed', count('Confirmed')), tile('Rejected', 'Rejected', count('Rejected'))),
      h('div', { class: 'card' },
        h('div', { class: 'toolbar' },
          h('div', { class: 'field-row' }, h('label', { for: 'q', text: 'Search' }),
            h('input', { class: 'input', id: 'q', type: 'search', placeholder: 'Request ID, employee, site...', autocomplete: 'off', value: state.q,
              oninput: (e) => { state.q = e.target.value; renderTable(); } })),
          h('div', { class: 'field-row' }, h('label', { for: 'status', text: 'Status' }),
            h('select', { class: 'input', id: 'status', onchange: (e) => { state.filter = e.target.value; renderTable(); } },
              h('option', { value: '', text: 'All' }),
              h('option', { value: 'action', text: session.systemRole === ROLES.LEAD ? 'Sent back to me' : 'Waiting for me' }),
              ['Draft', 'Submitted', 'Under Review', 'Returned', 'Approved', 'Rejected', 'Confirmed', 'Cancelled'].map((s) => h('option', { value: s, text: STATUS_LABELS[s] }))))),
        h('div', { id: 'table-area' }))));
  renderTable();
}

/* ---------- one request ---------- */
const NEXT = {
  Draft: 'This is a draft. It has not been sent to the Project Manager.',
  Submitted: 'Waiting for the Project Manager to review it.',
  'Under Review': 'The Project Manager is reviewing it.',
  Returned: 'The Project Manager sent it back. The Lead can edit it and submit it again.',
  Approved: 'Approved, but the employee has NOT been moved yet. The Project Manager must confirm the deployment.',
  Rejected: 'Rejected. Nothing changed for the employee. A new request can be raised.',
  Confirmed: 'Confirmed. The employee is deployed and no longer available.',
  Cancelled: 'Cancelled. Nothing changed for the employee.',
};

async function run(r, action, { confirmText } = {}) {
  const box = $('comment');
  if (confirmText && !window.confirm(confirmText)) return;
  $('banner').hidden = true;
  document.querySelectorAll('#actions button').forEach((b) => { b.disabled = true; });
  try {
    await actOnDeployment(session, r.requestID, action, { comment: box ? box.value : '', expectedVersion: r.version });
    banner('success', `Done: ${action === 'startReview' ? 'review started' : action === 'return' ? 'sent back to the Lead' : action + (action.endsWith('e') ? 'd' : 'ed')}.`);
  } catch (err) {
    banner('error', err instanceof ValidationError ? Object.values(err.errors).join(' ') : err.message);
    document.querySelectorAll('#actions button').forEach((b) => { b.disabled = false; });
  }
}

function actionsFor(r) {
  const btn = (label, action, cls, confirmText, icon) => h('button', { class: `btn ${cls}`, type: 'button', 'data-action': action, onclick: () => run(r, action, { confirmText }) }, h('i', { class: `fa-solid ${icon}`, 'aria-hidden': 'true' }), ` ${label}`);
  const out = [];
  const isOwner = r.requestedByUserID === session.userID;
  if (session.systemRole === ROLES.LEAD && isOwner) {
    if (['Draft', 'Returned'].includes(r.status)) out.push(h('a', { class: 'btn', id: 'edit-request', href: `deployment-form.html?id=${encodeURIComponent(r.requestID)}` }, h('i', { class: 'fa-solid fa-pen', 'aria-hidden': 'true' }), ' Edit'), btn('Submit for approval', 'submit', 'btn-primary', null, 'fa-paper-plane'));
    if (['Draft', 'Submitted', 'Returned'].includes(r.status)) out.push(btn('Cancel request', 'cancel', 'btn-danger', 'Cancel this request? This cannot be undone.', 'fa-ban'));
  }
  if (session.systemRole === ROLES.PM) {
    if (r.status === 'Submitted') out.push(btn('Start review', 'startReview', '', null, 'fa-magnifying-glass'));
    if (['Submitted', 'Under Review'].includes(r.status)) out.push(
      btn('Approve', 'approve', 'btn-primary', 'Approve this request? The employee will NOT move until you confirm the deployment.', 'fa-check'),
      btn('Send back to Lead', 'return', '', null, 'fa-rotate-left'), btn('Reject', 'reject', 'btn-danger', 'Reject this request?', 'fa-xmark'));
    if (r.status === 'Approved') out.push(btn('Confirm deployment', 'confirm', 'btn-good', 'Confirm the deployment? The employee will be marked Deployed at the new site and will no longer be available.', 'fa-circle-check'));
    if (['Draft', 'Submitted', 'Under Review', 'Returned', 'Approved'].includes(r.status) && r.status !== 'Draft') out.push(btn('Cancel request', 'cancel', 'btn-danger', 'Cancel this request?', 'fa-ban'));
  }
  return out;
}

async function renderDetail() {
  const r = await getDeploymentRequest(session, id);
  const root = $('view');
  if (!r) {
    root.replaceChildren(h('div', { class: 'card', id: 'not-found' }, h('h1', { text: 'Request not found' }), h('p', { text: 'There is no such request that you are allowed to see.' }), h('a', { class: 'btn btn-primary', href: 'deployments.html' }, 'Back to deployments')));
    return;
  }
  const emp = state.people.get(r.employeeID);
  const avail = emp ? availabilityOf(emp) : null;
  const actions = actionsFor(r);
  const needsComment = actions.some((a) => ['approve', 'reject', 'return', 'cancel'].includes(a.dataset?.action));
  const facts = (pairs) => h('dl', { class: 'facts' }, pairs.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', {}, v instanceof Node ? v : show(v))]));

  root.replaceChildren(h('div', { class: 'stack' },
    new URLSearchParams(location.search).get('saved') ? h('div', { class: 'alert', id: 'saved-banner', role: 'status', style: 'background:var(--success-bg);border-color:var(--success);color:var(--success)', text: 'Saved.' }) : null,
    h('div', { class: 'card' }, h('div', { class: 'row', style: 'justify-content:space-between' },
      h('div', {}, h('h1', { id: 'req-title', text: `Deployment request ${r.requestID}`, style: 'margin-bottom:4px' }), h('p', { class: 'muted', text: `${r.employeeName} to ${r.targetSite} / ${r.targetProject}` })), statusBadge(r.status)),
      h('p', { class: 'next', id: 'next-step', text: NEXT[r.status] })),
    h('div', { class: 'cols' },
      h('section', { class: 'card' }, h('h2', { text: 'Request' }), facts([
        ['Employee', h('a', { href: `employee-profile.html?id=${encodeURIComponent(r.employeeID)}`, text: `${r.employeeName} (${r.employeeID})` })],
        ['Deploy to', `${r.targetSite} / ${r.targetProject}`], ['Role / assignment', r.assignmentRole], ['Start date', r.startDate], ['Expected end', r.expectedEndDate],
        ['Reason', r.reason], ['Remarks', r.remarks], ['Requested by', r.requestedByName], ['Created', fmtDateTime(r.createdAt)], ['Last updated', fmtDateTime(r.updatedAt)]])),
      h('section', { class: 'card' }, h('h2', { text: 'Employee right now' }), facts([
        ['Status', emp?.status], ['Deployment status', emp?.deploymentStatus], ['Current site', emp?.currentSite], ['Base site', emp?.baseSite],
        ['Available', avail ? (avail.available ? 'Yes' : `No. ${avail.reason}`) : 'Not visible to you'],
        ['Assignment', r.resultingAssignmentID || 'None yet']]))),
    actions.length ? h('section', { class: 'card', id: 'actions' }, h('h2', { text: 'Actions' }),
      needsComment ? h('div', { class: 'field' }, h('label', { for: 'comment', text: session.systemRole === ROLES.PM ? 'Comment (required to reject, send back or cancel)' : 'Comment (optional)' }), h('textarea', { class: 'input', id: 'comment', maxlength: '500' })) : null,
      h('div', { class: 'row' }, actions)) : null,
    h('section', { class: 'card' }, h('h2', { text: 'History' }), h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'history-table' },
      h('thead', {}, h('tr', {}, ['When', 'What', 'By', 'Status', 'Comment'].map((t) => h('th', { text: t })))),
      h('tbody', {}, r.history.map((x) => h('tr', {}, h('td', { text: fmtDateTime(x.at) }), h('td', { text: x.action }), h('td', { text: `${x.byName} (${x.byRole})` }),
        h('td', { text: x.to || '' }), h('td', { class: 'wrap', text: x.comment || '' }))))))),
    h('p', {}, h('a', { href: 'deployments.html' }, 'Back to all deployment requests'))));
}

function refreshTiles() {
  const count = (s) => state.requests.filter((r) => r.status === s).length;
  const counts = { action: state.requests.filter(actionNeeded).length, Submitted: count('Submitted'), 'Under Review': count('Under Review'), Approved: count('Approved'), Confirmed: count('Confirmed'), Rejected: count('Rejected') };
  document.querySelectorAll('.tile').forEach((t) => { t.querySelector('b').textContent = String(counts[t.dataset.filter] ?? 0); });
}

async function load() {
  state.requests = await getDeploymentRequests(session);
  state.people = new Map((await getEmployees(session)).map((e) => [e.employeeID, e]));
  if (id) await renderDetail();
  else if ($('table-area')) { refreshTiles(); renderTable(); } // keep the search box and your cursor as they are
  else renderList();
}

async function start() {
  if (!session) return;
  try {
    await ensureSeeded();
    await load();
    subscribe('deploymentRequests', () => load());
    subscribe('employees', () => load());
  } catch (err) {
    showFatal(err.message);
  }
}
start();
