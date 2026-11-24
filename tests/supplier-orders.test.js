import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import * as models from '../src/models/index.js';
import { MockSupplier } from './fixtures/mock-supplier.js';
import { SupplierOrderService } from '../src/services/supplier-order.service.js';
import { DeliveryService } from '../src/services/delivery.service.js';
import { FulfillmentCipher } from '../src/services/supplier/crypto.js';
import { SupplierLimiter } from '../src/services/supplier/limiter.js';
import { LightStoreError } from '../src/services/lightstore.service.js';
import { ExchangeRateService } from '../src/services/exchange-rate.service.js';
import { PricingService } from '../src/services/pricing/pricing.service.js';
import { pricingConfig } from '../src/services/pricing.service.js';
import { fxConfig } from '../src/config/fx.js';
import { CatalogService } from '../src/services/catalog.service.js';
import { CheckoutService } from '../src/services/checkout.service.js';
import { SandboxWalletService } from '../src/services/sandbox-wallet.service.js';
import { PaymentService } from '../src/services/payment.service.js';
const { User, Wallet, WalletTransaction, SandboxWalletTransaction, SupplierOrder, CatalogProduct, CatalogVariant, Order } = models;
let mongo;
before(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.24', downloadDir: '/tmp/ai-subs-test-mongodb' }, replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri('phase4_test')); await Promise.all(Object.values(models).map(m => m.init()));
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => { await Promise.all(Object.values(models).map(m => m.deleteMany({}))); });
async function setup() {
  let now = new Date('2026-11-23T10:00:00Z'); const clock = () => now;
  const supplier = new MockSupplier(), wallets = new SandboxWalletService(), payments = new PaymentService(wallets, '42', { now: clock }); await payments.init();
  const user = await User.create({ telegramId: '99' }); await User.create({ telegramId: '98' }); await Wallet.create({ user: user._id, balanceMinor: 1234567 });
  const payment = await payments.request('99', '1000000', 'synthetic-request-0001'); await payments.decide('42', String(payment._id), 'approved');
  const fx = new ExchangeRateService(fxConfig({ FX_RATE_MODE: 'auto' }), { now: clock, fetchImpl: async () => new Response(JSON.stringify([{ Ccy: 'RUB', Rate: '100', Nominal: '1', Date: '23.11.2026' }])) }); await fx.init(); await fx.refresh();
  const pricing = new PricingService(pricingConfig({ DEFAULT_MARKUP_PERCENT: '20', ROUNDING_INCREMENT_UZS: '1000' }), fx); await pricing.init();
  const catalog = new CatalogService(supplier, pricing.config, pricing); await catalog.syncSource('catalog'); await catalog.syncSource('games');
  for (const p of await CatalogProduct.find({ source: 'games', kind: { $ne: 'steam_refill' } }).lean()) await catalog.refreshDetails(p._id);
  const checkout = new CheckoutService(pricing, supplier, { now: clock, wallets }), cipher = new FulfillmentCipher(Buffer.alloc(32, 5).toString('base64'));
  const args = { supplier, pricing, wallets, checkout, cipher, adminIds: '42', now: clock }, service = new SupplierOrderService(args); await service.init();
  const delivery = new DeliveryService(cipher, { now: clock });
  async function selection(kind = 'gift_cards', index = 0) {
    const p = await CatalogProduct.findOne({ kind }).lean();
    const variants = await CatalogVariant.find({ product: p._id }).sort({ supplierVariantId: 1 }).lean();
    let v = variants[index]; if (kind === 'steam_games') v = index === 0 ? variants.find(v => v.packageId != null) : variants.find(v => v.packageId == null);
    const inputs = kind === 'telegram' ? { Input1: 'private_mock_username' } : kind === 'mobile_games' ? { Input1: 'private_mock_id', Input2: 'EU' } : kind === 'steam_refill' ? { login: 'private_mock_login', cur: 'RUB', amount: '500' } : kind === 'steam_games' && index === 0 ? { profile: 'https://steamcommunity.com/id/mock_user' } : {};
    return { product: p._id, variant: v?._id || null, quantity: 1, inputs };
  }
  const preview = async (kind, index) => service.preview('99', await selection(kind, index));
  const confirm = q => service.confirmSimulation('99', q._id, q.quoteFingerprint);
  return { args, service, supplier, wallets, user, cipher, delivery, fx, pricing, selection, preview, confirm, advance: ms => { now = new Date(now.getTime() + ms); } };
}
test('every supported adapter completes mock fulfillment with durable states and immutable price snapshots', async () => {
  const h = await setup();
  for (const [kind, index] of [['catalog',0],['steam_games',0],['steam_games',1],['gift_cards',0],['telegram',0],['mobile_games',0],['steam_refill',0]]) {
    h.advance(61000); const q = await h.preview(kind, index); assert.equal(q.state, 'supplier_quoted'); assert.ok(q.expectedProfitMinor >= 0);
    const paid = await h.confirm(q); assert.equal(paid.state, 'payment_confirmed');
    const processing = await h.service.submitSimulation('99', q._id); assert.equal(processing.state, 'supplier_processing');
    h.advance(10000); const done = await h.service.reconcile('99', q._id); assert.equal(done.state, 'completed'); assert.equal(done.deliveryStatus, 'ready');
    assert.ok(done.timeline.some(e => e.state === 'supplier_ordering')); assert.equal((await Order.findById(paid.baseOrder)).totalMinor, paid.confirmedSnapshot.totalMinor);
    assert.match((await h.delivery.messages('99', q._id))[0], /MOCK/);
  }
  assert.equal((await Wallet.findOne({ user: h.user._id })).balanceMinor, 1234567); assert.equal(await WalletTransaction.countDocuments(), 0);
});
test('quotes expire, price changes need reconfirmation, insufficient balance and missing inputs block', async () => {
  const h = await setup(), q = await h.preview(); h.advance(180000);
  await assert.rejects(h.confirm(q), { code: 'QUOTE_EXPIRED' });
  const next = await h.preview(); h.supplier.price += 10000;
  const changed = await h.confirm(next); assert.equal(changed.state, 'supplier_quoted'); assert.notEqual(changed.quoteFingerprint, next.quoteFingerprint);
  assert.equal(await SandboxWalletTransaction.countDocuments({ type: 'reserve' }), 0);
  await h.confirm(changed); assert.equal(await SandboxWalletTransaction.countDocuments({ type: 'reserve' }), 1);
  h.supplier.balance = 0; await assert.rejects(h.preview(), { code: 'INSUFFICIENT_SUPPLIER_BALANCE' });
  h.supplier.balance = 100000000;
  const input = await h.selection('telegram'); input.inputs = {}; await assert.rejects(h.service.preview('99', input), { code: 'MISSING_INPUT' });
  h.supplier.enabled = false; await assert.rejects(h.preview(), { code: 'SUPPLIER_DISABLED' });
  assert.equal(h.supplier.calls.filter(c => c[0] === 'purchase').length, 0);
});
test('real supplier mode never accepts sandbox payment or submits a purchase', async () => {
  const h = await setup(); h.supplier.mode = 'live-readonly'; const q = await h.preview();
  await assert.rejects(h.service.confirmSimulation('99', q._id, q.quoteFingerprint), { code: 'REAL_PURCHASE_DISABLED' });
  await assert.rejects(h.service.submitSimulation('99', q._id), { code: 'REAL_PURCHASE_DISABLED' });
  assert.equal(await SandboxWalletTransaction.countDocuments({ type: 'reserve' }), 0); assert.equal(h.supplier.calls.filter(c => c[0] === 'purchase').length, 0);
});
test('concurrent confirms and submissions create one reservation and one supplier order', async () => {
  const h = await setup(), q = await h.preview(); await Promise.all([h.confirm(q), h.confirm(q)]);
  await Promise.all([h.service.submitSimulation('99', q._id), h.service.submitSimulation('99', q._id)]);
  assert.equal(await SandboxWalletTransaction.countDocuments({ type: 'reserve' }), 1); assert.equal(h.supplier.store.orders.size, 1);
  assert.equal(h.supplier.calls.filter(c => c[0] === 'purchase').length, 1);
});
test('lost purchase response reconciles first then reuses identical quote and request identity after restart', async () => {
  const h = await setup(), q = await h.preview(); await h.confirm(q); h.supplier.loseResponse = true;
  const unknown = await h.service.submitSimulation('99', q._id); assert.equal(unknown.state, 'supplier_ordering'); assert.equal(unknown.supplierOrderId, undefined);
  const original = h.supplier.calls.find(c => c[0] === 'purchase')[1], quoteId = unknown.supplierQuoteId;
  h.advance(190000); const restarted = new SupplierOrderService(h.args); await restarted.reconcile('99', q._id);
  assert.equal(h.supplier.store.orders.size, 1); assert.equal(h.supplier.calls.at(-2)[0], 'list'); assert.deepEqual(h.supplier.calls.at(-1)[1], original);
  const stored = await SupplierOrder.findById(q._id); assert.equal(stored.supplierQuoteId, quoteId); assert.equal(stored.submitAttempts, 2);
  h.advance(10000); await restarted.reconcile('99', q._id); assert.equal((await SupplierOrder.findById(q._id)).state, 'completed');
});
test('known pending IDs only poll status; review never submits a second purchase and refunded releases test funds', async () => {
  const h = await setup(), q = await h.preview(); await h.confirm(q); await h.service.submitSimulation('99', q._id);
  h.supplier.status = 'processing'; h.advance(10000); assert.equal((await h.service.reconcile('42', q._id, { admin: true })).state, 'supplier_processing');
  h.supplier.status = 'review'; h.advance(10000); assert.equal((await h.service.reconcile('42', q._id, { admin: true })).state, 'manual_review');
  h.supplier.status = 'refunded'; h.advance(10000); assert.equal((await h.service.reconcile('42', q._id, { admin: true })).state, 'refunded');
  assert.equal((await h.wallets.balance('99')).reservedMinor, 0); assert.equal(h.supplier.calls.filter(c => c[0] === 'purchase').length, 1);
});
test('402 refund and 409 manual review are safe; status 404 never resubmits a purchase', async () => {
  const h = await setup(), q = await h.preview(); await h.confirm(q); h.supplier.fail = new LightStoreError('HTTP_ERROR', 402);
  assert.equal((await h.service.submitSimulation('99', q._id)).state, 'refunded'); assert.equal((await h.wallets.balance('99')).reservedMinor, 0);
  const next = await h.preview(); await h.confirm(next); h.supplier.fail = new LightStoreError('HTTP_ERROR', 409);
  assert.equal((await h.service.submitSimulation('99', next._id)).state, 'manual_review');
  h.supplier.fail = null; const third = await h.preview(); await h.confirm(third); await h.service.submitSimulation('99', third._id);
  h.supplier.failStatus = new LightStoreError('HTTP_ERROR', 404); h.advance(10000);
  assert.equal((await h.service.reconcile('99', third._id)).state, 'manual_review'); assert.equal(h.supplier.calls.filter(c => c[0] === 'purchase').length, 3);
});
test('503 and 429 use durable backoff; stalled quote recovery does not purchase', async () => {
  const h = await setup(), q = await h.preview(); await h.confirm(q); h.supplier.fail = new LightStoreError('HTTP_ERROR', 503);
  const pending = await h.service.submitSimulation('99', q._id); assert.equal(pending.state, 'supplier_ordering');
  await h.service.reconcile('99', q._id); assert.equal(h.supplier.calls.filter(c => c[0] === 'purchase').length, 1);
  h.advance(10000); h.supplier.failList = new LightStoreError('HTTP_ERROR', 429); await h.service.reconcile('99', q._id);
  assert.equal(h.supplier.calls.filter(c => c[0] === 'purchase').length, 1); assert.equal((await SupplierOrder.findById(q._id)).errorCode, 'HTTP_429');
  await SupplierOrder.create({ _id: 'interrupted-quote', user: h.user._id, telegramId: '99', source: 'mock', state: 'supplier_quote_pending', requestId: 'ais:interrupted', quantity: 1, createdAt: new Date('2000-01-01'), updatedAt: new Date('2000-01-01') });
  await h.service.tick(); assert.equal((await SupplierOrder.findById('interrupted-quote')).state, 'failed');
});
test('delivery is encrypted, owner-only and concurrency safe; lost Telegram response is not auto-retried', async () => {
  const h = await setup(), q = await h.preview('telegram'); await h.confirm(q); await h.service.submitSimulation('99', q._id); h.advance(10000); await h.service.reconcile('99', q._id);
  const raw = await SupplierOrder.findById(q._id).select('+sealedInputs +sealedRequest +sealedDelivery').lean();
  assert.ok(!JSON.stringify(raw).includes('private_mock_username')); assert.ok(!JSON.stringify(raw).includes('SYNTHETIC-CODE'));
  assert.ok(!('sealedInputs' in await h.service.get('42', q._id, { admin: true })));
  await assert.rejects(h.delivery.messages('42', q._id), { code: 'DELIVERY_NOT_FOUND' }); await assert.rejects(h.delivery.messages('98', q._id), { code: 'DELIVERY_NOT_FOUND' });
  const sent = []; const send = async (owner, text, options) => { sent.push({ owner, text, options }); throw new Error('lost sensitive Telegram response'); };
  await Promise.all([h.delivery.deliver('99', q._id, send), h.delivery.deliver('99', q._id, send)]);
  assert.equal(sent.length, 1); assert.equal(sent[0].owner, '99'); assert.equal(sent[0].options.protect_content, true);
  assert.equal((await SupplierOrder.findById(q._id)).deliveryStatus, 'uncertain'); await h.delivery.tick(send); assert.equal(sent.length, 1);
  assert.match((await h.delivery.messages('99', q._id))[0], /SYNTHETIC/);
});
test('manual standard fulfillment and empty key delivery stay reviewable without fabricated links', async () => {
  const h = await setup(); h.supplier.catalog.categories[0].products[0].variants[0].delivery = 'manual';
  const q = await h.preview('catalog'); await h.confirm(q); const pending = await h.service.submitSimulation('99', q._id);
  assert.equal(pending.deliveryStatus, 'manual'); assert.equal(pending.state, 'supplier_processing');
  h.supplier.values = []; const key = await h.preview('steam_games', 1); await h.confirm(key); await h.service.submitSimulation('99', key._id); h.advance(10000);
  assert.equal((await h.service.reconcile('99', key._id)).state, 'manual_review');
});
test('outbox restart preserves sent receipts and marks an interrupted send uncertain without duplication', async () => {
  const h = await setup(), q = await h.preview(); await h.confirm(q); await h.service.submitSimulation('99', q._id); h.advance(10000); await h.service.reconcile('99', q._id);
  let sent = 0; const send = async () => { sent++; return { message_id: 123 }; };
  const restarted = new DeliveryService(h.cipher, { now: h.args.now }); await restarted.tick(send); await restarted.tick(send);
  assert.equal(sent, 1); assert.deepEqual((await SupplierOrder.findById(q._id)).deliveryMessageIds.toObject(), [123]);
  const next = await h.preview(); await h.confirm(next); await h.service.submitSimulation('99', next._id); h.advance(10000); await h.service.reconcile('99', next._id);
  await SupplierOrder.updateOne({ _id: next._id }, { $set: { deliveryStatus: 'sending', deliveryAttemptAt: h.args.now() } });
  h.advance(121000); await restarted.tick(send); assert.equal(sent, 1); assert.equal((await SupplierOrder.findById(next._id)).deliveryStatus, 'uncertain');
});
test('a refund release interrupted by a database failure is completed once by the recovery worker', async () => {
  const h = await setup(), q = await h.preview(); await h.confirm(q); await h.service.submitSimulation('99', q._id); h.advance(10000); h.supplier.status = 'refunded';
  const cancel = h.args.checkout.cancel.bind(h.args.checkout); h.args.checkout.cancel = async () => { throw new Error('temporary local DB failure'); };
  assert.equal((await h.service.reconcile('99', q._id)).state, 'refunded');
  assert.equal((await SupplierOrder.findById(q._id)).errorCode, 'RESERVATION_RELEASE_PENDING');
  h.args.checkout.cancel = cancel; await h.service.tick(); await h.service.tick();
  assert.equal((await h.wallets.balance('99')).reservedMinor, 0); assert.equal(await SandboxWalletTransaction.countDocuments({ type: 'release' }), 1);
  assert.ok((await SupplierOrder.findById(q._id)).reservationReleasedAt);
});
test('authorization, expired FX and disabled encryption protect quotes and admin state controls', async () => {
  const h = await setup(), q = await h.preview();
  await assert.rejects(h.service.get('98', q._id), { code: 'ORDER_NOT_FOUND' }); await assert.rejects(h.service.list('99', { admin: true }), { code: 'ADMIN_ONLY' });
  await assert.rejects(h.service.supplierStatus('99'), { code: 'ADMIN_ONLY' });
  const disabled = new SupplierOrderService({ ...h.args, cipher: new FulfillmentCipher() }); await assert.rejects(disabled.preview('99', await h.selection()), { code: 'FULFILLMENT_KEY_REQUIRED' });
  h.advance(8 * 86400000); await assert.rejects(h.preview(), { code: 'PRICE_UNAVAILABLE' });
  assert.equal(h.supplier.calls.filter(c => c[0] === 'purchase').length, 0);
});
test('MongoDB API-key budget is shared after restart and enforces request/purchase spacing and cooldown', async () => {
  let time = 0; const now = () => time, sleep = async ms => { time += ms; };
  const first = new SupplierLimiter('test-key-only', { now, sleep }); await first.init();
  await first.acquire({ purchase: true }); assert.equal(time, 0);
  const second = new SupplierLimiter('test-key-only', { now, sleep }); await second.init();
  await second.acquire(); assert.ok(time >= 1100); await second.acquire({ purchase: true }); assert.ok(time >= 6100);
  await first.cooldown(time + 60000); const before = time; await second.acquire(); assert.ok(time - before >= 60000);
});
