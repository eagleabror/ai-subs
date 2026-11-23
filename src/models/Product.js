import mongoose from 'mongoose';
import { nonnegativeInteger } from './fields.js';
// One document represents one supplier variant. Prices are RUB kopecks.
const schema = new mongoose.Schema({
  supplier: { type: String, enum: ['lightstore'], default: 'lightstore', required: true },
  supplierProductId: nonnegativeInteger({ required: true }),
  supplierVariantId: nonnegativeInteger({ required: true }),
  title: { type: String, required: true },
  variantTitle: { type: String, required: true },
  supplierPriceMinor: nonnegativeInteger({ required: true }),
  currency: { type: String, enum: ['RUB'], default: 'RUB', required: true },
  stock: nonnegativeInteger({ required: true }),
  available: { type: Boolean, required: true },
  syncedAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ supplier: 1, supplierVariantId: 1 }, { unique: true });
export const Product = mongoose.model('Product', schema);
