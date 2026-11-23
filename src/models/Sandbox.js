import mongoose from 'mongoose';
import { nonnegativeInteger } from './fields.js';

// Deliberately separate collections: these amounts are test credits, never customer money.
const walletSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, immutable: true },
  currency: { type: String, enum: ['UZS'], default: 'UZS', immutable: true },
  balanceMinor: nonnegativeInteger({ required: true, default: 0 }),
  reservedMinor: nonnegativeInteger({ required: true, default: 0 }),
  revision: nonnegativeInteger({ required: true, default: 0 }),
}, { timestamps: true });
export const SandboxWallet = mongoose.model('SandboxWallet', walletSchema);

const paymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  telegramId: { type: String, required: true, immutable: true },
  amountMinor: nonnegativeInteger({ required: true, min: 1, immutable: true }),
  currency: { type: String, enum: ['UZS'], default: 'UZS', immutable: true },
  provider: { type: String, enum: ['sandbox'], default: 'sandbox', immutable: true },
  requestKey: { type: String, required: true, unique: true, immutable: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled', 'expired'], default: 'pending', required: true },
  expiresAt: { type: Date, required: true, immutable: true },
  decidedBy: String, decidedAt: Date,
}, { timestamps: true });
paymentSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
paymentSchema.index({ status: 1, createdAt: -1, _id: -1 });
export const PaymentRequest = mongoose.model('PaymentRequest', paymentSchema);

const transactionSchema = new mongoose.Schema({
  wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'SandboxWallet', required: true, immutable: true },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentRequest', immutable: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', immutable: true },
  type: { type: String, enum: ['credit', 'reserve', 'release'], required: true, immutable: true },
  amountMinor: nonnegativeInteger({ required: true, min: 1, immutable: true }),
  balanceAfterMinor: nonnegativeInteger({ required: true, immutable: true }),
  reservedAfterMinor: nonnegativeInteger({ required: true, immutable: true }),
  currency: { type: String, enum: ['UZS'], default: 'UZS', immutable: true },
  actorId: { type: String, required: true, immutable: true },
  reason: { type: String, enum: ['payment_approved', 'order_confirmed', 'customer_cancelled', 'reservation_expired'], required: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
}, { timestamps: true });
transactionSchema.index({ wallet: 1, createdAt: -1, _id: -1 });
export const SandboxWalletTransaction = mongoose.model('SandboxWalletTransaction', transactionSchema);
