import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCbu, rateAcceptable } from '../src/services/exchange-rate.service.js';
import { fxConfig } from '../src/config/fx.js';
import { calculatePrice } from '../src/services/pricing.service.js';
const now = new Date('2026-11-23T10:00:00Z');
const fixture = [{ Ccy: 'USD', Rate: '12000.00', Nominal: '1', Date: '20.11.2026' }, { Ccy: 'RUB', Rate: '14656.00', Nominal: '100', Date: '20.11.2026' }];
test('official CBU RUB fields are parsed, nominal division uses an exact fraction', () => {
  const rate = parseCbu(fixture, now);
  assert.deepEqual([rate.ccy, rate.rate, rate.nominal, rate.numerator, rate.denominator, rate.effectiveDate], ['RUB','14656.00','100','3664','25','2026-11-20']);
  const price = calculatePrice({ supplierPriceMinor: 10000, quantity: 2, rate, markup: '30', buffer: '0', rounding: '1000' });
  assert.equal(price.convertedCostMinor, 1465600); assert.equal(price.unitMinor, 2000000); assert.equal(price.totalMinor, 4000000);
});
test('repeating nominal fractions do not lose precision in settlement; FX cost buffer precedes markup', () => {
  const rate = parseCbu([{ Ccy: 'RUB', Rate: '1', Nominal: '3', Date: '23.11.2026' }], now);
  const price = calculatePrice({ supplierPriceMinor: 3, rate, markup: '0', buffer: '0', rounding: '0.01' });
  assert.equal(price.unitMinor, 1); assert.deepEqual(price.convertedCostExact, { numerator: '3', denominator: '3' });
  const buffered = calculatePrice({ supplierPriceMinor: 10000, rate: { numerator: '100', denominator: '1' }, markup: '20', buffer: '10', rounding: '1' });
  assert.equal(buffered.bufferedCostMinor, 1100000); assert.equal(buffered.unitMinor, 1320000);
});
test('zero/null rates, bad nominal/date/currency, duplicate and future rates are rejected', () => {
  for (const patch of [{ Rate: '0' }, { Rate: null }, { Rate: 146.56 }, { Rate: '1e2' }, { Nominal: '0' }, { Nominal: '0.5' }, { Date: '31.02.2026' }, { Date: '2026-11-23' }, { Ccy: 'rub' }, { Date: '24.11.2026' }]) assert.throws(() => parseCbu([{ ...fixture[1], ...patch }], now));
  assert.throws(() => parseCbu([fixture[1], fixture[1]], now)); assert.throws(() => parseCbu({ data: fixture }, now));
});
test('weekend/holiday effective dates remain valid; stale effective dates or fetches disable checkout', () => {
  const config = fxConfig({ FX_RATE_MODE: 'auto' }), rate = parseCbu(fixture, now);
  assert.equal(rateAcceptable(rate, config, now), true);
  assert.equal(rateAcceptable({ ...rate, effectiveDate: '2026-11-10' }, config, now), false);
  assert.equal(rateAcceptable({ ...rate, fetchedAt: new Date('2026-11-20T01:00:00Z') }, config, now), false);
  assert.equal(rateAcceptable({ ...rate, rate: '0' }, config, now), false);
  assert.equal(rateAcceptable({ ...rate, denominator: '0' }, config, now), false);
  assert.equal(rateAcceptable({ ...rate, fetchedAt: new Date('2026-11-24') }, config, now), false);
});
test('auto needs no env rate; legacy explicit rate remains supported; unsafe config fails closed', () => {
  assert.equal(fxConfig({}).mode, 'auto'); assert.equal(fxConfig({ RUB_TO_UZS_RATE: '100' }).mode, 'legacy');
  assert.equal(fxConfig({ FX_RATE_MODE: 'auto', RUB_TO_UZS_RATE: '100' }).mode, 'auto');
  for (const env of [{ FX_CBU_URL: 'https://untrusted.invalid/' }, { FX_MAX_AGE_DAYS: '0' }, { FX_REFRESH_INTERVAL_MINUTES: '-1' }, { FX_MAX_FETCH_AGE_HOURS: '0' }, { FX_RATE_MODE: 'bad' }]) assert.ok(fxConfig(env).errors.length);
});
