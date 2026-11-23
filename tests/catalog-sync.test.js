import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { CatalogCategory as Category, CatalogProduct as Product, CatalogVariant as Variant, CatalogSyncState as State, PricingSettings } from '../src/models/Catalog.js';
import { CatalogService } from '../src/services/catalog.service.js';
import { pricingConfig } from '../src/services/pricing.service.js';
import { adaptSubscriptions } from '../src/services/catalog/subscriptions.adapter.js';
import { adaptGamesCatalog, adaptGameDetails } from '../src/services/catalog/games.adapter.js';
import { LightStoreError } from '../src/services/lightstore.service.js';
import { subscriptions, games, steam, gift, telegram, mobile } from './fixtures/universal.js';
let mongo;
const models = [Category, Product, Variant, State, PricingSettings];
before(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.24', downloadDir: '/tmp/ai-subs-test-mongodb' }, replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri('phase2_test'));
  await Promise.all(models.map(m => m.init()));
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => { await Promise.all(models.map(m => m.deleteMany({}))); });
function harness() {
  const state = { catalog: structuredClone(subscriptions), games: structuredClone(games), failure: false, gameFailure: false };
  const supplier = {
    getCatalogSnapshot: async () => { if (state.failure) throw new LightStoreError('HTTP_ERROR', 503); return adaptSubscriptions(state.catalog); },
    getGamesCatalog: async () => { if (state.gameFailure) throw new LightStoreError('HTTP_ERROR', 403); return adaptGamesCatalog(state.games); },
    getGameDetails: async p => adaptGameDetails({ steam_games: steam, gift_cards: gift, telegram, mobile_games: mobile }[p.kind], p),
  };
  const pricing = pricingConfig({ RUB_TO_UZS_RATE: '100', DEFAULT_MARKUP_PERCENT: '0', ROUNDING_INCREMENT_UZS: '1' });
  return { state, supplier, service: new CatalogService(supplier, pricing), pricing };
}
test('atomic sync, unique supplier IDs and concurrent synchronization never duplicate records', async () => {
  const { service, supplier, pricing } = harness();
  await Promise.all([service.sync(), service.sync(), new CatalogService(supplier, pricing).sync()]);
  assert.equal(await Category.countDocuments(), 7);
  assert.equal(await Product.countDocuments(), 14);
  assert.equal(await Variant.countDocuments(), 10);
  await service.sync();
  assert.equal(await Product.countDocuments(), 14);
  await assert.rejects(Product.create({ _id: 'different-id', key: 'catalog:product:200', source: 'catalog', title: 'Duplicate', category: 'x', kind: 'catalog' }), { code: 11000 });
});
test('supplier price/stock update, removal/reappearance, additions and local admin setting retention', async () => {
  const { service, state } = harness(); await service.sync();
  assert.equal(await service.setMarkup('25', 'catalog:product:200'), true);
  assert.equal(await service.setProductEnabled('catalog:product:200', false), true);
  const first = state.catalog.categories[0].products[0].variants[0];
  first.price = 500; first.in_stock = 0; first.available = false;
  const removed = state.catalog.categories[1].products.pop();
  state.catalog.categories[0].products.push({ product_id: 999, title: 'New product', variants: [] });
  await service.sync();
  const product = await Product.findOne({ key: 'catalog:product:200' }).lean();
  assert.equal(product.hidden, true); assert.equal(product.enabled, false); assert.equal(product.markupOverride, '25');
  const v = await Variant.findOne({ key: 'catalog:variant:300' }).lean();
  assert.equal(v.supplierPriceMinor, 500); assert.equal(v.stock, 0); assert.equal(v.available, false);
  assert.equal(v.sellingPriceMinor, 62500);
  assert.equal((await Product.findOne({ key: 'catalog:product:220' })).present, false);
  assert.equal((await Variant.findOne({ key: 'catalog:variant:320' })).present, false);
  assert.equal((await Product.findOne({ key: 'catalog:product:999' })).present, true);
  state.catalog.categories[1].products.push(removed); await service.sync();
  assert.equal((await Product.findOne({ key: 'catalog:product:220' })).present, true);
});
test('source failure or malformed snapshot preserves existing data; independent source succeeds', async () => {
  const { service, state } = harness(); await service.sync();
  state.failure = true;
  const results = await service.sync();
  assert.equal(results[0].error, 'HTTP_ERROR_503'); assert.equal(results[1].ok, true);
  assert.equal(await Product.countDocuments({ source: 'catalog', present: true }), 9);
  assert.equal(await Variant.countDocuments({ present: true }), 10);
  assert.equal((await State.findById('catalog')).errorCode, 'HTTP_ERROR_503');
  state.failure = false; delete state.catalog.categories[0].products[0].variants[0].price;
  assert.equal((await service.sync())[0].error, 'INVALID_SCHEMA');
  assert.equal(await Variant.countDocuments({ present: true }), 10);
});
test('transaction rolls back earlier writes when a later bulk write fails', async () => {
  const { service, supplier, state } = harness(); await service.sync();
  state.catalog.categories[0].title = 'must not persist';
  const original = supplier.getCatalogSnapshot;
  supplier.getCatalogSnapshot = async () => {
    const s = await original();
    // Force a real unique-key failure after categories have been updated in the transaction.
    s.products[0]._id = 'different-id';
    return s;
  };
  await assert.rejects(service.syncSource('catalog'));
  assert.equal((await Category.findOne({ key: 'catalog:category:100' })).title, 'AI obunalar');
});
test('pagination/search are deterministic, literal and exclude hidden or disabled products', async () => {
  const { service } = harness(); await service.sync();
  const category = await Category.findOne({ key: 'catalog:category:100' });
  const first = await service.products(category._id, 0), second = await service.products(category._id, 1);
  assert.equal(first.items.length, 6); assert.equal(second.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map(p => p._id)).size, 8);
  assert.equal((await service.products(category._id, 999)).page, 1);
  assert.equal((await service.search('.*')).total, 0);
  assert.equal((await service.search('[plus]')).total, 1);
  await service.setProductEnabled('catalog:product:200', false);
  assert.equal((await service.search('[plus]')).total, 0);
  assert.equal((await service.adminProducts('catalog:product:200')).length, 1);
  await service.setProductEnabled('catalog:product:200', true);
  assert.equal((await service.search('[plus]')).total, 1);
});
test('games details persist on demand; missing stock stays unknown; removed products invalidate callbacks', async () => {
  const { service, state } = harness(); await service.sync();
  for (const product of await Product.find({ source: 'games', kind: { $ne: 'steam_refill' } }).lean()) await service.variants(product._id);
  assert.equal(await Variant.countDocuments({ present: true }), 15);
  const key = await Variant.findOne({ key: 'games:steam_games:50:key:40:41' }).lean();
  assert.equal(key.stock, null); assert.equal(key.sellingPriceMinor, 1700000);
  assert.equal((await service.detail(key._id)).selectable, true);
  const mv = await Variant.findOne({ key: 'games:mobile_games:70:position:20' });
  assert.equal((await service.detail(mv._id)).selectable, false);
  state.games.steam_games = []; await service.syncSource('games');
  assert.equal(await service.detail(key._id), null);
  assert.equal((await Variant.findById(key._id)).present, false);
});
test('missing FX, stock limits, stale data and hiding disable quantity selection on old buttons', async () => {
  const { service, supplier } = harness(); await service.sync();
  const variant = await Variant.findOne({ key: 'catalog:variant:300' });
  assert.equal((await service.detail(variant._id, 5)).selectable, true);
  assert.equal((await service.detail(variant._id, 6)).selectable, false);
  assert.equal((await new CatalogService(supplier, pricingConfig({})).detail(variant._id)).selectable, false);
  await Variant.updateOne({ _id: variant._id }, { $set: { syncedAt: new Date(Date.now() - 16 * 60 * 1000) } });
  assert.equal((await service.detail(variant._id)).selectable, false);
  await service.setProductEnabled('catalog:product:200', false);
  assert.equal(await service.detail(variant._id), null);
});
test('full synchronization hydrates every games product including hidden products', async () => {
  const { service } = harness(); await service.sync();
  await service.setProductEnabled('games:telegram:60', false);
  const result = await service.syncAll();
  assert.equal(result.loaded, 4); assert.equal(result.errors, 0);
  assert.equal(await Variant.countDocuments({ present: true }), 15);
  const product = await Product.findOne({ key: 'games:telegram:60' });
  assert.equal(product.hidden, true); assert.equal(product.detailsLoaded, true);
});
