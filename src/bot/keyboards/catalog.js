import { randomBytes } from 'node:crypto';
// Opaque, user-bound, expiring tokens keep Unicode/long supplier IDs out of callback_data.
export class CallbackStore {
  #items = new Map();
  constructor({ now = Date.now, limit = 10000, ttl = 15 * 60 * 1000 } = {}) { this.now = now; this.limit = limit; this.ttl = ttl; }
  put(user, route) {
    if (this.#items.size >= this.limit) this.#items.delete(this.#items.keys().next().value);
    const token = randomBytes(12).toString('base64url');
    this.#items.set(token, { user: String(user), route, expires: this.now() + this.ttl });
    return `cat:${token}`;
  }
  get(user, data) {
    if (!/^cat:[A-Za-z0-9_-]{16}$/.test(data)) return null;
    const item = this.#items.get(data.slice(4));
    if (!item || item.expires <= this.now()) { this.#items.delete(data.slice(4)); return null; }
    return item.user === String(user) ? item.route : null;
  }
}
export const shortText = (value, size = 90) => String(value ?? '').slice(0, size);
export function pageButtons(result, route, button) {
  const row = [];
  if (result.page > 0) row.push(button('⬅️ Oldingi', { ...route, page: result.page - 1 }));
  if (result.page + 1 < result.pages) row.push(button('Keyingi ➡️', { ...route, page: result.page + 1 }));
  return row.length ? [row] : [];
}
