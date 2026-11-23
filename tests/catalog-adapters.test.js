import test from 'node:test';
import assert from 'node:assert/strict';
import { subscriptions, games, steam, gift, telegram, mobile } from './fixtures/universal.js';
import { adaptSubscriptions } from '../src/services/catalog/subscriptions.adapter.js';
import { adaptGamesCatalog, adaptGameDetails } from '../src/services/catalog/games.adapter.js';
import { LightStoreService } from '../src/services/lightstore.service.js';

test('all categories, products, IDs, money, stock and supplier input labels are preserved', () => {
  const s = adaptSubscriptions(subscriptions);
  assert.deepEqual([s.categories.length, s.products.length, s.variants.length], [2, 9, 10]);
  assert.deepEqual(s.categories.map(c => [c.supplierCategoryId, c.title]), [['100', 'AI obunalar'], ['101', 'Design']]);
  assert.equal(s.products[0].supplierProductId, '200');
  assert.equal(s.variants[0].supplierVariantId, '300');
  assert.equal(s.variants[0].supplierPriceMinor, 12345);
  assert.equal(s.variants[0].maxQuantity, 5);
  assert.equal(s.variants[1].stock, 0);
  assert.equal(s.variants[1].inputSchema[0].label, 'Account email');
});
test('missing input metadata disables selection; malformed or partial snapshots fail closed', () => {
  const missing = structuredClone(subscriptions);
  delete missing.categories[0].products[0].variants[0].requires_input;
  assert.equal(adaptSubscriptions(missing).variants[0].inputComplete, false);
  for (const key of ['variant_id','price','in_stock','available']) {
    const data = structuredClone(subscriptions); delete data.categories[0].products[0].variants[0][key];
    assert.throws(() => adaptSubscriptions(data), { code: 'INVALID_SCHEMA' });
  }
  const partial = structuredClone(games); delete partial.mobile_games;
  assert.throws(() => adaptGamesCatalog(partial), { code: 'INVALID_SCHEMA' });
});
test('duplicate identical supplier rows collapse; conflicting duplicates reject entire snapshot', () => {
  const data = structuredClone(subscriptions);
  data.categories[0].products.push(structuredClone(data.categories[0].products[0]));
  assert.equal(adaptSubscriptions(data).products.length, 9);
  data.categories[0].products.at(-1).title = 'conflicting title';
  assert.throws(() => adaptSubscriptions(data), { code: 'INVALID_SCHEMA' });
});
test('separate games adapters preserve gift regions, package/position IDs, fields and unknown stock', () => {
  const s = adaptGamesCatalog({ ...games, future_type: [] });
  assert.equal(s.categories.length, 5); assert.equal(s.products.length, 5);
  assert.deepEqual(s.unsupportedTypes, ['future_type']);
  const get = kind => s.products.find(p => p.kind === kind);
  const sv = adaptGameDetails(steam, get('steam_games')).variants;
  assert.equal(sv.length, 2); assert.equal(sv[0].packageId, 51); assert.equal(sv[0].region, 'RU');
  assert.equal(sv[0].stock, null); assert.equal(sv[0].available, true);
  assert.equal(sv[0].inputSchema[0].name, 'profile');
  const gv = adaptGameDetails(gift, get('gift_cards')).variants[0];
  assert.equal(gv.stock, 10); assert.equal(gv.supplierProductId, '40');
  const tv = adaptGameDetails(telegram, get('telegram')).variants[0];
  assert.equal(tv.positionId, 20); assert.equal(tv.inputSchema[0].name, 'Input1');
  const mv = adaptGameDetails(mobile, get('mobile_games')).variants[0];
  assert.equal(mv.inputComplete, false); assert.deepEqual(mv.serverOptions, [{ value: 'eu', label: 'Europe' }]);
  assert.equal(get('steam_refill').quoteRequired, true);
  const variable = adaptGameDetails({ ...telegram, quantity_field: 'Quantity', quantity_min: 50, quantity_max: 10000 }, get('telegram')).variants[0];
  assert.equal(variable.quoteRequired, true); assert.equal(variable.inputSchema.at(-1).min, 50);
});
test('documented GET paths only, shared cache, rate limit spacing and Retry-After cooldown', async () => {
  let now = 1000, failed = false;
  const calls = [];
  const payloads = { '/catalog': subscriptions, '/games/catalog': games, '/games/game/50': steam, '/games/brand/example-card': gift, '/games/mobile/60': telegram, '/games/mobile/70': mobile };
  const service = new LightStoreService({ baseUrl: 'https://supplier.invalid', apiKey: 'mock', timeoutMs: 100 }, {
    now: () => now, sleep: async ms => { now += ms; },
    fetchImpl: async (url, options) => {
      calls.push({ path: new URL(url).pathname, time: now });
      assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
      assert.equal(options.headers.Authorization, 'Bearer mock');
      if (!failed) { failed = true; return new Response('', { status: 429, headers: { 'retry-after': '60' } }); }
      return new Response(JSON.stringify(payloads[new URL(url).pathname]));
    },
  });
  await assert.rejects(service.getCatalogSnapshot(), { status: 429 });
  await assert.rejects(service.getGamesCatalog(), { status: 429 });
  assert.equal(calls.length, 1); now += 60000;
  const [one, two] = await Promise.all([service.getCatalogSnapshot(), service.getCatalogSnapshot()]);
  assert.deepEqual(one, two); assert.ok(calls[1].time - calls[0].time >= 60000);
  const root = await service.getGamesCatalog();
  for (const product of root.products.filter(p => p.kind !== 'steam_refill')) await service.getGameDetails(product);
  assert.equal(calls.length, 7);
  for (let i = 2; i < calls.length; i++) assert.ok(calls[i].time - calls[i-1].time >= 1100);
  assert.deepEqual(calls.slice(1).map(c => c.path), Object.keys(payloads));
});


test('null nested game rows produce safe schema errors without partial snapshots', () => {
  const products = adaptGamesCatalog(games).products;
  for (const [kind, data] of [
    ['steam_games', { ...steam, game: { ...steam.game, editions: [null] } }],
    ['steam_games', { ...steam, game: { ...steam.game, keys: [null] } }],
    ['gift_cards', { ...gift, products: [null] }],
    ['telegram', { ...telegram, positions: [null] }],
  ]) assert.throws(() => adaptGameDetails(data, products.find(p => p.kind === kind)), { code: 'INVALID_SCHEMA' });
});
