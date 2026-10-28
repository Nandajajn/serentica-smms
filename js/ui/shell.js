// Renders the shared header, sidebar and breadcrumbs around #page-content.
import { APP_NAME, NAV_ITEMS, ROLES, ROLE_LABELS } from '../core/constants.js';
import { logout } from '../services/auth-service.js';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}
const icon = (name) => el('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });

function buildHeader(session) {
  const toggle = el('button', { class: 'icon-btn menu-toggle', type: 'button', 'aria-label': 'Toggle navigation' }, icon('fa-bars'));
  toggle.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));

  const brand = el('a', { class: 'brand', href: 'dashboard.html' }, [
    el('span', { class: 'brand-mark' }, icon('fa-solar-panel')),
    el('span', { class: 'brand-name' }, [
      document.createTextNode('Serentica'),
      el('span', { class: 'brand-sub', text: 'Site Manpower Management' }),
    ]),
  ]);

  const user = el('div', { class: 'header-user' });
  if (session.systemRole === ROLES.ADMIN) {
    user.append(el('span', { class: 'badge badge-readonly', title: 'Admin accounts cannot change data', text: 'Read-only access' }));
  }
  user.append(el('span', { class: 'badge badge-primary', text: ROLE_LABELS[session.systemRole] }));
  user.append(el('span', { text: session.displayName }));
  const out = el('button', { class: 'btn btn-sm', type: 'button' }, [icon('fa-right-from-bracket'), document.createTextNode(' Sign out')]);
  out.addEventListener('click', () => { logout(); location.replace('login.html'); });
  user.append(out);

  return el('header', { class: 'app-header' }, [toggle, brand, el('div', { class: 'header-spacer' }), user]);
}

function buildSidebar(session, activeKey) {
  const list = el('ul', { class: 'nav-list' });
  for (const item of NAV_ITEMS.filter((i) => i.roles.includes(session.systemRole))) {
    const inner = [icon(item.icon), document.createTextNode(item.label)];
    let link;
    if (item.built) {
      link = el('a', { class: 'nav-link', href: item.href }, inner);
      if (item.key === activeKey) link.setAttribute('aria-current', 'page');
    } else {
      link = el('span', { class: 'nav-link is-disabled', 'aria-disabled': 'true', title: `Available in Stage ${item.stage}` },
        [...inner, el('span', { class: 'nav-stage', text: `Stage ${item.stage}` })]);
    }
    list.append(el('li', {}, link));
  }
  return el('nav', { class: 'app-sidebar', 'aria-label': 'Main navigation' }, list);
}

function buildBreadcrumbs(crumbs) {
  const ol = el('ol', { class: 'breadcrumbs' });
  crumbs.forEach((c, i) => {
    const last = i === crumbs.length - 1;
    ol.append(el('li', last ? { 'aria-current': 'page' } : {}, c.href && !last ? el('a', { href: c.href, text: c.label }) : document.createTextNode(c.label)));
  });
  return el('nav', { 'aria-label': 'Breadcrumb' }, ol);
}

/** Wraps the existing <main id="page-content"> with the shell. */
export function renderShell({ session, pageKey, title, crumbs }) {
  const content = document.getElementById('page-content');
  if (!content) throw new Error('Page is missing <main id="page-content">.');
  document.title = `${title} | ${APP_NAME}`;

  const main = el('div', { class: 'app-main' });
  main.append(buildBreadcrumbs(crumbs || [{ label: title }]), content);
  document.body.prepend(buildHeader(session), buildSidebar(session, pageKey), main);

  // Close the mobile sidebar when the user taps the page content.
  main.addEventListener('click', () => document.body.classList.remove('sidebar-open'));
}
