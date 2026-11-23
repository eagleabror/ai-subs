import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { User, Product, Order, Wallet, WalletTransaction } from '../src/models/index.js';
import { userService } from '../src/services/user.service.js';
const id = () => new mongoose.Types.ObjectId();
test('all five models validate required data, money and quantity', () => {
  assert.equal(new User({ telegramId: '42' }).validateSync(), undefined);
  assert.ok(new User({ telegramId: '-42' }).validateSync());
  assert.equal(new Wallet({ user: id() }).balanceMinor, 0);
  for (const amount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.ok(new Wallet({ user: id(), balanceMinor: amount }).validateSync());
  const product = { supplierProductId: 1, supplierVariantId: 2, title: 'Gemini', variantTitle: '6 months', supplierPriceMinor: 12345, stock: 0, available: false, syncedAt: new Date() };
  assert.equal(new Product(product).validateSync(), undefined);
  assert.ok(new Product({ ...product, stock: -1 }).validateSync());
  const order = { user: id(), product: id(), totalMinor: 100, idempotencyKey: 'test' };
  assert.equal(new Order(order).validateSync(), undefined);
  assert.ok(new Order({ ...order, quantity: 0 }).validateSync());
  assert.ok(new Order({ ...order, status: 'paid' }).validateSync());
  assert.equal(new WalletTransaction({ wallet: id(), type: 'credit', amountMinor: 1, idempotencyKey: 'test' }).validateSync(), undefined);
  assert.ok(new WalletTransaction({ wallet: id(), type: 'debit', amountMinor: -1, idempotencyKey: 'test' }).validateSync());
});

test('repeated /start uses insert-only wallet initialization; no balance deduction', async (t) => {
  const user = { _id: id() };
  let wallet;
  t.mock.method(User, 'findOneAndUpdate', async () => user);
  t.mock.method(Wallet, 'updateOne', async (filter, update) => {
    assert.deepEqual(Object.keys(update), ['$setOnInsert']);
    assert.equal(String(filter.user), String(user._id));
    wallet ??= structuredClone(update.$setOnInsert);
  });
  await userService.register({ id: 42, first_name: 'Test' });
  assert.equal(wallet.balanceMinor, 0);
  wallet.balanceMinor = 99900;
  await userService.register({ id: 42, first_name: 'Test' });
  assert.equal(wallet.balanceMinor, 99900);
});
