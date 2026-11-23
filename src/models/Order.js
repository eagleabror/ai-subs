import mongoose from 'mongoose';
import { nonnegativeInteger } from './fields.js';
// Existing legacy orders stay intact. Sandbox reservations never debit real wallets.
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: function () { return this.mode !== 'sandbox'; } },
  mode: { type: String, enum: ['legacy','sandbox'], default: 'legacy', immutable: true },
  catalogProduct: { type: String, immutable: true, required: function () { return this.mode === 'sandbox'; } }, catalogVariant: { type: String, immutable: true, required: function () { return this.mode === 'sandbox'; } },
  pricingSnapshot: { type: mongoose.Schema.Types.Mixed, immutable: true, required: function () { return this.mode === 'sandbox'; } }, confirmedAt: { type: Date, immutable: true },
  quantity: nonnegativeInteger({ required: true, min: 1, default: 1, immutable: true }),
  totalMinor: nonnegativeInteger({ required: true, immutable: true }),
  currency: { type: String, enum: ['UZS'], default: 'UZS', required: true, immutable: true },
  status: { type: String, enum: ['draft', 'cancelled', 'sandbox_confirmed'], default: 'draft', required: true },
  fundingStatus: { type: String, enum: ['unreserved', 'reserved', 'released'], default: 'unreserved' },
  reservationExpiresAt: Date, cancelledAt: Date,
  cancellationReason: { type: String, enum: ['customer_cancelled', 'reservation_expired'] },
  idempotencyKey: { type: String, required: true, unique: true },
}, { timestamps: true });
schema.index({ mode: 1, fundingStatus: 1, reservationExpiresAt: 1 });
export const Order = mongoose.model('Order', schema);
