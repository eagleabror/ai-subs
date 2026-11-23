import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { PaymentRequest } from '../models/index.js';
import { decimal, minorInteger } from '../utils/decimal.js';
import { WalletError, pageIndex, validObjectId } from './sandbox-wallet.service.js';
export const TOPUP_MIN_UZS = '1000', TOPUP_MAX_UZS = '10000000';
export function parseTopup(value) {
  try {
    // A decimal string only: never round a client amount or parse exponent/hex syntax.
    if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) throw new Error();
    const d = decimal(value, { positive: true });
    if (d.n * 100n % d.d || d.n < BigInt(TOPUP_MIN_UZS) * d.d || d.n > BigInt(TOPUP_MAX_UZS) * d.d) throw new Error();
    return minorInteger(d.n * 100n / d.d);
  } catch { throw new WalletError('TOPUP_INVALID'); }
}
export class PaymentService {
  constructor(wallets, adminIds, { now = () => new Date(), ttlMs = 24 * 3600000 } = {}) {
    this.wallets = wallets; this.admins = new Set(String(adminIds).split(',').map(id => id.trim()).filter(id => /^[1-9]\d*$/.test(id))); this.now = now; this.ttlMs = ttlMs;
  }
  async init() { await this.wallets.init(); await PaymentRequest.init(); }
  authorize(actor) { if (!this.admins.has(String(actor))) throw new WalletError('ADMIN_ONLY'); }
  async expirePending() { await PaymentRequest.updateMany({ status: 'pending', expiresAt: { $lte: this.now() } }, { $set: { status: 'expired', decidedBy: 'system:expiry', decidedAt: this.now() } }); }
  async request(telegramId, amountUzs, token) {
    const amountMinor = parseTopup(amountUzs);
    if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(token)) throw new WalletError('INVALID_REQUEST');
    const user = await this.wallets.account(telegramId);
    const requestKey = createHash('sha256').update(`${user._id}:${token}`).digest('hex');
    let result;
    await mongoose.connection.transaction(async session => {
      await this.wallets.lock(user._id, session);
      const existing = await PaymentRequest.findOne({ requestKey }).session(session).lean();
      if (existing) { if (existing.amountMinor !== amountMinor) throw new WalletError('IDEMPOTENCY_CONFLICT'); result = existing; return; }
      await PaymentRequest.updateMany({ user: user._id, status: 'pending', expiresAt: { $lte: this.now() } }, { $set: { status: 'expired', decidedBy: 'system:expiry', decidedAt: this.now() } }, { session });
      if (await PaymentRequest.exists({ user: user._id, status: 'pending' }).session(session)) throw new WalletError('PAYMENT_PENDING');
      const [payment] = await PaymentRequest.create([{ user: user._id, telegramId: String(telegramId), amountMinor, requestKey, expiresAt: new Date(this.now().getTime() + this.ttlMs) }], { session });
      result = payment.toObject();
    });
    return result;
  }
  async list(telegramId, { admin = false, page = 0, all = false } = {}) {
    let filter;
    if (admin) { this.authorize(telegramId); filter = all ? {} : { status: 'pending' }; }
    else { const user = await this.wallets.account(telegramId); filter = { user: user._id }; }
    await this.expirePending();
    const total = await PaymentRequest.countDocuments(filter), pages = Math.max(1, Math.ceil(total / 5)), current = Math.min(pageIndex(page), pages - 1);
    return { items: await PaymentRequest.find(filter).sort({ createdAt: -1, _id: -1 }).skip(current * 5).limit(5).lean(), total, pages, page: current };
  }
  async get(actor, id, { admin = false } = {}) {
    if (admin) this.authorize(actor);
    if (!validObjectId(id)) throw new WalletError('PAYMENT_NOT_FOUND');
    const payment = await PaymentRequest.findOne({ _id: id, ...(admin ? {} : { telegramId: String(actor) }) }).lean();
    if (!payment) throw new WalletError('PAYMENT_NOT_FOUND');
    return payment;
  }
  async decide(actor, id, decision) {
    if (!['approved', 'rejected', 'cancelled'].includes(decision)) throw new WalletError('INVALID_REQUEST');
    const admin = decision !== 'cancelled';
    const initial = await this.get(actor, id, { admin });
    let result;
    await mongoose.connection.transaction(async session => {
      const wallet = await this.wallets.lock(initial.user, session);
      const payment = await PaymentRequest.findById(id).session(session).lean();
      if (payment.status !== 'pending') {
        if (payment.status === decision || payment.status === 'expired') { result = payment; return; }
        throw new WalletError('PAYMENT_ALREADY_DECIDED');
      }
      const expired = payment.expiresAt <= this.now(), status = expired ? 'expired' : decision;
      if (status === 'approved') await this.wallets.apply(wallet, { type: 'credit', amountMinor: payment.amountMinor, payment: payment._id,
        actorId: actor, reason: 'payment_approved', idempotencyKey: `payment:${id}:credit` }, session);
      result = await PaymentRequest.findByIdAndUpdate(id, { $set: { status, decidedBy: expired ? 'system:expiry' : String(actor), decidedAt: this.now() } }, { new: true, session }).lean();
    });
    return result;
  }
}
