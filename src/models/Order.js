import mongoose from 'mongoose';
import { nonnegativeInteger } from './fields.js';
// Phase 1 only defines the schema; no route or bot handler creates orders.
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: nonnegativeInteger({ required: true, min: 1, default: 1 }),
  totalMinor: nonnegativeInteger({ required: true }),
  currency: { type: String, enum: ['UZS'], default: 'UZS', required: true },
  status: { type: String, enum: ['draft', 'cancelled'], default: 'draft', required: true },
  idempotencyKey: { type: String, required: true, unique: true },
}, { timestamps: true });
export const Order = mongoose.model('Order', schema);
