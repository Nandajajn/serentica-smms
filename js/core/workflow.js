// The allowed steps of a deployment or recall request. Every status change goes through nextStatus(),
// so an impossible step (approving twice, confirming something not approved) is refused in one place.
export const TERMINAL_STATUSES = Object.freeze(['Rejected', 'Confirmed', 'Cancelled']);
// While a request is in one of these, the employee cannot be part of another request.
export const OPEN_STATUSES = Object.freeze(['Submitted', 'Under Review', 'Returned', 'Approved']);

export const TRANSITIONS = Object.freeze({
  submit:      { from: ['Draft', 'Returned'], to: 'Submitted' },
  startReview: { from: ['Submitted'], to: 'Under Review' },
  approve:     { from: ['Submitted', 'Under Review'], to: 'Approved' },
  reject:      { from: ['Submitted', 'Under Review'], to: 'Rejected' },
  return:      { from: ['Submitted', 'Under Review'], to: 'Returned' },
  confirm:     { from: ['Approved'], to: 'Confirmed' },
  cancel:      { from: ['Draft', 'Submitted', 'Under Review', 'Returned', 'Approved'], to: 'Cancelled' },
});

/** Plain-language labels. "Approved" is NOT "Confirmed": nothing has changed for the employee yet. */
export const STATUS_LABELS = Object.freeze({
  Draft: 'Draft', Submitted: 'Submitted', 'Under Review': 'Under review', Returned: 'Sent back to Lead',
  Approved: 'Approved - awaiting confirmation', Rejected: 'Rejected', Confirmed: 'Confirmed', Cancelled: 'Cancelled',
});

const VERBS = { submit: 'submitted', startReview: 'put under review', approve: 'approved', reject: 'rejected', return: 'sent back', confirm: 'confirmed', cancel: 'cancelled' };

export function nextStatus(action, status) {
  const rule = TRANSITIONS[action];
  if (!rule) throw new Error(`Unknown action: ${action}`);
  if (!rule.from.includes(status)) throw new Error(`A request that is "${status}" cannot be ${VERBS[action]}.`);
  return rule.to;
}
