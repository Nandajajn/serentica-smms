// Activity: notifications addressed to you, and the audit history of changes you may see.
import { initPage, showFatal } from '../core/app-init.js';
import { ACTIONS, can } from '../core/access-control.js';
import { subscribe } from '../core/store.js';
import { toCSV } from '../core/csv.js';
import { ensureSeeded } from '../services/seed-service.js';
import { getNotificationsFor } from '../services/notification-service.js';
import { RECORD_LABELS, getVisibleAuditEvents, humanAction, recordLink } from '../services/activity-service.js';
import { $, download, fmtDateTime, h } from '../ui/dom.js';

const session = initPage({ pageKey: 'notifications', title: 'Activity', crumbs: [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Activity' }] });
const AUDIT_LIMIT = 200;
const state = { tab: new URLSearchParams(location.search).get('tab') === 'audit' ? 'audit' : 'notifications', notes: [], events: [], seen: null, q: '', type: '' };

// "Seen" is remembered per person in this browser only. It is a convenience, so a failure is ignored.
const seenKey = () => `smm.activity.seen.${session.userID}`;
function readSeen() { try { return localStorage.getItem(seenKey()) || ''; } catch { return ''; } }
function writeSeen(value) { try { localStorage.setItem(seenKey(), value); } catch { /* private mode: not remembered */ } }

const link = (type, id, text) => {
  const href = recordLink(type, id);
  return href ? h('a', { href, text: text || id }) : h('span', { text: text || id || '' });
};

/* ---------- notifications ---------- */
function renderNotifications() {
  const unseen = state.notes.filter((n) => !state.seen || n.createdAt > state.seen);
  $('panel').replaceChildren(
    h('div', { class: 'alert alert-info', id: 'sim-note', role: 'note', text: 'Demo only: these messages are shown inside the application. Nothing is sent by e-mail or phone.' }),
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' },
      h('span', { id: 'unseen-count', class: 'muted small', text: `${unseen.length} new, ${state.notes.length} in total` }),
      unseen.length ? h('button', { class: 'btn btn-sm', type: 'button', id: 'mark-seen', onclick: () => { writeSeen(new Date().toISOString()); state.seen = readSeen(); renderNotifications(); } }, 'Mark all as seen') : null),
    state.notes.length
      ? h('ul', { class: 'feed', id: 'note-list' }, state.notes.map((n) => {
        const isNew = !state.seen || n.createdAt > state.seen;
        return h('li', { class: isNew ? 'is-new' : null, 'data-id': n.notificationID },
          h('div', {}, isNew ? h('span', { class: 'badge badge-primary', text: 'New' }) : null, ' ', h('span', { text: n.message })),
          h('div', { class: 'muted small' }, fmtDateTime(n.createdAt), n.relatedRecordID ? ' - ' : '', n.relatedRecordID ? link(n.relatedRecordType, n.relatedRecordID, `Open ${n.relatedRecordID}`) : null));
      }))
      : h('div', { class: 'empty', id: 'note-empty' }, h('p', { text: 'No notifications yet. They appear when requests are submitted or decided.' })));
}

/* ---------- audit history ---------- */
function filteredEvents() {
  const q = state.q.trim().toLowerCase();
  return state.events.filter((e) => (!state.type || e.recordType === state.type)
    && (!q || [e.actorName, humanAction(e.action), e.recordID, e.reason].some((v) => String(v || '').toLowerCase().includes(q))));
}

function renderAuditTable() {
  const area = $('audit-area');
  if (!area) return;
  const rows = filteredEvents();
  $('audit-count').textContent = `${rows.length} of ${state.events.length} events`;
  if (!rows.length) { area.replaceChildren(h('div', { class: 'empty', id: 'audit-empty' }, h('p', { text: 'No events match.' }))); return; }
  area.replaceChildren(
    h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'audit-table' },
      h('thead', {}, h('tr', {}, ['When', 'Who', 'What happened', 'Record', 'Reason'].map((t) => h('th', { text: t })))),
      h('tbody', {}, rows.slice(0, AUDIT_LIMIT).map((e) => h('tr', {},
        h('td', { text: fmtDateTime(e.timestamp) }), h('td', { text: e.actorName }), h('td', { text: humanAction(e.action) }),
        h('td', {}, h('span', { class: 'muted small', text: `${RECORD_LABELS[e.recordType] || e.recordType} ` }), link(e.recordType, e.recordID)),
        h('td', { class: 'wrap', text: e.reason || '' })))))),
    ...(rows.length > AUDIT_LIMIT ? [h('p', { class: 'muted small', text: `Showing the latest ${AUDIT_LIMIT}. Export to see all ${rows.length}.` })] : []));
}

function exportAudit() {
  const csv = toCSV([['When', 'Who', 'Role', 'Action', 'Record type', 'Record', 'Reason'],
    ...filteredEvents().map((e) => [e.timestamp, e.actorName, e.actorRole, humanAction(e.action), e.recordType, e.recordID || '', e.reason || ''])]);
  download(`smms-audit-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
}

function renderAudit() {
  const types = [...new Set(state.events.map((e) => e.recordType))].sort();
  $('panel').replaceChildren(
    h('p', { class: 'muted small', text: session.systemRole === 'ADMIN' ? 'Every recorded change.' : 'Changes to records you can open, plus everything you did yourself.' }),
    h('div', { class: 'toolbar' },
      h('div', { class: 'field-row' }, h('label', { for: 'q', text: 'Search' }),
        h('input', { class: 'input', id: 'q', type: 'search', placeholder: 'Person, action, record or reason', autocomplete: 'off', value: state.q, oninput: (e) => { state.q = e.target.value; renderAuditTable(); } })),
      h('div', { class: 'field-row' }, h('label', { for: 'type', text: 'Record type' }),
        h('select', { class: 'input', id: 'type', onchange: (e) => { state.type = e.target.value; renderAuditTable(); } },
          h('option', { value: '', text: 'All' }), types.map((t) => h('option', { value: t, text: RECORD_LABELS[t] || t }))))),
    h('div', { class: 'row', style: 'margin:12px 0;justify-content:space-between' }, h('span', { id: 'audit-count', class: 'muted small' }),
      can(session, ACTIONS.EXPORT_DATA) ? h('button', { class: 'btn', type: 'button', id: 'export', onclick: exportAudit }, h('i', { class: 'fa-solid fa-file-csv', 'aria-hidden': 'true' }), ' Export CSV') : null),
    h('div', { id: 'audit-area' }));
  $('type').value = state.type;
  renderAuditTable();
}

/* ---------- page ---------- */
function render() {
  const unseen = state.notes.filter((n) => !state.seen || n.createdAt > state.seen).length;
  const tab = (key, label) => h('button', { class: 'tab', type: 'button', id: `tab-${key}`, role: 'tab', 'aria-selected': String(state.tab === key),
    onclick: () => { state.tab = key; history.replaceState(null, '', key === 'audit' ? '?tab=audit' : location.pathname); render(); } }, label);
  $('view').replaceChildren(
    h('div', { class: 'page-head' }, h('h1', { text: 'Activity' }), h('p', { text: 'Notifications for you, and the history of changes made in the system.' })),
    h('div', { class: 'card' },
      h('div', { class: 'tabs', role: 'tablist' }, tab('notifications', unseen ? `Notifications (${unseen} new)` : 'Notifications'), tab('audit', 'Audit history')),
      h('div', { id: 'panel', role: 'tabpanel' })));
  if (state.tab === 'audit') renderAudit(); else renderNotifications();
}

async function load() {
  [state.notes, state.events] = await Promise.all([getNotificationsFor(session), getVisibleAuditEvents(session)]);
  state.seen = readSeen();
  render();
}

if (session) {
  try {
    await ensureSeeded();
    await load();
    for (const topic of ['notifications', 'auditEvents']) subscribe(topic, () => load().catch((e) => showFatal(e.message)));
  } catch (err) { showFatal(err.message); }
}
