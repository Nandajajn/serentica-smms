import { ROLE_LABELS } from '../core/constants.js';
import { login, getSession, listDemoAccounts } from '../services/auth-service.js';

if (getSession()) location.replace('dashboard.html');

const form = document.getElementById('login-form');
const idInput = document.getElementById('identifier');
const pwInput = document.getElementById('password');
const errBox = document.getElementById('login-error');

function setFieldError(input, message) {
  document.getElementById(`${input.id}-error`).textContent = message || '';
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function nextPage() {
  const next = new URLSearchParams(location.search).get('next');
  return /^[a-z-]+\.html$/.test(next || '') && next !== 'login.html' ? next : 'dashboard.html';
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  errBox.hidden = true;
  setFieldError(idInput, idInput.value.trim() ? '' : 'Enter your username or email.');
  setFieldError(pwInput, pwInput.value ? '' : 'Enter your password.');
  if (!idInput.value.trim() || !pwInput.value) return;

  const result = login(idInput.value, pwInput.value);
  if (!result.ok) {
    errBox.textContent = result.error;
    errBox.hidden = false;
    pwInput.value = '';
    pwInput.focus();
    return;
  }
  location.replace(nextPage());
});

document.getElementById('toggle-password').addEventListener('click', (e) => {
  const show = pwInput.type === 'password';
  pwInput.type = show ? 'text' : 'password';
  e.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  e.currentTarget.firstElementChild.className = `fa-solid ${show ? 'fa-eye-slash' : 'fa-eye'}`;
});

// Demo account helper: fills the form, the user still presses Sign in.
const list = document.getElementById('demo-accounts');
for (const acc of listDemoAccounts()) {
  const row = document.createElement('div');
  row.className = 'demo-row';
  const label = document.createElement('div');
  label.innerHTML = '<strong></strong><br><code></code>';
  label.querySelector('strong').textContent = ROLE_LABELS[acc.systemRole];
  label.querySelector('code').textContent = `${acc.username} / ${acc.password}`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-sm';
  btn.textContent = 'Use account';
  btn.addEventListener('click', () => {
    idInput.value = acc.username;
    pwInput.value = acc.password;
    setFieldError(idInput, ''); setFieldError(pwInput, '');
    pwInput.focus();
  });
  row.append(label, btn);
  list.append(row);
}
