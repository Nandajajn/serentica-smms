// Small shared helpers.
export const nowISO = () => new Date().toISOString();

/** Unique id such as "AUD-3F9A1C2B7D". */
export function newID(prefix) {
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  return `${prefix}-${random}`;
}

export function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Salted SHA-256 hash. Good enough to avoid storing plain passwords in the demo
 * database. It is NOT a replacement for server-side password hashing (bcrypt/argon2).
 */
export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
