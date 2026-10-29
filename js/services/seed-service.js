// Puts demo sites, demo users and demo employees into an empty database, once each.
import { getOne, write } from '../core/store.js';
import { hashPassword, nowISO, randomSalt } from '../core/utils.js';
import { DEMO_USER_SEEDS, SITES, buildDemoEmployees } from '../seed/seed-data.js';
import { addAudit } from './audit-service.js';

const SEED_KEY = 'seeded.v1';
const EMPLOYEES_KEY = 'seededEmployees.v1';
let running = null;

export function ensureSeeded() {
  if (!running) running = seedAll().finally(() => { running = null; });
  return running;
}

async function seedAll() {
  const base = await seedBase();
  const employees = await seedEmployees();
  return base || employees;
}

async function seedBase() {
  if (await getOne('meta', SEED_KEY)) return false;

  // Hash first: transactions must not wait on anything except database requests.
  const users = [];
  for (const s of DEMO_USER_SEEDS) {
    const salt = randomSalt();
    const { password, ...rest } = s;
    users.push({ ...rest, salt, passwordHash: await hashPassword(password, salt), linkedEmployeeID: null, isDemo: true, createdAt: nowISO() });
  }

  return write(['users', 'sites', 'meta', 'auditEvents'], async (tx) => {
    if (await tx.get('meta', SEED_KEY)) return false; // another tab seeded first
    for (const site of SITES) await tx.put('sites', site);
    for (const user of users) await tx.put('users', user);
    await tx.put('meta', { key: SEED_KEY, value: nowISO() });
    await addAudit(tx, { actor: null, action: 'SEED_DEMO_DATA', recordType: 'system', recordID: SEED_KEY,
      reason: 'Demo sites and demo users created.' });
    return true;
  });
}

async function seedEmployees() {
  if (await getOne('meta', EMPLOYEES_KEY)) return false;
  const employees = buildDemoEmployees();

  return write(['employees', 'meta', 'auditEvents'], async (tx) => {
    if (await tx.get('meta', EMPLOYEES_KEY)) return false;
    for (const emp of employees) await tx.put('employees', emp);
    await tx.put('meta', { key: EMPLOYEES_KEY, value: nowISO() });
    await addAudit(tx, { actor: null, action: 'SEED_DEMO_EMPLOYEES', recordType: 'system', recordID: EMPLOYEES_KEY,
      reason: `${employees.length} fictional demo employees created.` });
    return true;
  });
}
