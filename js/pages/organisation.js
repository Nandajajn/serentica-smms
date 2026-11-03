// Organisation structure page: a reporting tree you can filter by site, department, role or team.
import { initPage, showFatal } from '../core/app-init.js';
import { ACTIONS, can } from '../core/access-control.js';
import { subscribe } from '../core/store.js';
import { DEPARTMENTS, ORG_ROLES } from '../core/reference-data.js';
import { ensureSeeded } from '../services/seed-service.js';
import { getEmployees } from '../services/employee-service.js';
import { getImportSites } from '../services/import-preview.js';
import { ancestorsOf, buildOrg, descendantsOf } from '../services/org-service.js';
import { $, h, put } from '../ui/dom.js';

const session = initPage({
  pageKey: 'organisation', title: 'Organisation',
  crumbs: [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Organisation' }],
});

const deptName = (c) => DEPARTMENTS.find((d) => d.code === c)?.name || c || '';
const roleName = (c) => ORG_ROLES.find((r) => r.code === c)?.name || c || '';

const state = { all: [], sites: [], q: '', site: '', department: '', role: '', teamOf: '', collapsed: new Set() };

/* ---------- which people are shown ---------- */
function computeView() {
  const fullOrg = buildOrg(state.all);
  let base = state.all;
  if (state.teamOf && fullOrg.byId.has(state.teamOf)) {
    const ids = new Set([state.teamOf, ...descendantsOf(fullOrg, state.teamOf).map((e) => e.employeeID)]);
    base = base.filter((e) => ids.has(e.employeeID));
  }
  if (state.site) base = base.filter((e) => e.baseSite === state.site);

  const q = state.q.trim().toLowerCase();
  const filtering = Boolean(state.department || state.role || q);
  const matches = new Set(base.filter((e) =>
    (!state.department || e.department === state.department) && (!state.role || e.role === state.role) &&
    (!q || [e.employeeID, e.employeeName, e.designation].some((v) => String(v || '').toLowerCase().includes(q)))).map((e) => e.employeeID));

  // Keep the managers above each match, so the reporting lines stay connected (shown faded).
  const baseOrg = buildOrg(base);
  const included = new Set(matches);
  if (filtering) for (const id of matches) for (const m of ancestorsOf(baseOrg, id)) included.add(m.employeeID);
  const shown = filtering ? base.filter((e) => included.has(e.employeeID)) : base;
  return { org: buildOrg(shown), shown, matches, filtering, fullOrg };
}

/* ---------- drawing ---------- */
const badge = (text, kind) => h('span', { class: `badge badge-${kind}`, text });

function nodeView(emp, view, depth) {
  const kids = view.org.children.get(emp.employeeID) || [];
  const collapsed = state.collapsed.has(emp.employeeID);
  const teamSize = descendantsOf(view.org, emp.employeeID).length;
  const faded = view.filtering && !view.matches.has(emp.employeeID);
  const offscreenManager = emp.reportingManagerID && !view.org.byId.has(emp.reportingManagerID) && depth === 0;

  const toggle = kids.length
    ? h('button', { class: 'toggle', type: 'button', 'aria-label': `${collapsed ? 'Expand' : 'Collapse'} ${emp.employeeName}`, 'aria-expanded': String(!collapsed), 'data-toggle': emp.employeeID,
      onclick: () => { if (state.collapsed.has(emp.employeeID)) state.collapsed.delete(emp.employeeID); else state.collapsed.add(emp.employeeID); render(); } },
      h('i', { class: `fa-solid ${collapsed ? 'fa-chevron-right' : 'fa-chevron-down'}`, 'aria-hidden': 'true' }))
    : h('span', { class: 'spacer' });

  const row = h('div', { class: `node${faded ? ' faded' : ''}`, 'data-node': emp.employeeID }, toggle,
    h('a', { class: 'name', href: `employee-profile.html?id=${encodeURIComponent(emp.employeeID)}`, text: emp.employeeName }),
    h('span', { class: 'muted small', text: emp.employeeID }),
    h('span', { class: 'small', text: emp.designation || roleName(emp.role) }),
    badge(deptName(emp.department), 'primary'),
    emp.status !== 'Active' ? badge(emp.status, emp.status === 'On Leave' ? 'warn' : 'off') : null,
    kids.length ? h('span', { class: 'muted small', text: `${kids.length} direct, ${teamSize} in team` }) : null,
    offscreenManager ? h('span', { class: 'note', text: `reports to ${emp.reportingManagerID} (not shown)` }) : null,
    can(session, ACTIONS.EMPLOYEE_EDIT_OPERATIONAL, { site: emp.baseSite, department: emp.department })
      ? h('a', { class: 'small', href: `employee-form.html?id=${encodeURIComponent(emp.employeeID)}`, 'aria-label': `Edit ${emp.employeeName}`, text: 'Edit' }) : null);

  return h('li', { role: 'treeitem', 'aria-expanded': kids.length ? String(!collapsed) : null }, row,
    kids.length && !collapsed ? h('ul', { role: 'group' }, kids.map((k) => nodeView(k, view, depth + 1))) : null);
}

function renderControls() {
  const select = (key, label, options, blank) => h('div', { class: 'field-row' }, h('label', { for: `o-${key}`, text: label }),
    h('select', { class: 'input', id: `o-${key}`, onchange: (e) => { state[key] = e.target.value; render(); } },
      h('option', { value: '', text: blank }), options));
  $('controls').replaceChildren(h('div', { class: 'toolbar' },
    h('div', { class: 'field-row wide' }, h('label', { for: 'o-search', text: 'Find a person' }),
      h('input', { class: 'input', id: 'o-search', type: 'search', placeholder: 'Name, ID or designation', autocomplete: 'off', oninput: (e) => { state.q = e.target.value; render(); } })),
    select('site', 'Site', state.sites.map((s) => h('option', { value: s.siteCode, text: s.siteName })), 'All sites'),
    select('department', 'Department', DEPARTMENTS.map((d) => h('option', { value: d.code, text: d.name })), 'All departments'),
    select('role', 'Role', ORG_ROLES.map((r) => h('option', { value: r.code, text: r.name })), 'All roles'),
    select('teamOf', 'Team of', [], 'Everyone'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', id: 'expand-all', onclick: () => { state.collapsed.clear(); render(); } }, 'Expand all'),
      h('button', { class: 'btn', type: 'button', id: 'collapse-all', onclick: () => { state.collapsed = new Set(state.all.map((e) => e.employeeID)); render(); } }, 'Collapse all'),
      h('button', { class: 'btn', type: 'button', id: 'reset', onclick: reset }, 'Reset'))));
}

// The "Team of" list changes when reporting lines change, so only that list is refreshed.
function refreshTeamOptions() {
  const sel = $('o-teamOf');
  const managers = state.all.filter((e) => state.all.some((x) => x.reportingManagerID === e.employeeID));
  const pms = managers.filter((m) => m.role === 'PROJECT_MANAGER');
  const others = managers.filter((m) => m.role !== 'PROJECT_MANAGER').sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  const opt = (m) => h('option', { value: m.employeeID, text: `${m.employeeName} (${m.employeeID}) - ${m.designation || roleName(m.role)}` });
  sel.replaceChildren(h('option', { value: '', text: 'Everyone' }),
    pms.length ? h('optgroup', { label: 'Project Managers' }, pms.map(opt)) : null, others.length ? h('optgroup', { label: 'Other managers' }, others.map(opt)) : null);
  sel.value = state.teamOf;
}

function reset() {
  Object.assign(state, { q: '', site: '', department: '', role: '', teamOf: '' });
  state.collapsed.clear();
  $('o-search').value = '';
  document.querySelectorAll('#controls select').forEach((s) => { s.value = ''; });
  render();
}

function render() {
  const card = $('tree-card');
  card.replaceChildren();
  if (!state.all.length) {
    put(card, h('div', { class: 'empty', id: 'empty-all' }, h('p', { text: 'There are no employees to show yet.' }),
      can(session, ACTIONS.IMPORT_UPLOAD) ? h('a', { class: 'btn btn-primary', href: 'data-management.html' }, 'Upload employees from Excel') : null));
    return;
  }
  const view = computeView();
  if (!view.shown.length) {
    put(card, h('div', { class: 'empty', id: 'empty-filter' }, h('p', { text: 'Nobody matches these filters.' }), h('button', { class: 'btn', type: 'button', onclick: reset }, 'Reset filters')));
    return;
  }
  const depthOf = (id, org) => ancestorsOf(org, id).length;
  put(card,
    h('p', { class: 'small summary', id: 'summary', text: `Showing ${view.shown.length} of ${state.all.length} people in ${view.org.roots.length} reporting tree${view.org.roots.length === 1 ? '' : 's'}.${view.filtering ? ' People who do not match are faded and are shown only to keep the reporting lines connected.' : ''}` }),
    h('ul', { class: 'tree', role: 'tree', id: 'tree' }, view.org.roots.map((r) => nodeView(r, view, depthOf(r.employeeID, view.org)))));
}

async function load() {
  state.all = await getEmployees(session);
  if (state.teamOf && !state.all.some((e) => e.employeeID === state.teamOf)) state.teamOf = '';
  refreshTeamOptions();
  render();
}

async function start() {
  if (!session) return;
  try {
    await ensureSeeded();
    state.sites = await getImportSites(session);
    renderControls();
    await load();
    subscribe('employees', () => load()); // a manager, department or role changed somewhere
  } catch (err) {
    showFatal(err.message);
  }
}
start();
