import mongoose from 'mongoose';
const nonnegativeInteger = (extra = {}) => ({ type: Number, min: 0, validate: value => value == null || Number.isSafeInteger(value), ...extra });
const common = {
  _id: { type: String, required: true }, key: { type: String, required: true, unique: true },
  source: { type: String, enum: ['catalog','games'], required: true }, title: { type: String, required: true },
  present: { type: Boolean, default: true }, seenRun: String, syncedAt: Date,
};
const input = new mongoose.Schema({ name: String, label: String, type: { type: String, enum: ['text','number','select','url','email'] }, required: Boolean, origin: String, options: [String], min: Number, max: Number }, { _id: false });
const category = new mongoose.Schema({ ...common, supplierCategoryId: String, kind: String }, { timestamps: true });
category.index({ source: 1, present: 1, title: 1, _id: 1 });
const product = new mongoose.Schema({ ...common, category: { type: String, required: true }, supplierProductId: String,
  kind: { type: String, required: true }, hidden: { type: Boolean, default: false }, enabled: { type: Boolean, default: true }, markupOverride: { type: String, default: null },
  detailsLoaded: { type: Boolean, default: false }, detailsSyncedAt: Date, detailErrorCode: String, giftAvailable: Boolean, keyAvailable: Boolean, regionsCount: Number, refillMetadata: mongoose.Schema.Types.Mixed, discoveryPriceMinor: Number, currency: String,
  quoteRequired: Boolean, inputSchema: [input],
}, { timestamps: true });
product.index({ category: 1, present: 1, hidden: 1, enabled: 1, title: 1, _id: 1 });
const variant = new mongoose.Schema({ ...common, product: { type: String, required: true }, category: { type: String, required: true },
  supplierProductId: String, supplierVariantId: { type: String, required: true }, packageId: Number, positionId: Number, region: String,
  supplierPriceMinor: nonnegativeInteger({ required: true }), currency: { type: String, enum: ['RUB'], required: true },
  stock: nonnegativeInteger({ default: null }), available: { type: Boolean, default: null }, maxQuantity: nonnegativeInteger({ default: null }),
  delivery: String, inputComplete: Boolean, inputSchema: [input], serverOptions: [{ _id: false, value: String, label: String }], quoteRequired: Boolean,
  sellingPriceMinor: nonnegativeInteger({ default: null }), sellingCurrency: { type: String, default: 'UZS' }, pricedAt: Date,
}, { timestamps: true });
variant.index({ product: 1, present: 1, title: 1, _id: 1 });
export const CatalogCategory = mongoose.model('CatalogCategory', category);
export const CatalogProduct = mongoose.model('CatalogProduct', product);
export const CatalogVariant = mongoose.model('CatalogVariant', variant);
export const CatalogSyncState = mongoose.model('CatalogSyncState', new mongoose.Schema({
  _id: String, owner: String, lockUntil: Date, lastAttempt: Date, lastSuccess: Date, errorCode: String, detailLastSuccess: Date, detailErrorCode: String, unsupportedTypes: [String],
}, { timestamps: true }));
export const PricingSettings = mongoose.model('PricingSettings', new mongoose.Schema({ _id: String, markup: String }, { timestamps: true }));
