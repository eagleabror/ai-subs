import mongoose from 'mongoose';
import { nonnegativeInteger } from './fields.js';
export const SUPPLIER_STATES = ['pending_payment','payment_confirmed','supplier_quote_pending','supplier_quoted','supplier_ordering','supplier_processing','completed','manual_review','failed','refunded'];
const schema = new mongoose.Schema({
  _id: String, user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  telegramId: { type: String, required: true, immutable: true }, mode: { type: String, enum: ['sandbox'], default: 'sandbox', immutable: true },
  source: { type: String, enum: ['lightstore','mock'], required: true, immutable: true },
  state: { type: String, enum: SUPPLIER_STATES, default: 'pending_payment', required: true }, version: { type: Number, default: 0 },
  product: String, variant: String, supplierProductId: String, supplierVariantId: String, channel: { type: String, enum: ['standard','games'] },
  title: String, productType: String, deliveryKind: String, fulfillmentMode: String, quantity: nonnegativeInteger({ min: 1, required: true }), region: String,
  requestId: { type: String, required: true, unique: true, immutable: true }, supplierQuoteId: String, supplierOrderId: String,
  quoteExpiresAt: Date, quoteFingerprint: String, supplierCostMinor: nonnegativeInteger(), supplierBalanceMinor: nonnegativeInteger(),
  priceSnapshot: mongoose.Schema.Types.Mixed, confirmedSnapshot: mongoose.Schema.Types.Mixed, expectedProfitMinor: nonnegativeInteger(),
  baseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  reservationReleasedAt: Date,
  sealedRequest: { type: String, select: false }, sealedInputs: { type: String, select: false }, sealedDelivery: { type: String, select: false },
  inputNames: [String], errorCode: String, submitAttempts: { type: Number, default: 0 }, reconcileAttempts: { type: Number, default: 0 },
  lockToken: String, lockUntil: Date, nextAttemptAt: Date, lastAttemptAt: Date,
  deliveryStatus: { type: String, enum: ['none','ready','sending','sent','uncertain','manual'], default: 'none' },
  deliveryAttemptAt: Date, deliveredAt: Date, deliveryMessageIds: [Number],
  timeline: [{ _id: false, state: { type: String, enum: SUPPLIER_STATES }, at: Date, code: String }],
}, { timestamps: true });
schema.index({ source: 1, channel: 1, supplierOrderId: 1 }, { unique: true, partialFilterExpression: { supplierOrderId: { $type: 'string' } } });
schema.index({ state: 1, nextAttemptAt: 1, lockUntil: 1 });
schema.index({ telegramId: 1, createdAt: -1 });
schema.index({ deliveryStatus: 1, deliveryAttemptAt: 1 });
export const SupplierOrder = mongoose.model('SupplierOrder', schema);
export const SupplierBudget = mongoose.model('SupplierBudget', new mongoose.Schema({ _id: String, nextRequestAt: Date, nextPurchaseAt: Date, blockedUntil: Date, revision: { type: Number, default: 0 } }));
