// Prototype authentication against the demo users in the shared database.
// Passwords are stored as salted hashes, but the session lives in sessionStorage and
// the checking happens in the browser, so this is NOT real security. Production needs
// server-side authentication.
import { ROLES, STORAGE_KEYS } from '../core/constants.js';
import { getAll, write } from '../core/store.js';
import { hashPassword } from '../core/utils.js';
import { DEMO_USER_SEEDS } from '../seed/seed-data.js';
import { addAudit } from './audit-service.js';
import { ensureSeeded } from './seed-service.js';

/** Demo accounts shown on the login page (demo only). */
export function listDemoAccounts() {
  return DEMO_USER_SEEDS.map(({ username, password, systemRole }) => ({ username, password, systemRole }));
}

export async function login(identifier, password) {
  const id = String(identifier || '').trim().toLowerCase();
  const pw = String(password || '');
  if (!id || !pw) return { ok: false, error: 'Enter your username or email and your password.' };

  await ensureSeeded();
  const users = await getAll('users');
  const user = users.find((u) => u.username.toLowerCase() === id || u.email.toLowerCase() === id);
  const valid = user && (await hashPassword(pw, user.salt)) === user.passwordHash;

  if (!valid) {
    await write('auditEvents', (tx) => addAudit(tx, {
      actor: null, action: 'LOGIN_FAILED', recordType: 'user', recordID: id, reason: 'Incorrect username or password.',
    }));
    return { ok: false, error: 'The username or password is incorrect.' };
  }

  const session = {
    userID: user.userID, username: user.username, displayName: user.displayName,
    systemRole: user.systemRole, siteScope: user.siteScope, departmentScope: user.departmentScope,
    loggedInAt: new Date().toISOString(),
  };
  await write('auditEvents', (tx) => addAudit(tx, { actor: session, action: 'LOGIN', recordType: 'user', recordID: user.userID }));
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
