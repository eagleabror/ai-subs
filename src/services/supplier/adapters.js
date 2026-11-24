import { LightStoreError } from '../catalog/error.js';
import { numericId } from './contracts.js';
const fail = code => { throw new LightStoreError(code); };
const id = value => { if (!numericId(value)) fail('UNSUPPORTED_PRODUCT'); return Number(value); };
export function adapterFor(product, variant) {
  if (product.source === 'catalog') return { channel: 'standard', type: 'subscription', delivery: 'instructions' };
  if (product.kind === 'steam_refill') return { channel: 'games', type: 'refill', delivery: 'recharge' };
  if (product.kind === 'steam_games' && variant?.packageId != null) return { channel: 'games', type: 'gift', delivery: 'instructions' };
  if (product.kind === 'steam_games' && variant) return { channel: 'games', type: 'key', delivery: 'license_key' };
  if (product.kind === 'gift_cards') return { channel: 'games', type: 'voucher', delivery: 'gift_card' };
  if (['telegram','mobile_games'].includes(product.kind)) return { channel: 'games', type: 'mobile', delivery: 'recharge' };
  fail('UNSUPPORTED_PRODUCT');
}
export function fieldsFor(product, variant) {
  adapterFor(product, variant);
  if (variant && (!variant.inputComplete || variant.serverOptions?.length)) fail('INPUT_MAPPING_UNDOCUMENTED');
  const fields = product.kind === 'steam_refill' ? product.inputSchema : variant?.inputSchema;
  if (!Array.isArray(fields) || fields.length > 12) fail('INPUT_MAPPING_UNDOCUMENTED');
  for (const f of fields) if (!f.name || /password|passwd|secret|token|парол|parol/i.test(`${f.name} ${f.label}`)) fail('SENSITIVE_INPUT_UNSUPPORTED');
  return fields;
}
export function validateInputs(fields, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(k => !fields.some(f => f.name === k))) fail('INVALID_INPUT');
  const result = {};
  for (const f of fields) {
    const value = values[f.name];
    if (value == null || value === '') { if (f.required) fail('MISSING_INPUT'); else continue; }
    if (typeof value !== 'string' || value.length > 500 || /[\x00-\x1f\x7f]/.test(value)) fail('INVALID_INPUT');
    if (f.type === 'select' && !f.options.includes(value)) fail('UNSUPPORTED_REGION');
    if (f.type === 'number' && (!/^\d{1,9}$/.test(value) || Number(value) <= 0 || f.min != null && Number(value) < f.min || f.max != null && Number(value) > f.max)) fail('INVALID_INPUT');
    if (f.type === 'url') { let url; try { url = new URL(value); } catch { fail('INVALID_INPUT'); }
      if (url.protocol !== 'https:' || url.hostname !== 'steamcommunity.com' || url.username || url.password || !/^\/(id|profiles)\/[^/]+\/?$/.test(url.pathname) || url.search || url.hash) fail('INVALID_INPUT'); }
    Object.defineProperty(result, f.name, { value: value.trim(), enumerable: true });
    if (!result[f.name]) fail('MISSING_INPUT');
  }
  return result;
}
export function buildOffer(product, variant, quantity, values) {
  const adapter = adapterFor(product, variant), fields = fieldsFor(product, variant), inputs = validateInputs(fields, values);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) fail('INVALID_QUANTITY');
  if (variant?.available === false || variant?.stock === 0 || variant?.stock != null && quantity > variant.stock || variant?.maxQuantity != null && quantity > variant.maxQuantity) fail('OUT_OF_STOCK');
  let request;
  switch (adapter.type) {
    case 'subscription': request = { variant_id: id(variant.supplierVariantId), quantity, ...(inputs.user_input ? { user_input: inputs.user_input } : {}) }; break;
    case 'voucher': request = { kind: 'voucher', root: id(variant.supplierProductId), var: id(variant.supplierVariantId), qty: quantity }; break;
    case 'key': request = { kind: 'key', root: id(variant.supplierProductId), var: id(variant.supplierVariantId) }; break;
    case 'gift': if (!variant.region) fail('UNSUPPORTED_REGION'); request = { kind: 'gift', app_id: id(product.supplierProductId), pkg: id(variant.packageId), region: variant.region, profile: inputs.profile }; break;
    case 'mobile': request = { kind: 'mobile', gid: id(product.supplierProductId), pos: id(variant.positionId), fields: inputs }; break;
    case 'refill': request = { kind: 'refill', login: inputs.login, cur: inputs.cur, amount: Number(inputs.amount) }; break;
    default: fail('UNSUPPORTED_PRODUCT');
  }
  if (!['subscription','voucher'].includes(adapter.type) && quantity !== 1) fail('QUANTITY_UNDOCUMENTED');
  return { ...adapter, fields, inputs, request, quantity, region: variant?.region || inputs.cur || null };
}
