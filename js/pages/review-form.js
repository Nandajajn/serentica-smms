
// Record or update a performance review (Project Manager). Opened as review-form.html?id=<employeeID>.
import { initPage, showFatal } from '../core/app-init.js';
import { ACTIONS, can } from '../core/access-control.js';
import { ValidationError } from '../core/validators.js';
import { ensureSeeded } from '../services/seed-service.js';
import { getEmployeeById } from '../services/employee-service.js';
import { CRITERIA, RATING_LABELS, bandOf, getEmployeeReviews, overallOf, periodOptions, saveReview } from '../services/performance-service.js';
import { $, h } from '../ui/dom.js';

const id = new URLSearchParams(location.search).get('id') || '';
const session = initPage({
  pageKey: 'performance', title: 'Record review',
  crumbs: [{ label: 'Welcome', href: 'dashboard.html' }, { label: 'Performance', href: 'performance.html' }, { label: 'Record review' }],
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
    if (!can(session, ACTIONS.REVIEW_RECORD)) {
      stop('Only Project Managers can record reviews', 'Reviews are recorded by Project Managers. Leads and Admin can view them.', 'performance.html', 'Back to performance');
      return;
    }
    const emp = await getEmployeeById(session, id);
    if (!emp) { stop('Employee not found', id ? `There is no employee "${id}" that you are allowed to see.` : 'No employee was chosen.', 'performance.html', 'Back to performance'); return; }
    if (emp.status === 'Exited') { stop('This employee has exited', `${emp.employeeName} has exited, so a new review cannot be recorded.`, `employee-profile.html?id=${encodeURIComponent(emp.employeeID)}`, 'Back to the profile'); return; }
    draw(emp, await getEmployeeReviews(session, emp.employeeID));
  } catch (err) {
    showFatal(err.message);
  }
}

function draw(emp, reviews) {
  const errorBoxes = {};
  const inputs = {};
  const wrap = (name, label, control, { required = false, hint = '', wide = false } = {}) => {
    inputs[name] = control;
    errorBoxes[name] = h('span', { class: 'field-error', id: `err-${name}` });
    return h('div', { class: `field${wide ? ' wide' : ''}` }, h('label', { for: control.id }, label, required ? h('span', { class: 'req', text: ' *' }) : null), control, hint ? h('span', { class: 'hint', text: hint }) : null, errorBoxes[name]);
  };
  const byPeriod = new Map(reviews.map((r) => [r.period, r]));

  const period = h('select', { class: 'input', id: 'f-period' }, periodOptions().map((p) => h('option', { value: p, text: byPeriod.has(p) ? `${p} (already reviewed, will be updated)` : p })));
  const overall = h('div', { class: 'overall', id: 'overall', 'aria-live': 'polite' });
  const note = h('div', { class: 'hint', id: 'period-note' });
  const comments = h('textarea', { class: 'input', id: 'f-comments', maxlength: '500' });

  const ratingControls = CRITERIA.map((c) => wrap(c.key, c.label,
    h('select', { class: 'input', id: `f-${c.key}`, required: true },
      h('option', { value: '', text: 'Choose a rating...' }),
      [5, 4, 3, 2, 1].map((n) => h('option', { value: String(n), text: `${n} - ${RATING_LABELS[n]}` }))), { required: true }));

  const ratings = () => Object.fromEntries(CRITERIA.map((c) => [c.key, inputs[c.key].value]));
  const refreshOverall = () => {
    const r = ratings();
    if (CRITERIA.every((c) => r[c.key])) {
      const o = overallOf(r);
      overall.textContent = `Overall: ${o} of 5 (${bandOf(o)})`;
    } else overall.textContent = 'Overall: choose all five ratings to see the average.';
  };
  const fillFor = (p) => {
    const existing = byPeriod.get(p);
    for (const c of CRITERIA) inputs[c.key].value = existing ? String(existing.ratings[c.key]) : '';
    comments.value = existing ? existing.comments : '';
    note.textContent = existing ? `A review for ${p} was recorded by ${existing.reviewerName}. Saving replaces it, and the change is kept in the history.` : '';
    refreshOverall();
  };
  period.addEventListener('change', () => fillFor(period.value));
  for (const c of CRITERIA) inputs[c.key].addEventListener('change', refreshOverall);

  const form = h('form', { id: 'review-form' },
    h('fieldset', {}, h('legend', { text: 'Who and when' }), h('div', { class: 'form-grid' },
      h('div', { class: 'field wide' }, h('strong', { id: 'who', text: `${emp.employeeName} (${emp.employeeID})` }), h('div', { class: 'hint', text: `${emp.designation || ''} - base site ${emp.baseSite}` })),
      wrap('period', 'Review period', period, { required: true, hint: 'One review per person per quarter. Choosing a quarter that already has a review lets you correct it.' }), note)),
    h('fieldset', {}, h('legend', { text: 'Ratings (1 = Poor, 5 = Excellent)' }), h('div', { class: 'form-grid' }, ratingControls), overall),
    h('fieldset', {}, h('legend', { text: 'Comments' }), h('div', { class: 'form-grid' },
      wrap('comments', 'Comment', comments, { wide: true, hint: 'Optional, but required when the overall rating is below 3. Keep it factual and about work.' }))),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', id: 'save-review', onclick: save }, h('i', { class: 'fa-solid fa-floppy-disk', 'aria-hidden': 'true' }), ' Save review'),
      h('a', { class: 'btn', id: 'cancel', href: `employee-profile.html?id=${encodeURIComponent(emp.employeeID)}` }, 'Cancel')));

  $('form-root').replaceChildren(
    h('div', { class: 'page-head' }, h('h1', { text: 'Record performance review' }),
      h('p', { text: 'Rate each of the five criteria. The overall rating is the average and is worked out for you.' })), form);
  fillFor(period.value);

  async function save() {
    $('banner').hidden = true;
    Object.values(errorBoxes).forEach((b) => { b.textContent = ''; });
    if (!form.reportValidity()) return;
    const buttons = document.querySelectorAll('#review-form button');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await saveReview(session, { employeeID: emp.employeeID, period: period.value, ratings: ratings(), comments: comments.value });
      location.assign(`employee-profile.html?id=${encodeURIComponent(emp.employeeID)}&saved=1`);
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
