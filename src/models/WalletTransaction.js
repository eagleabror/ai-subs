import mongoose from 'mongoose';
import { nonnegativeInteger } from './fields.js';
// Future ledger schema only. Phase 1 has no transaction writer.
const schema = new mongoose.Schema({
  wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  type: { type: String, enum: ['credit', 'debit', 'refund'], required: true },
  amountMinor: nonnegativeInteger({ required: true, min: 1 }),
  currency: { type: String, enum: ['UZS'], default: 'UZS', required: true },
  idempotencyKey: { type: String, required: true, unique: true },
}, { timestamps: true });
export const WalletTransaction = mongoose.model('WalletTransaction', schema);
