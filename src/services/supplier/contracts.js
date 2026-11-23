import { envelope, requireSchema, integer, text, object } from '../catalog/contracts.js';
export const numericId = value => /^\d{1,15}$/.test(String(value)) && Number.isSafeInteger(Number(value));
export function balanceResponse(data) { envelope(data); requireSchema(integer(data.balance)); return data.balance; }
export function itemResponse(data) {
  envelope(data); const v = data.item;
  requireSchema(v && numericId(v.variant_id) && integer(v.price) && integer(v.in_stock) && typeof v.available === 'boolean' && text(v.delivery));
  return { id: String(v.variant_id), price: v.price, stock: v.in_stock, available: v.available, delivery: v.delivery };
}
export function gameQuoteResponse(data) {
  envelope(data);
  requireSchema(text(data.quote_id) && /^[A-Za-z0-9_-]{1,128}$/.test(data.quote_id) && integer(data.price) && integer(data.balance)
    && data.price_unit === 'kopecks' && Number.isInteger(data.expires_in) && data.expires_in > 0 && data.expires_in <= 180 && typeof data.enabled === 'boolean');
  // details may contain a username. Do not expose or log the upstream object.
  return { id: data.quote_id, price: data.price, balance: data.balance, expiresIn: data.expires_in, enabled: data.enabled };
}
export function orderResponse(data, channel, { creation = false } = {}) {
  envelope(data); const o = channel === 'games' ? data.order : data;
  const states = channel === 'games' ? ['queued','submitting','processing','completed','refunded','review'] : ['completed','paid','pending','declined'];
  requireSchema(object(o) && (channel === 'games' ? typeof o.order_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(o.order_id) : numericId(o.order_id)) && states.includes(o.status));
  requireSchema(o.delivered_data === undefined || typeof o.delivered_data === 'string');
  requireSchema(o.delivery === undefined || Array.isArray(o.delivery) && o.delivery.every(s => typeof s === 'string'));
  if (creation) requireSchema(integer(o.price));
  requireSchema(o.price === undefined || integer(o.price));
  const delivery = o.delivery?.length ? o.delivery : o.delivered_data ? [o.delivered_data] : [];
  requireSchema(delivery.length <= 100 && delivery.reduce((n, s) => n + s.length, 0) <= 64000);
  return { id: String(o.order_id), status: o.status, price: o.price, delivery };
}
export function orderListResponse(data, channel) {
  envelope(data); requireSchema(Array.isArray(data.orders));
  // Lists do not document idempotency/quote identity. Never correlate by price/title/customer guesses.
  return data.orders.map(order => orderResponse(channel === 'games' ? { ok: true, order } : { ok: true, ...order }, channel));
}
export function purchaseRequest(channel, request, identity) {
  requireSchema(typeof identity === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(identity));
  if (channel === 'games') requireSchema(text(request.quote_id) && Object.keys(request).length === 1);
  else requireSchema(numericId(request.variant_id) && Number.isInteger(request.quantity) && request.quantity >= 1 && request.quantity <= 100 && Object.keys(request).every(k => ['variant_id','quantity','user_input'].includes(k)));
  return { path: channel === 'games' ? '/games/order' : '/order', method: 'POST', headers: { 'Idempotency-Key': identity }, body: structuredClone(request) };
}
