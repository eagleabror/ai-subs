import mongoose from 'mongoose';
import { nonnegativeInteger } from './fields.js';
// Existing legacy orders stay intact. Phase 3 only creates sandbox_confirmed orders.
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
  idempotencyKey: { type: String, required: true, unique: true },
}, { timestamps: true });
export const Order = mongoose.model('Order', schema);
