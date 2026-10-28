// Stage 2 STUB authentication.
// Demo accounts only. Stage 3 replaces this with hashed credentials in the shared
// data store. sessionStorage can be edited by anyone using browser dev tools, so this
// is NOT real security. Production needs server-side authentication.
import { ROLES, STORAGE_KEYS } from '../core/constants.js';

const DEMO_USERS = Object.freeze([
  { userID: 'U-DEMO-ADMIN', username: 'admin.demo', email: 'admin@demo.serentica.example',
    password: 'Admin@123', displayName: 'Demo Admin', systemRole: ROLES.ADMIN },
  { userID: 'U-DEMO-LEAD', username: 'lead.demo', email: 'lead@demo.serentica.example',
    password: 'Lead@123', displayName: 'Demo Lead', systemRole: ROLES.LEAD },
  { userID: 'U-DEMO-PM', username: 'pm.demo', email: 'pm@demo.serentica.example',
    password: 'Manager@123', displayName: 'Demo Project Manager', systemRole: ROLES.PM },
]);

/** Demo accounts for display on the login page (passwords are demo-only). */
export function listDemoAccounts() {
  return DEMO_USERS.map(({ username, password, systemRole }) => ({ username, password, systemRole }));
}

export function login(identifier, password) {
  const id = String(identifier || '').trim().toLowerCase();
  const pw = String(password || '');
  if (!id || !pw) return { ok: false, error: 'Enter your username or email and your password.' };

  const user = DEMO_USERS.find(
    (u) => (u.username.toLowerCase() === id || u.email.toLowerCase() === id) && u.password === pw
  );
  if (!user) return { ok: false, error: 'The username or password is incorrect.' };

  const session = {
    userID: user.userID, username: user.username, displayName: user.displayName,
    systemRole: user.systemRole, loggedInAt: new Date().toISOString(),
  };
  sessionStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
  return { ok: true, user: session };
}

export function getSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.session);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && Object.values(ROLES).includes(s.systemRole) ? s : null;
  } catch {
    return null;
  }
}

export function logout() {
  sessionStorage.removeItem(STORAGE_KEYS.session);
}

/** Returns the session, or redirects to the login page and returns null. */
export function requireAuth() {
  const session = getSession();
  if (!session) {
    const page = location.pathname.split('/').pop();
    const next = /^[a-z-]+\.html$/.test(page) && page !== 'login.html' ? `?next=${page}` : '';
    location.replace(`login.html${next}`);
    return null;
  }
  return session;
}
