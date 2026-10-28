// Boot sequence for every protected page. Fails loudly, never silently.
import { requireAuth } from '../services/auth-service.js';
import { renderShell } from '../ui/shell.js';

export function showFatal(message) {
  console.error('[SMMS] ' + message);
  const box = document.createElement('div');
  box.className = 'alert alert-error';
  box.setAttribute('role', 'alert');
  box.style.margin = '24px';
  box.textContent = 'The application could not start: ' + message;
  document.body.prepend(box);
}

/**
 * @param {{pageKey:string, title:string, crumbs?:{label:string,href?:string}[]}} opts
 * @returns {object|null} the session, or null if redirected to login / failed
 */
export function initPage(opts) {
  try {
    const session = requireAuth();
    if (!session) return null;
    renderShell({ session, ...opts });
    return session;
  } catch (err) {
    showFatal(err.message);
    return null;
  }
}
