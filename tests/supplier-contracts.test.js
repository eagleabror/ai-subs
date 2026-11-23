import test from 'node:test';
import assert from 'node:assert/strict';
import { LightStoreService } from '../src/services/lightstore.service.js';
import { buildOffer } from '../src/services/supplier/adapters.js';
import { balanceResponse, gameQuoteResponse, orderResponse, purchaseRequest } from '../src/services/supplier/contracts.js';
import { FulfillmentCipher } from '../src/services/supplier/crypto.js';
import { deliveryMessages } from '../src/services/delivery.service.js';
import { MockSupplier } from './fixtures/mock-supplier.js';
test('separate adapters produce only documented standard/mobile/refill/gift/key/voucher fields', async () => {
  const s = new MockSupplier(), catalog = await s.getCatalogSnapshot(), games = await s.getGamesCatalog();
  const p = catalog.products[0], v = catalog.variants[0];
  assert.deepEqual(buildOffer(p, v, 2, {}).request, { variant_id: 300, quantity: 2 });
  const cases = [ ['steam_games', 0, { profile: 'https://steamcommunity.com/id/example' }, { kind: 'gift', app_id: 50, pkg: 51, region: 'RU', profile: 'https://steamcommunity.com/id/example' }],
    ['steam_games', 1, {}, { kind: 'key', root: 40, var: 41 }], ['gift_cards', 0, {}, { kind: 'voucher', root: 40, var: 41, qty: 1 }],
    ['telegram', 0, { Input1: 'mock_username' }, { kind: 'mobile', gid: 60, pos: 20, fields: { Input1: 'mock_username' } }],
    ['mobile_games', 0, { Input1: 'mock_id', Input2: 'EU' }, { kind: 'mobile', gid: 70, pos: 20, fields: { Input1: 'mock_id', Input2: 'EU' } }] ];
  for (const [kind, index, input, expected] of cases) { const product = games.products.find(p => p.kind === kind), variant = (await s.getGameDetails(product)).variants[index]; assert.deepEqual(buildOffer(product, variant, 1, input).request, expected); }
  const refill = games.products.find(p => p.kind === 'steam_refill');
  assert.deepEqual(buildOffer(refill, null, 1, { login: 'mock_login', cur: 'RUB', amount: '500' }).request, { kind: 'refill', login: 'mock_login', cur: 'RUB', amount: 500 });
  assert.throws(() => buildOffer(refill, null, 1, { login: 'x', cur: 'USD', amount: '1' }), { code: 'UNSUPPORTED_REGION' });
});
test('missing fields, unsupported server mapping, secrets, forged fields and quantities fail closed', async () => {
  const s = new MockSupplier(), p = (await s.getGamesCatalog()).products.find(p => p.kind === 'telegram'), v = (await s.getGameDetails(p)).variants[0];
  assert.throws(() => buildOffer(p, v, 1, {}), { code: 'MISSING_INPUT' });
  assert.throws(() => buildOffer(p, v, 1, { Input1: 'u', price: '1' }), { code: 'INVALID_INPUT' });
  assert.throws(() => buildOffer(p, v, 2, { Input1: 'u' }), { code: 'QUANTITY_UNDOCUMENTED' });
  assert.throws(() => buildOffer(p, { ...v, serverOptions: [{ value: 'EU' }] }, 1, {}), { code: 'INPUT_MAPPING_UNDOCUMENTED' });
  assert.throws(() => buildOffer(p, { ...v, inputSchema: [{ name: 'password', label: 'Password', required: true }] }, 1, {}), { code: 'SENSITIVE_INPUT_UNSUPPORTED' });
  assert.throws(() => buildOffer({ source: 'games', kind: 'unknown' }, v, 1, {}), { code: 'UNSUPPORTED_PRODUCT' });
});
test('documented response schemas reject malformed money, expiration and statuses without inventing fields', () => {
  const q = { ok: true, quote_id: 'q1', price: 1200, balance: 5000, price_unit: 'kopecks', expires_in: 180, enabled: true };
  assert.equal(gameQuoteResponse(q).price, 1200);
  for (const patch of [{ price: 1.1 }, { expires_in: 0 }, { expires_in: 181 }, { enabled: null }, { balance: -1 }]) assert.throws(() => gameQuoteResponse({ ...q, ...patch }));
  assert.throws(() => balanceResponse({ ok: true, balance_rub: 500 }));
  assert.throws(() => orderResponse({ ok: true, order: { order_id: 'abc', status: 'invented' } }, 'games'));
  assert.deepEqual(orderResponse({ ok: true, order_id: 1, status: 'paid', delivered_data: '' }, 'standard'), { id: '1', status: 'paid', price: undefined, delivery: [] });
  assert.equal(purchaseRequest('games', { quote_id: 'q1' }, 'ais:test').headers['Idempotency-Key'], 'ais:test');
  assert.throws(() => purchaseRequest('games', { quote_id: 'q1', price: 1 }, 'ais:test'));
});
test('live transport allows POST games quote but unconditionally blocks purchase even with injected fetch', async () => {
  const calls = []; let now = 0;
  const s = new LightStoreService({ baseUrl: 'https://example.invalid/api/v1', apiKey: 'mock-api-key', timeoutMs: 1000 }, { now: () => now, sleep: async ms => { now += ms; }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    const data = url.endsWith('/balance') ? { ok: true, balance: 1234 } : { ok: true, quote_id: 'q1', price: 1200, balance: 5000, price_unit: 'kopecks', expires_in: 180, enabled: true };
    return new Response(JSON.stringify(data));
  } });
  await s.quoteGame({ kind: 'key', root: 1, var: 2 }); await s.getBalance();
  assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.headers.Authorization, 'Bearer mock-api-key'); assert.equal(calls[1].options.method, 'GET'); assert.ok(now >= 1100);
  await assert.rejects(s.createSupplierOrder('games', purchaseRequest('games', { quote_id: 'q1' }, 'ais:1')), { code: 'REAL_PURCHASE_DISABLED' }); assert.equal(calls.length, 2);
});
test('HTTP failures and quote body timeouts expose safe codes, never supplier bodies', async () => {
  for (const status of [401,402,403,404,409,429,503]) {
    const s = new LightStoreService({ baseUrl: 'https://example.invalid', apiKey: 'secret', timeoutMs: 100 }, { fetchImpl: async () => new Response('SECRET-DELIVERY-CODE', { status, headers: { 'retry-after': '1' } }) });
    await assert.rejects(s.quoteGame({ kind: 'key' }), e => e.status === status && !JSON.stringify(e).includes('SECRET-DELIVERY'));
  }
  const s = new LightStoreService({ baseUrl: 'https://example.invalid', apiKey: 'secret', timeoutMs: 100 }, { fetchImpl: async (_url, { signal }) => ({ ok: true, json: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('secret')))) }) });
  await assert.rejects(s.quoteGame({ kind: 'key' }), { code: 'TIMEOUT' });
});
test('AES-GCM protects plaintext and context; typed delivery never assumes every result is a URL', () => {
  const cipher = new FulfillmentCipher(Buffer.alloc(32, 7).toString('base64'));
  const sealed = cipher.seal({ code: 'SENSITIVE-MOCK' }, 'order1:delivery');
  assert.ok(!sealed.includes('SENSITIVE-MOCK')); assert.deepEqual(cipher.open(sealed, 'order1:delivery'), { code: 'SENSITIVE-MOCK' });
  assert.throws(() => cipher.open(sealed, 'order2:delivery')); assert.throws(() => new FulfillmentCipher().seal({}, 'a'));
  for (const kind of ['license_key','gift_card','instructions','recharge','manual']) assert.match(deliveryMessages({ kind, values: ['SYNTHETIC'] }, { simulation: true })[0], /MOCK/);
  assert.match(deliveryMessages({ kind: 'activation_link', values: ['https://example.invalid/mock'] })[0], /Aktivatsiya/);
  assert.throws(() => deliveryMessages({ kind: 'activation_link', values: ['javascript:alert(1)'] }));
});
