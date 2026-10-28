// Audit trail. Every change to shared data records an event IN THE SAME transaction
// as the change itself, so a change can never be saved without its audit record.
import { getAll } from '../core/store.js';
import { newID, nowISO } from '../core/utils.js';
import { ACTIONS, assertCan } from '../core/access-control.js';

export function makeAuditEvent({ actor, action, recordType, recordID, before = null, after = null, reason = '' }) {
  return {
    eventID: newID('AUD'),
    timestamp: nowISO(),
    actorUserID: actor?.userID ?? null,
    actorRole: actor?.systemRole ?? 'NONE',
    action,
    recordType,
    recordID: recordID ?? null,
    before,
    after,
    reason,
  };
}

/** Call inside store.write(): await addAudit(tx, { actor, action, recordType, recordID, ... }) */
export async function addAudit(tx, details) {
  const event = makeAuditEvent(details);
  await tx.put('auditEvents', event);
  return event;
}

/** Newest first. Needs permission to view the audit trail. */
export async function getAuditHistory(user) {
  assertCan(user, ACTIONS.VIEW_AUDIT);
  const events = await getAll('auditEvents');
  return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
