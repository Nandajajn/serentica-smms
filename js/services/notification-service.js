// SIMULATED notifications: stored in the database and shown in the app. No email or message is sent.
import { getAll } from '../core/store.js';
import { ACTIONS, assertCan } from '../core/access-control.js';
import { ROLES } from '../core/constants.js';
import { newID, nowISO } from '../core/utils.js';

/** Call inside store.write() so the notification is saved together with the change that caused it. */
export async function addNotification(tx, { type, message, targetRole = null, targetUserIDs = [], relatedRecordType, relatedRecordID }) {
  const note = {
    notificationID: newID('NTF'), type, message, targetRole, targetUserIDs, relatedRecordType, relatedRecordID,
    createdAt: nowISO(), isRead: false, isSimulated: true,
  };
  await tx.put('notifications', note);
  return note;
}

export async function getNotificationsFor(user) {
  assertCan(user, ACTIONS.VIEW_PAGES);
  const all = await getAll('notifications');
  const mine = user.systemRole === ROLES.ADMIN ? all
    : all.filter((n) => n.targetRole === user.systemRole || (n.targetUserIDs || []).includes(user.userID));
  return mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
