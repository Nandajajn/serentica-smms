// The ONLY file that touches IndexedDB. Every page and service reads and writes
// shared data through this module, so there is one source of truth.
// Changes are announced on the event bus (same tab) and on a BroadcastChannel
// (other tabs of the same browser). This is NOT multi-user sync: another person on
// another computer has their own separate browser database.
import { emit, on } from './event-bus.js';

const DB_NAME = 'serentica_smm_v1';
const DB_VERSION = 1;

// store name -> key field
export const STORES = Object.freeze({
  users: 'userID',
  employees: 'employeeID',
  sites: 'siteCode',
  assignments: 'assignmentID',
  deploymentRequests: 'requestID',
  recallRequests: 'requestID',
  decisions: 'decisionID',
  changeRequests: 'changeID',
  importBatches: 'batchID',
  uploadedFiles: 'fileID',
  notifications: 'notificationID',
  auditEvents: 'eventID',
  meta: 'key',
});

let dbPromise = null;

export function openStore() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('This browser does not support IndexedDB, which the application needs.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const [name, keyPath] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the database.'));
      request.onblocked = () => reject(new Error('Database is blocked by another tab. Close other tabs of this site and reload.'));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

const asPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

function assertStore(name) {
  if (!Object.prototype.hasOwnProperty.call(STORES, name)) throw new Error(`Unknown data store: ${name}`);
}

/* ---------- reads ---------- */
export async function getAll(storeName) {
  assertStore(storeName);
  const db = await openStore();
  return asPromise(db.transaction(storeName).objectStore(storeName).getAll());
}

export async function getOne(storeName, key) {
  assertStore(storeName);
  const db = await openStore();
  const record = await asPromise(db.transaction(storeName).objectStore(storeName).get(key));
  return record ?? null;
}

/* ---------- atomic writes ---------- */
/**
 * Run several reads/writes as ONE transaction. If `work` throws, nothing is saved.
 * Inside `work`, only await the tx.* calls (not timers or network), or the
 * browser will close the transaction early.
 *
 * await write(['employees','auditEvents'], async (tx) => {
 *   const emp = await tx.get('employees', 'E1');
 *   await tx.put('employees', { ...emp, status: 'Active' });
 *   await tx.put('auditEvents', {...});
 * });
 */
export async function write(storeNames, work) {
  const names = [].concat(storeNames);
  names.forEach(assertStore);
  const db = await openStore();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    const touched = new Set();
    let result;

    const tools = {
      get: (s, key) => asPromise(tx.objectStore(s).get(key)).then((r) => r ?? null),
      getAll: (s) => asPromise(tx.objectStore(s).getAll()),
      put: (s, record) => { touched.add(s); return asPromise(tx.objectStore(s).put(record)); },
      delete: (s, key) => { touched.add(s); return asPromise(tx.objectStore(s).delete(key)); },
      clear: (s) => { touched.add(s); return asPromise(tx.objectStore(s).clear()); },
    };

    tx.oncomplete = () => { announce([...touched]); resolve(result); };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('The change was cancelled and nothing was saved.'));

    Promise.resolve()
      .then(() => work(tools))
      .then((value) => { result = value; })
      .catch((err) => {
        try { tx.abort(); } catch { /* already finished */ }
        reject(err);
      });
  });
}

/* ---------- meta helpers ---------- */
export async function getMeta(key) {
  const row = await getOne('meta', key);
  return row ? row.value : null;
}
export function setMeta(key, value) {
  return write('meta', (tx) => tx.put('meta', { key, value }));
}

/* ---------- change notifications ---------- */
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('serentica-smm') : null;

function announce(stores, fromOtherTab = false) {
  if (!stores.length) return;
  for (const s of stores) emit(`change:${s}`, { store: s, fromOtherTab });
  emit('change', { stores, fromOtherTab });
  if (!fromOtherTab && channel) channel.postMessage({ stores });
}
if (channel) {
  channel.onmessage = (e) => {
    if (e.data && Array.isArray(e.data.stores)) announce(e.data.stores, true);
  };
}

/** Call `handler` whenever the named store changes (this tab or another tab). */
export function subscribe(storeName, handler) {
  assertStore(storeName);
  return on(`change:${storeName}`, handler);
}
/** Call `handler` after any change. */
export function subscribeAll(handler) {
  return on('change', handler);
}
