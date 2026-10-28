import { initPage } from '../core/app-init.js';
import { NAV_ITEMS, ROLES } from '../core/constants.js';

const session = initPage({ pageKey: 'dashboard', title: 'Welcome' });

if (session) {
  const notes = {
    [ROLES.ADMIN]: 'You are signed in with read-only access. You can view all information but cannot add, edit, approve or delete anything.',
    [ROLES.LEAD]: 'You can update permitted employee details and raise deployment and recall requests. The Project Manager makes the final decision.',
    [ROLES.PM]: 'You can review requests, approve or reject them, and confirm deployments and recalls.',
  };
  const note = document.getElementById('role-note');
  note.className = 'alert alert-info';
  note.textContent = notes[session.systemRole];

  const grid = document.getElementById('quick-links');
  for (const item of NAV_ITEMS.filter((i) => i.key !== 'dashboard' && i.roles.includes(session.systemRole))) {
    const card = document.createElement(item.built ? 'a' : 'div');
    card.className = 'card link-card' + (item.built ? '' : ' is-disabled');
    if (item.built) card.href = item.href;
    else card.title = `Available in Stage ${item.stage}`;

    const h = document.createElement('h2');
    h.innerHTML = '<i class="fa-solid" aria-hidden="true"></i><span></span>';
    h.firstChild.classList.add(item.icon);
    h.querySelector('span').textContent = item.label;
    const p = document.createElement('p');
    p.textContent = item.built ? item.desc : `${item.desc} (Available in Stage ${item.stage}.)`;
    card.append(h, p);
    grid.append(card);
  }
}
