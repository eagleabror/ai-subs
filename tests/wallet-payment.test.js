import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import * as models from '../src/models/index.js';
import { SandboxWalletService } from '../src/services/sandbox-wallet.service.js';
import { PaymentService, parseTopup } from '../src/services/payment.service.js';
import { CheckoutService } from '../src/services/checkout.service.js';
import { ExchangeRateService } from '../src/services/exchange-rate.service.js';
import { PricingService } from '../src/services/pricing/pricing.service.js';
import { pricingConfig } from '../src/services/pricing.service.js';
import { fxConfig } from '../src/config/fx.js';
import { CatalogService } from '../src/services/catalog.service.js';
import { adaptSubscriptions } from '../src/services/catalog/subscriptions.adapter.js';
import { subscriptions } from './fixtures/universal.js';
const { User, Wallet, WalletTransaction, SandboxWallet, SandboxWalletTransaction, PaymentRequest, CatalogVariant, Order, CheckoutQuote } = models;
let mongo;
before(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.24', downloadDir: '/tmp/ai-subs-test-mongodb' }, replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri('wallet_payment_test')); await Promise.all(Object.values(models).map(m => m.init()));
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => { await Promise.all(Object.values(models).map(m => m.deleteMany({}))); });
async function setup() {
  let now = new Date('2026-11-23T10:00:00Z');
  const clock = () => now, wallets = new SandboxWalletService(), payments = new PaymentService(wallets, '42,43', { now: clock });
  const user = await User.create({ telegramId: '99' }); await User.create({ telegramId: '98' });
  await Wallet.create({ user: user._id, balanceMinor: 1234567 });
  await payments.init();
  const fx = new ExchangeRateService(fxConfig({ FX_RATE_MODE: 'auto' }), { now: clock,
    fetchImpl: async () => new Response(JSON.stringify([{ Ccy: 'RUB', Rate: '100.00', Nominal: '1', Date: '23.11.2026' }])) });
  await fx.init(); await fx.refresh();
  const pricing = new PricingService(pricingConfig({ DEFAULT_MARKUP_PERCENT: '20', ROUNDING_INCREMENT_UZS: '1' }), fx); await pricing.init();
  const state = { catalog: structuredClone(subscriptions), fail: false };
  const supplier = { getCatalogSnapshot: async () => { if (state.fail) throw new Error('supplier failed'); return adaptSubscriptions(state.catalog); } };
  const catalog = new CatalogService(supplier, pricing.config, pricing); await catalog.syncSource('catalog');
  const variant = await CatalogVariant.findOne({ key: 'catalog:variant:300' }).lean();
  const checkout = new CheckoutService(pricing, supplier, { now: clock, wallets });
  let serial = 0;
  const request = (amount = '100000', id = '99') => payments.request(id, amount, `payment-request-${String(++serial).padStart(8, '0')}`);
  const fund = async (amount = '100000', id = '99') => { const p = await request(amount, id); await payments.decide('42', String(p._id), 'approved'); return p; };
  const quote = (qty = 1) => checkout.create('99', variant._id, qty);
  return { wallets, payments, user, state, checkout, pricing, supplier, clock, variant, fund, request, quote, advance: ms => { now = new Date(now.getTime() + ms); } };
}
test('top-up amounts parse exact UZS tiyin and reject rounding, exponent, coercion and limits', () => {
  assert.equal(parseTopup('1000.01'), 100001); assert.equal(parseTopup('10000000'), 1000000000);
  for (const value of [1000, null, '0', '-1000', '999.99', '10000000.01', '1000.001', '1000.000', '1e6', '0x1000', '1 000', 'Infinity']) assert.throws(() => parseTopup(value), { code: 'TOPUP_INVALID' });
});
test('concurrent duplicate payment requests are idempotent; only one pending request per user', async () => {
  const h = await setup(), token = 'same-request-token-001';
  const results = await Promise.all([h.payments.request('99', '1000.01', token), h.payments.request('99', '1000.01', token)]);
  assert.equal(String(results[0]._id), String(results[1]._id)); assert.equal(await PaymentRequest.countDocuments(), 1);
  await assert.rejects(h.payments.request('99', '2000', token), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(h.request(), { code: 'PAYMENT_PENDING' });
  await h.request('1000', '98'); assert.equal(await PaymentRequest.countDocuments({ status: 'pending' }), 2);
  assert.equal((await h.wallets.balance('99')).balanceMinor, 0);
});
test('admin approval credits exactly once with an audit ledger; real wallet stays untouched', async () => {
  const h = await setup(), p = await h.request('1000.01'), id = String(p._id);
  const result = await Promise.all([h.payments.decide('42', id, 'approved'), h.payments.decide('43', id, 'approved')]);
  assert.ok(result.every(p => p.status === 'approved'));
  assert.equal((await h.wallets.balance('99')).balanceMinor, 100001);
  const ledger = await SandboxWalletTransaction.find({ payment: p._id }).lean();
  assert.equal(ledger.length, 1); assert.ok(['42','43'].includes(ledger[0].actorId)); assert.equal(ledger[0].type, 'credit');
  assert.equal((await Wallet.findOne({ user: h.user._id })).balanceMinor, 1234567); assert.equal(await WalletTransaction.countDocuments(), 0);
  await assert.rejects(h.payments.decide('42', id, 'rejected'), { code: 'PAYMENT_ALREADY_DECIDED' });
});
test('service authorization and ownership block unauthorized payments and foreign history', async () => {
  const h = await setup(), p = await h.request(), id = String(p._id);
  await assert.rejects(h.payments.decide('99', id, 'approved'), { code: 'ADMIN_ONLY' });
  await assert.rejects(h.payments.list('99', { admin: true }), { code: 'ADMIN_ONLY' });
  await assert.rejects(h.payments.get('98', id), { code: 'PAYMENT_NOT_FOUND' });
  await assert.rejects(h.payments.decide('98', id, 'cancelled'), { code: 'PAYMENT_NOT_FOUND' });
  await assert.rejects(h.payments.get('42', 'invalid', { admin: true }), { code: 'PAYMENT_NOT_FOUND' });
  await assert.rejects(h.request('1000', '777'), { code: 'START_REQUIRED' });
  assert.equal((await h.payments.list('98')).total, 0); assert.equal((await h.wallets.history('98')).total, 0);
  assert.equal(await SandboxWalletTransaction.countDocuments(), 0);
});
test('rejection and cancellation are terminal, do not credit and permit a new request', async () => {
  const h = await setup(), p = await h.request();
  await h.payments.decide('42', String(p._id), 'rejected');
  const second = await h.request(); await h.payments.decide('99', String(second._id), 'cancelled');
  await assert.rejects(h.payments.decide('42', String(second._id), 'approved'), { code: 'PAYMENT_ALREADY_DECIDED' });
  await h.request(); assert.equal((await h.wallets.balance('99')).balanceMinor, 0);
  assert.equal(await SandboxWalletTransaction.countDocuments(), 0);
});
test('approval racing cancellation settles once without a mismatched ledger', async () => {
  const h = await setup(), p = await h.request('1000'), id = String(p._id);
  await Promise.allSettled([h.payments.decide('42', id, 'approved'), h.payments.decide('99', id, 'cancelled')]);
  const stored = await PaymentRequest.findById(id).lean(), wallet = await h.wallets.balance('99');
  assert.ok(['approved', 'cancelled'].includes(stored.status));
  assert.equal(wallet.balanceMinor, stored.status === 'approved' ? 100000 : 0);
  assert.equal(await SandboxWalletTransaction.countDocuments(), stored.status === 'approved' ? 1 : 0);
});
test('expired payment cannot be approved, including after a service restart', async () => {
  const h = await setup(), p = await h.request(); h.advance(24 * 3600000);
  const restarted = new PaymentService(new SandboxWalletService(), '42', { now: h.clock });
  assert.equal((await restarted.decide('42', String(p._id), 'approved')).status, 'expired');
  assert.equal((await h.wallets.balance('99')).balanceMinor, 0);
  const next = await h.request(); h.advance(24 * 3600000); await restarted.expirePending();
  assert.equal((await PaymentRequest.findById(next._id)).status, 'expired');
});
test('a new request can replace an expired pending request before the maintenance timer runs', async () => {
  const h = await setup(), old = await h.request(); h.advance(24 * 3600000);
  const current = await h.request('2000');
  assert.equal(current.status, 'pending'); assert.equal(current.amountMinor, 200000);
  assert.equal((await PaymentRequest.findById(old._id)).status, 'expired');
  assert.equal(await PaymentRequest.countDocuments({ user: h.user._id, status: 'pending' }), 1);
});
test('ledger failure and money overflow roll back approval and its balance update', async () => {
  const h = await setup(), p = await h.request(), create = SandboxWalletTransaction.create;
  SandboxWalletTransaction.create = async () => { throw new Error('test write failure'); };
  try { await assert.rejects(h.payments.decide('42', String(p._id), 'approved')); } finally { SandboxWalletTransaction.create = create; }
  assert.equal((await PaymentRequest.findById(p._id)).status, 'pending'); assert.equal((await h.wallets.balance('99')).balanceMinor, 0);
  await SandboxWallet.updateOne({ user: h.user._id }, { $set: { balanceMinor: Number.MAX_SAFE_INTEGER } });
  await assert.rejects(h.payments.decide('42', String(p._id), 'approved'), { code: 'WALLET_LIMIT' });
  assert.equal((await PaymentRequest.findById(p._id)).status, 'pending'); assert.equal(await SandboxWalletTransaction.countDocuments(), 0);
  await assert.rejects(h.wallets.lock(h.user._id), { code: 'TRANSACTION_REQUIRED' });
});
test('insufficient sandbox balance rolls back the order; a funded confirmation only reserves', async () => {
  const h = await setup(), q = await h.quote();
  await assert.rejects(h.checkout.confirm('99', q._id, q.fingerprint), { code: 'INSUFFICIENT_SANDBOX_BALANCE' });
  assert.equal(await Order.countDocuments(), 0); assert.equal((await CheckoutQuote.findById(q._id)).status, 'pending');
  await h.fund(); const result = await h.checkout.confirm('99', q._id, q.fingerprint), balance = await h.wallets.balance('99');
  assert.equal(result.order.fundingStatus, 'reserved'); assert.equal(balance.balanceMinor, 10000000); assert.equal(balance.reservedMinor, result.order.totalMinor);
  assert.equal(balance.availableMinor, balance.balanceMinor - result.order.totalMinor);
  assert.equal((await Wallet.findOne({ user: h.user._id })).balanceMinor, 1234567); assert.equal(await WalletTransaction.countDocuments(), 0);
});
test('concurrent confirmations and cancellations reserve/release once, replay never reserves again', async () => {
  const h = await setup(); await h.fund(); const q = await h.quote();
  const confirmations = await Promise.all([h.checkout.confirm('99', q._id, q.fingerprint), h.checkout.confirm('99', q._id, q.fingerprint)]);
  const id = String(confirmations[0].order._id); assert.equal(String(confirmations[1].order._id), id);
  assert.equal(await SandboxWalletTransaction.countDocuments({ type: 'reserve' }), 1);
  await assert.rejects(h.checkout.cancel('98', id), { code: 'ORDER_NOT_FOUND' });
  const snapshot = confirmations[0].order.pricingSnapshot;
  await Promise.all([h.checkout.cancel('99', id), h.checkout.cancel('99', id)]);
  assert.equal(await SandboxWalletTransaction.countDocuments({ type: 'release' }), 1);
  assert.equal((await h.wallets.balance('99')).reservedMinor, 0);
  const replay = await h.checkout.confirm('99', q._id, q.fingerprint); assert.equal(replay.order.status, 'cancelled'); assert.deepEqual(replay.order.pricingSnapshot, snapshot);
  assert.equal(await SandboxWalletTransaction.countDocuments({ type: 'reserve' }), 1);
});
test('different concurrent orders cannot overspend a shared available balance', async () => {
  const h = await setup(); await h.fund('20000'); const first = await h.quote(), second = await h.quote();
  const results = await Promise.allSettled([h.checkout.confirm('99', first._id, first.fingerprint), h.checkout.confirm('99', second._id, second.fingerprint)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'INSUFFICIENT_SANDBOX_BALANCE');
  assert.equal(await Order.countDocuments(), 1); const balance = await h.wallets.balance('99'); assert.ok(balance.availableMinor >= 0);
});
test('repricing and supplier failure reserve nothing; confirmation uses the newly accepted total', async () => {
  const h = await setup(); await h.fund(); const q = await h.quote();
  h.state.fail = true; await assert.rejects(h.checkout.confirm('99', q._id, q.fingerprint), { code: 'SUPPLIER_UNAVAILABLE' });
  assert.equal((await h.wallets.balance('99')).reservedMinor, 0); h.state.fail = false;
  h.state.catalog.categories[0].products[0].variants[0].price += 1000;
  const changed = await h.checkout.confirm('99', q._id, q.fingerprint); assert.equal(changed.status, 'changed'); assert.equal((await h.wallets.balance('99')).reservedMinor, 0);
  const result = await h.checkout.confirm('99', q._id, changed.quote.fingerprint);
  assert.equal((await h.wallets.balance('99')).reservedMinor, result.order.totalMinor); assert.notEqual(result.order.totalMinor, q.snapshot.totalMinor);
});
test('reservation expiry survives restart and races safely with customer cancellation', async () => {
  const h = await setup(); await h.fund(); const q = await h.quote(), { order } = await h.checkout.confirm('99', q._id, q.fingerprint);
  h.advance(30 * 60000);
  const restarted = new CheckoutService(h.pricing, h.supplier, { now: h.clock, wallets: new SandboxWalletService() });
  await Promise.all([restarted.releaseExpired(), h.checkout.cancel('99', String(order._id))]);
  assert.equal((await h.wallets.balance('99')).reservedMinor, 0); assert.equal(await SandboxWalletTransaction.countDocuments({ type: 'release' }), 1);
  const stored = await Order.findById(order._id); assert.equal(stored.status, 'cancelled'); assert.equal(stored.fundingStatus, 'released');
  assert.equal(await restarted.releaseExpired(), 0);
});
test('customer pagination and admin payment history use stable bounded pages without foreign rows', async () => {
  const h = await setup(); for (let i = 0; i < 7; i++) await h.fund('1000'); await h.fund('2000', '98');
  assert.equal((await h.payments.list('99')).items.length, 5); assert.equal((await h.payments.list('99', { page: 1 })).items.length, 2);
  assert.equal((await h.payments.list('42', { admin: true, all: true })).total, 8); assert.equal((await h.payments.list('42', { admin: true })).total, 0);
  assert.equal((await h.wallets.history('99', 1)).items.length, 2); assert.equal((await h.wallets.history('98')).total, 1);
  assert.equal((await h.checkout.listOrders('98')).total, 0);
});
test('older sandbox orders without a reservation can be cancelled without a wallet migration', async () => {
  const h = await setup(), oldCheckout = new CheckoutService(h.pricing, h.supplier, { now: h.clock });
  const q = await oldCheckout.create('99', h.variant._id, 1), { order } = await oldCheckout.confirm('99', q._id, q.fingerprint);
  assert.equal(await SandboxWallet.countDocuments(), 0);
  await h.checkout.cancel('99', String(order._id));
  assert.equal((await h.wallets.balance('99')).balanceMinor, 0); assert.equal(await SandboxWalletTransaction.countDocuments(), 0);
});
