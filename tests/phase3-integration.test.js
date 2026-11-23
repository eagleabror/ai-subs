import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import * as models from '../src/models/index.js';
import { ExchangeRateService } from '../src/services/exchange-rate.service.js';
import { fxConfig } from '../src/config/fx.js';
import { pricingConfig } from '../src/services/pricing.service.js';
import { PricingService } from '../src/services/pricing/pricing.service.js';
import { AdminPricingService } from '../src/services/pricing/admin-pricing.service.js';
import { CheckoutService } from '../src/services/checkout.service.js';
import { CatalogService } from '../src/services/catalog.service.js';
import { adaptSubscriptions } from '../src/services/catalog/subscriptions.adapter.js';
import { adaptGamesCatalog } from '../src/services/catalog/games.adapter.js';
import { subscriptions, games } from './fixtures/universal.js';
const { ExchangeRate, PriceAudit, CatalogCategory, CatalogProduct, CatalogVariant, Order, User, Wallet, WalletTransaction, CheckoutQuote } = models;
let mongo;
before(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.24', downloadDir: '/tmp/ai-subs-test-mongodb' }, replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri('phase3_test')); await Promise.all(Object.values(models).map(m => m.init()));
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => { await Promise.all(Object.values(models).map(m => m.deleteMany({}))); });
async function setup(env = {}) {
  let now = new Date('2026-11-23T10:00:00Z'), interval, cleared = false, timerCallback;
  const state = { rate: '100.00', nominal: '1', date: '20.11.2026', unavailable: false, bad: false, calls: 0, catalog: structuredClone(subscriptions), supplierFailure: false, forceCalls: [] };
  const config = fxConfig({ FX_RATE_MODE: 'auto', ...env });
  const fx = new ExchangeRateService(config, { now: () => now,
    fetchImpl: async () => { state.calls++; if (state.unavailable) throw new Error('sensitive upstream data'); return new Response(JSON.stringify([{ Ccy: 'RUB', Rate: state.bad ? '0' : state.rate, Nominal: state.nominal, Date: state.date }])); },
    schedule: (fn, ms) => { interval = ms; timerCallback = fn; return { unref() {} }; }, unschedule: () => { cleared = true; },
  });
  await fx.init(); await fx.refresh();
  const pricing = new PricingService(pricingConfig({ DEFAULT_MARKUP_PERCENT: '20', ROUNDING_INCREMENT_UZS: '1', ...env }), fx); await pricing.init();
  const supplier = { getCatalogSnapshot: async options => { state.forceCalls.push(options); if (state.supplierFailure) throw new Error('API fail'); return adaptSubscriptions(state.catalog); }, getGamesCatalog: async () => adaptGamesCatalog(games) };
  const catalog = new CatalogService(supplier, pricing.config, pricing); await catalog.syncSource('catalog');
  const variant = await CatalogVariant.findOne({ key: 'catalog:variant:300' }).lean(), product = await CatalogProduct.findById(variant.product).lean(), category = await CatalogCategory.findById(variant.category).lean();
  const admin = new AdminPricingService(pricing, '42,43', { now: () => now }), checkout = new CheckoutService(pricing, supplier, { now: () => now });
  const user = await User.create({ telegramId: '99' }); await Wallet.create({ user: user._id, balanceMinor: 9999999 });
  const save = async change => admin.save('42', await admin.preview('42', change));
  return { state, fx, pricing, supplier, catalog, admin, checkout, variant, product, category, user, save,
    tick: async () => { timerCallback(); await fx.refresh(); }, timer: () => ({ interval, cleared }), advance: ms => { now = new Date(now.getTime() + ms); } };
}
test('valid cache survives API outage, invalid and regressing responses and server restart', async () => {
  const h = await setup(), previous = (await h.fx.current()).rate;
  h.state.bad = true; await assert.rejects(h.fx.refresh()); assert.deepEqual((await h.fx.current()).rate, previous);
  h.state.bad = false; h.state.unavailable = true; await assert.rejects(h.fx.refresh(), { code: 'CBU_UNAVAILABLE' });
  const restarted = new ExchangeRateService(h.fx.config, { now: h.fx.now }); await restarted.init();
  assert.equal((await restarted.current()).acceptable, true); assert.deepEqual((await restarted.current()).rate, previous);
  h.state.unavailable = false; h.state.date = '19.11.2026'; await assert.rejects(h.fx.refresh(), { code: 'CBU_REGRESSING_DATE' });
  assert.equal((await h.fx.current()).rate.effectiveDate, '2026-11-20');
});
test('six-hour automatic timer refreshes same-date weekend rates without overwriting manual mode', async () => {
  const h = await setup(); h.fx.start(); await h.fx.refresh(); assert.equal(h.timer().interval, 360 * 60000);
  const before = (await h.fx.current()).rate.fetchedAt;
  h.advance(6 * 3600000); await h.tick(); assert.ok((await h.fx.current()).rate.fetchedAt > before);
  await h.save({ scope: 'fx', target: 'RUB', field: 'manual', value: '150.25' });
  h.state.rate = '105.00'; h.advance(6 * 3600000); await h.tick();
  assert.equal((await h.fx.current()).displayRate, '150.25');
  assert.equal((await ExchangeRate.findById('RUB')).automatic.rate, '105.00');
  await h.save({ scope: 'fx', target: 'RUB', field: 'mode', value: 'auto' }); assert.equal((await h.fx.current()).displayRate, '105');
  assert.equal(await PriceAudit.countDocuments({ actorId: '42', scope: 'fx' }), 2);
  h.fx.stop(); assert.equal(h.timer().cleared, true);
});
test('CBU header/body timeouts retain a valid rate and expose no upstream detail', async () => {
  const h = await setup();
  for (const body of [false, true]) {
    const fx = new ExchangeRateService({ ...h.fx.config, timeoutMs: 100 }, { now: h.fx.now, fetchImpl: async (_url, { signal }) => {
      const wait = () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('private detail')), { once: true }));
      return body ? { ok: true, json: wait } : wait();
    } });
    await assert.rejects(fx.refresh(), { code: 'CBU_TIMEOUT', message: 'CBU_TIMEOUT' }); assert.equal((await fx.current()).acceptable, true);
  }
});
test('global/category/product/variant priority, inheritance resets and FX buffer apply dynamically', async () => {
  const h = await setup();
  const quote = () => h.pricing.quote(h.variant._id);
  assert.equal((await quote()).markupSource, 'global'); assert.equal((await quote()).markup, '20');
  await h.save({ scope: 'category', target: h.category._id, field: 'markup', value: '25' }); assert.equal((await quote()).markup, '25');
  await h.save({ scope: 'product', target: h.product._id, field: 'markup', value: '30' }); assert.equal((await quote()).markup, '30');
  await h.save({ scope: 'variant', target: h.variant._id, field: 'markup', value: '40' }); assert.equal((await quote()).markupSource, 'variant');
  await h.save({ scope: 'variant', target: h.variant._id, field: 'markup', value: null }); assert.equal((await quote()).markup, '30');
  await h.save({ scope: 'product', target: h.product._id, field: 'markup', value: null }); assert.equal((await quote()).markup, '25');
  await h.save({ scope: 'global', target: 'global', field: 'fxBufferPercent', value: '10' }); assert.equal((await quote()).fxBufferPercent, '10');
  await h.save({ scope: 'global', target: 'global', field: 'rounding', value: '1000' }); assert.equal((await quote()).unitMinor % 100000, 0);
  assert.equal((await h.catalog.detail(h.variant._id)).price.markup, '25');
});
test('legacy product env overrides migrate once, can reset to category and never return after restart', async () => {
  const h = await setup({ PRODUCT_MARKUP_OVERRIDE: '{"catalog:product:200":"45"}' });
  assert.equal((await h.pricing.quote(h.variant._id)).markup, '45');
  await h.save({ scope: 'category', target: h.category._id, field: 'markup', value: '15' });
  await h.save({ scope: 'product', target: h.product._id, field: 'markup', value: null });
  await h.pricing.init(); assert.equal((await h.pricing.quote(h.variant._id)).markup, '15');
});
test('supplier sync preserves all custom markup levels and hidden products', async () => {
  const h = await setup();
  for (const [scope, target, value] of [['category',h.category._id,'15'],['product',h.product._id,'25'],['variant',h.variant._id,'35']]) await h.save({ scope, target, field: 'markup', value });
  await h.save({ scope: 'product', target: h.product._id, field: 'enabled', value: false });
  h.state.catalog.categories[0].products[0].variants[0].price = 100;
  await h.catalog.syncSource('catalog');
  assert.equal((await CatalogCategory.findById(h.category._id)).markupOverride, '15');
  assert.equal((await CatalogProduct.findById(h.product._id)).markupOverride, '25'); assert.equal((await CatalogProduct.findById(h.product._id)).hidden, true);
  assert.equal((await CatalogVariant.findById(h.variant._id)).markupOverride, '35'); assert.equal((await CatalogVariant.findById(h.variant._id)).supplierPriceMinor, 100);
});
test('admin authorization, configurable percentage bounds, audited saves and stale previews', async () => {
  const h = await setup({ MARKUP_MIN_PERCENT: '5', MARKUP_MAX_PERCENT: '50' }), change = { scope: 'product', target: h.product._id, field: 'markup', value: '30' };
  await assert.rejects(h.admin.preview('99', change), { code: 'ADMIN_ONLY' });
  const preview = await h.admin.preview('42', change);
  await assert.rejects(h.admin.save('99', preview), { code: 'ADMIN_ONLY' });
  for (const value of ['4','51','-1','NaN']) await assert.rejects(h.admin.preview('42', { ...change, value }), { code: 'INVALID_MARKUP' });
  await h.save({ ...change, value: '25' });
  await assert.rejects(h.admin.save('42', preview), { code: 'PREVIEW_CHANGED' });
  assert.equal(await PriceAudit.countDocuments({ actorId: '42', action: 'product_markup' }), 1);
});
test('checkout revalidates supplier/rate/markup and requires a second confirmation after price changes', async () => {
  const h = await setup(); let quote = await h.checkout.create('99', h.variant._id, 2);
  assert.equal(quote.snapshot.totalMinor, 2962800);
  h.state.catalog.categories[0].products[0].variants[0].price = 15000;
  let confirmation = await h.checkout.confirm('99', quote._id, quote.fingerprint);
  assert.equal(confirmation.status, 'changed'); assert.equal(await Order.countDocuments(), 0); quote = confirmation.quote;
  await h.save({ scope: 'product', target: h.product._id, field: 'markup', value: '30' });
  confirmation = await h.checkout.confirm('99', quote._id, quote.fingerprint); assert.equal(confirmation.status, 'changed'); quote = confirmation.quote;
  await h.save({ scope: 'fx', target: 'RUB', field: 'manual', value: '120' });
  confirmation = await h.checkout.confirm('99', quote._id, quote.fingerprint); assert.equal(confirmation.status, 'changed'); quote = confirmation.quote;
  const final = await h.checkout.confirm('99', quote._id, quote.fingerprint);
  assert.equal(final.status, 'confirmed'); assert.equal(final.order.totalMinor, 4680000); assert.equal(final.order.pricingSnapshot.exchangeRate.source, 'manual');
  assert.ok(h.state.forceCalls.filter(Boolean).every(options => options.force === true));
  assert.equal((await Wallet.findOne({ user: h.user._id })).balanceMinor, 9999999); assert.equal(await WalletTransaction.countDocuments(), 0);
});
test('idempotent concurrent confirmations do not debit a wallet and confirmed prices remain immutable', async () => {
  const h = await setup(), quote = await h.checkout.create('99', h.variant._id, 1);
  const results = await Promise.all([h.checkout.confirm('99', quote._id, quote.fingerprint), h.checkout.confirm('99', quote._id, quote.fingerprint)]);
  assert.equal(String(results[0].order._id), String(results[1].order._id)); assert.equal(await Order.countDocuments(), 1);
  const total = results[0].order.totalMinor;
  await h.save({ scope: 'fx', target: 'RUB', field: 'manual', value: '999' });
  assert.equal((await Order.findById(results[0].order._id)).totalMinor, total);
  await Order.updateOne({ _id: results[0].order._id }, { $set: { totalMinor: 1, pricingSnapshot: { tampered: true } } });
  const saved = await Order.findById(results[0].order._id); assert.equal(saved.totalMinor, total); assert.ok(saved.pricingSnapshot.calculationVersion);
  assert.equal((await Wallet.findOne({ user: h.user._id })).balanceMinor, 9999999); assert.equal(await WalletTransaction.countDocuments(), 0);
});
test('unacceptable rates, expired quotes, insufficient stock, hidden products and API failures block confirmation', async () => {
  const h = await setup(), quote = await h.checkout.create('99', h.variant._id, 1);
  await assert.rejects(h.checkout.confirm('98', quote._id, quote.fingerprint), { code: 'QUOTE_NOT_FOUND' });
  h.state.supplierFailure = true; await assert.rejects(h.checkout.confirm('99', quote._id, quote.fingerprint), { code: 'SUPPLIER_UNAVAILABLE' }); h.state.supplierFailure = false;
  h.state.catalog.categories[0].products[0].variants[0].in_stock = 0;
  await assert.rejects(h.checkout.confirm('99', quote._id, quote.fingerprint), { code: 'PRODUCT_UNAVAILABLE' });
  h.state.catalog.categories[0].products[0].variants[0].in_stock = 7;
  await ExchangeRate.updateOne({ _id: 'RUB' }, { $set: { 'automatic.effectiveDate': '2026-11-01' } });
  await assert.rejects(h.checkout.confirm('99', quote._id, quote.fingerprint), { code: 'PRICE_UNAVAILABLE' });
  h.advance(6 * 60000); await assert.rejects(h.checkout.confirm('99', quote._id, quote.fingerprint), { code: 'QUOTE_EXPIRED' });
  assert.equal(await Order.countDocuments(), 0); assert.equal(await WalletTransaction.countDocuments(), 0);
});

test('missing cached FX blocks new checkout; legacy env bootstrap is audited and not silently refreshed on restart', async () => {
  const h = await setup();
  await ExchangeRate.updateOne({ _id: 'RUB' }, { $unset: { automatic: 1 } });
  assert.equal(await h.pricing.quote(h.variant._id), null);
  await assert.rejects(h.checkout.create('99', h.variant._id, 1), { code: 'PRICE_UNAVAILABLE' });
  await ExchangeRate.deleteMany({});
  const legacy = new ExchangeRateService(fxConfig({ RUB_TO_UZS_RATE: '123.45' }), { now: h.fx.now }); await legacy.init();
  const initial = await legacy.current(); assert.equal(initial.mode, 'legacy'); assert.equal(initial.displayRate, '123.45');
  h.advance(3600000); await legacy.init(); assert.deepEqual((await legacy.current()).rate.fetchedAt, initial.rate.fetchedAt);
  assert.equal(await PriceAudit.countDocuments({ action: 'fx_legacy_import' }), 1);
});

test('checkout rejects a hidden product, reduced quantity limit and old confirmation tokens after repricing', async () => {
  const h = await setup(), quote = await h.checkout.create('99', h.variant._id, 2);
  await h.save({ scope: 'product', target: h.product._id, field: 'enabled', value: false });
  await assert.rejects(h.checkout.confirm('99', quote._id, quote.fingerprint), { code: 'PRODUCT_UNAVAILABLE' });
  await h.save({ scope: 'product', target: h.product._id, field: 'enabled', value: true });
  h.state.catalog.categories[0].products[0].variants[0].max_quantity = 1;
  await assert.rejects(h.checkout.confirm('99', quote._id, quote.fingerprint), { code: 'STOCK_LIMIT' });
  h.state.catalog.categories[0].products[0].variants[0].max_quantity = 5;
  await h.save({ scope: 'global', target: 'global', field: 'markup', value: '30' });
  const changed = await h.checkout.confirm('99', quote._id, quote.fingerprint); assert.equal(changed.status, 'changed');
  assert.equal((await h.checkout.confirm('99', quote._id, quote.fingerprint)).status, 'changed');
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await h.checkout.confirm('99', quote._id, changed.quote.fingerprint)).status, 'confirmed');
});
