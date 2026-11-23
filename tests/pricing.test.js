import test from 'node:test';
import assert from 'node:assert/strict';
import { pricingConfig, sellingPrice } from '../src/services/pricing.service.js';
const config = overrides => pricingConfig({ RUB_TO_UZS_RATE: '100', DEFAULT_MARKUP_PERCENT: '10', ROUNDING_INCREMENT_UZS: '100', ...overrides });
// Test rate 100 is synthetic, never a runtime default or live FX claim.
test('RUB kopecks -> UZS tiyin, exact markup, upward rounding and quantity total', () => {
  const price = sellingPrice(12345, config(), { key: 'catalog:product:1' }, {}, 3);
  assert.equal(price.unitMinor, 1360000); assert.equal(price.totalMinor, 4080000);
  assert.equal(sellingPrice(1, config({ RUB_TO_UZS_RATE: '0.1', DEFAULT_MARKUP_PERCENT: '0', ROUNDING_INCREMENT_UZS: '0.01' })).unitMinor, 1);
});
test('per-product DB override > env product override > DB global > env global', () => {
  const c = config({ ROUNDING_INCREMENT_UZS: '1', PRODUCT_MARKUP_OVERRIDE: '{"catalog:product:1":"20"}' });
  assert.equal(sellingPrice(100, c, { key: 'catalog:product:1', markupOverride: '30' }, { markup: '40' }).unitMinor, 13000);
  assert.equal(sellingPrice(100, c, { key: 'catalog:product:1' }, { markup: '40' }).unitMinor, 12000);
  assert.equal(sellingPrice(100, c, { key: 'other' }, { markup: '40' }).unitMinor, 14000);
  assert.equal(sellingPrice(100, c, { key: 'other' }).unitMinor, 11000);
});
test('missing/invalid exchange rates, config errors, unsafe amounts and invalid quantities disable price', () => {
  for (const overrides of [{ RUB_TO_UZS_RATE: '' }, { RUB_TO_UZS_RATE: '0' }, { RUB_TO_UZS_RATE: 'NaN' }, { RUB_TO_UZS_RATE: '-1' }, { DEFAULT_MARKUP_PERCENT: '1001' }, { ROUNDING_INCREMENT_UZS: '0.001' }, { PRODUCT_MARKUP_OVERRIDE: '[]' }]) assert.equal(sellingPrice(100, config(overrides)), null);
  assert.equal(sellingPrice(Number.MAX_SAFE_INTEGER, config()), null);
  assert.equal(sellingPrice(100, config(), {}, {}, 0), null);
  assert.equal(sellingPrice(100, config(), {}, {}, 1.5), null);
  assert.equal(sellingPrice(-1, config()), null);
});

test('money formatting preserves the final tiyin near the safe-integer limit', async () => {
  const { formatMoney } = await import('../src/utils/money.js');
  assert.match(formatMoney(Number.MAX_SAFE_INTEGER, 'UZS'), /[.,]91/);
  assert.match(formatMoney(1, 'UZS'), /[.,]01/);
});
