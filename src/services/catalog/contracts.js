import { createHash } from 'node:crypto';
import { LightStoreError } from './error.js';
export function requireSchema(value) { if (!value) throw new LightStoreError('INVALID_SCHEMA'); }
export const integer = (n) => Number.isSafeInteger(n) && n >= 0;
export const text = (s) => typeof s === 'string' && s.trim().length > 0;
export const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const idFor = (key) => createHash('sha256').update(key).digest('hex').slice(0, 24);
export const entity = (key, fields) => ({ _id: idFor(key), key, ...fields });
export function envelope(data) {
  if (data?.ok === false) throw new LightStoreError('API_ERROR');
  requireSchema(data?.ok === true);
}
export function uniqueEntities(items) {
  const map = new Map();
  for (const item of items) {
    if (map.has(item.key)) requireSchema(JSON.stringify(map.get(item.key)) === JSON.stringify(item));
    map.set(item.key, item);
  }
  return [...map.values()];
}
export function snapshot(categories, products, variants, extra = {}) {
  return { categories: uniqueEntities(categories), products: uniqueEntities(products), variants: uniqueEntities(variants), ...extra };
}
export function variant(key, product, fields) {
  return entity(key, { source: product.source, product: product._id, category: product.category,
    supplierProductId: product.supplierProductId, currency: 'RUB', stock: null, available: null,
    maxQuantity: null, inputSchema: [], quoteRequired: false, ...fields });
}
