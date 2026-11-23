import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LightStoreService, parseCatalog, findGeminiSixMonthOffers } from '../src/services/lightstore.service.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/catalog.json', import.meta.url)));
const config = { apiKey: 'mock-key', baseUrl: 'https://supplier.invalid/api/v1', timeoutMs: 100 };
const response = (data = fixture) => new Response(JSON.stringify(data));

test('Bearer + only GET /catalog, correct IDs, integer prices and zero stock; cache coalesces', async () => {
  const calls = [];
  const service = new LightStoreService(config, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response();
  } });
  const [first, second] = await Promise.all([service.getCatalog(), service.getCatalog()]);
  assert.deepEqual(first, second);
  const offers = await service.findGeminiSixMonthOffers();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://supplier.invalid/api/v1/catalog');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer mock-key');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.body, undefined);
  assert.deepEqual(offers.map((x) => [x.productId, x.variantId, x.supplierPriceMinor, x.stock]), [[9002, 9003, 12345, 7], [9002, 9005, 10000, 0]]);
  first[0].variants[0].stock = 999;
  assert.equal((await service.getCatalog())[0].variants[0].stock, 7);
});

for (const status of [401, 403, 404, 429, 500, 503]) {
  test(`HTTP ${status} returns safe status, never supplier body or API key`, async () => {
    const service = new LightStoreService(config, { fetchImpl: async () => new Response('sensitive supplier detail', { status }) });
    await assert.rejects(service.getCatalog(), (error) => error.code === 'HTTP_ERROR' && error.status === status && !/sensitive|mock-key/.test(error.message));
  });
}

test('invalid JSON, network and API-level errors are sanitized', async () => {
  for (const [fetchImpl, code] of [
    [async () => new Response('not json'), 'INVALID_JSON'],
    [async () => { throw new Error('secret mock-key'); }, 'NETWORK_ERROR'],
    [async () => response({ ok: false, error: 'secret mock-key' }), 'API_ERROR'],
  ]) {
    await assert.rejects(new LightStoreService(config, { fetchImpl }).getCatalog(), { code, message: `Light Store: ${code}` });
  }
});

for (const phase of ['headers', 'body']) {
  test(`timeout covers ${phase}`, async () => {
    const fetchImpl = async (_url, { signal }) => {
      const pending = () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      if (phase === 'headers') return pending();
      return { ok: true, json: pending };
    };
    await assert.rejects(new LightStoreService(config, { fetchImpl }).getCatalog(), { code: 'TIMEOUT' });
  });
}

test('failed requests are not cached', async () => {
  let count = 0;
  const service = new LightStoreService(config, { fetchImpl: async () => ++count === 1 ? new Response('', { status: 503 }) : response() });
  await assert.rejects(service.getCatalog());
  assert.equal((await service.getCatalog()).length, 1);
  assert.equal(count, 2);
});

test('rejects undocumented envelopes and missing/invalid IDs, prices or stock', () => {
  for (const bad of [null, [], {}, { ok: true, data: [] }, { ok: true, currency: 'USD', categories: [] }]) {
    assert.throws(() => parseCatalog(bad), { code: 'INVALID_SCHEMA' });
  }
  for (const [key, value] of [['variant_id', '9003'], ['price', -1], ['price', 1.5], ['price', Number.MAX_SAFE_INTEGER + 1], ['in_stock', null], ['in_stock', true], ['available', undefined]]) {
    const data = structuredClone(fixture);
    data.categories[0].products[0].variants[0][key] = value;
    assert.throws(() => parseCatalog(data), { code: 'INVALID_SCHEMA' });
  }
  assert.deepEqual(parseCatalog({ ok: true, currency: 'RUB', categories: [] }), []);
});

test('Gemini AI Plus duration matching avoids wrong plans and 16/36-month variants', () => {
  for (const duration of ['6 months', '6-month', '6 мес.', '6 месяцев', '6 oy', '6 oylik', '6m']) {
    const products = [{ productId: 1, title: 'Gemini', variants: [{ title: `AI Plus ${duration}` }] }];
    assert.equal(findGeminiSixMonthOffers(products).length, 1, duration);
  }
  for (const title of ['Gemini AI Plus 16 months', 'Gemini AI Plus 36 месяцев', 'Gemini AI Pro 6 months', 'Other AI Plus 6 months', 'Gemini AI Plus 6 minutes']) {
    assert.equal(findGeminiSixMonthOffers([{ title, variants: [{ title: 'test' }] }]).length, 0, title);
  }
});
