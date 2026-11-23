import mongoose from 'mongoose';
const rate = new mongoose.Schema({
  ccy: { type: String, enum: ['RUB'], required: true }, rate: { type: String, required: true }, nominal: { type: String, required: true },
  numerator: { type: String, required: true }, denominator: { type: String, required: true },
  effectiveDate: { type: String, required: true }, fetchedAt: { type: Date, required: true }, source: { type: String, enum: ['cbu','manual','legacy'], required: true },
}, { _id: false });
export const ExchangeRate = mongoose.model('ExchangeRate', new mongoose.Schema({
  _id: String, mode: { type: String, enum: ['auto','manual','legacy'], required: true }, automatic: rate, manual: rate,
  lastAttempt: Date, lastError: String,
}, { timestamps: true }));
// All pricing mutations and checkout confirmation serialize on this small revision document.
export const PricingRevision = mongoose.model('PricingRevision', new mongoose.Schema({ _id: String, revision: { type: Number, default: 0 }, fence: { type: Number, default: 0 } }));
export const PriceAudit = mongoose.model('PriceAudit', new mongoose.Schema({
  actorId: { type: String, required: true }, action: { type: String, required: true }, scope: String, target: String,
  before: mongoose.Schema.Types.Mixed, after: mongoose.Schema.Types.Mixed,
}, { timestamps: true }));
PriceAudit.schema.index({ createdAt: -1, _id: -1 });
export const CheckoutQuote = mongoose.model('CheckoutQuote', new mongoose.Schema({
  _id: String, telegramId: { type: String, required: true, index: true }, variantId: { type: String, required: true }, quantity: { type: Number, required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true }, fingerprint: { type: String, required: true }, expiresAt: { type: Date, required: true },
  status: { type: String, enum: ['pending','confirmed'], default: 'pending' }, orderId: mongoose.Schema.Types.ObjectId,
}, { timestamps: true }));
