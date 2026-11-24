import mongoose from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import { SupplierOrder, User, Order, CatalogProduct, CatalogVariant } from '../models/index.js';
import { buildOffer, fieldsFor } from './supplier/adapters.js';
import { purchaseRequest } from './supplier/contracts.js';
import { fencePricing } from './pricing/revision.js';
import { minorInteger } from '../utils/decimal.js';
import { pageIndex } from './sandbox-wallet.service.js';
export class FulfillmentError extends Error { constructor(code) { super(code); this.code = code; this.name = 'FulfillmentError'; } }
const reject = code => { throw new FulfillmentError(code); };
const codes = new Set(['TIMEOUT','NETWORK_ERROR','INVALID_SCHEMA','INVALID_JSON','BUSY','REAL_PURCHASE_DISABLED','UNSUPPORTED_PRODUCT','INPUT_MAPPING_UNDOCUMENTED','SENSITIVE_INPUT_UNSUPPORTED','INVALID_INPUT','MISSING_INPUT','UNSUPPORTED_REGION','INVALID_QUANTITY','QUANTITY_UNDOCUMENTED','OUT_OF_STOCK','SUPPLIER_DISABLED','INSUFFICIENT_SUPPLIER_BALANCE','PRICE_UNAVAILABLE','QUOTE_EXPIRED','PRODUCT_UNAVAILABLE','FULFILLMENT_KEY_REQUIRED','FULFILLMENT_DECRYPT_FAILED']);
export const fulfillmentErrorCode = e => [401,402,403,404,409,429,503].includes(e?.status) ? `HTTP_${e.status}` : codes.has(e?.code || e?.message) ? e.code || e.message : 'SUPPLIER_UNAVAILABLE';
const transitions = {
  pending_payment: ['supplier_quote_pending'], supplier_quote_pending: ['supplier_quoted','failed','manual_review'],
  supplier_quoted: ['supplier_quoted','payment_confirmed','failed'], payment_confirmed: ['supplier_ordering','manual_review'],
  supplier_ordering: ['supplier_processing','completed','manual_review','failed','refunded'], supplier_processing: ['supplier_processing','completed','manual_review','failed','refunded'],
  manual_review: ['manual_review','supplier_processing','completed','refunded'], failed: ['refunded'], completed: [], refunded: [],
};
function fingerprint(price, offer) {
  const { fetchedAt, ...fx } = price.exchangeRate;
  return createHash('sha256').update(JSON.stringify({ ...price, exchangeRate: fx, request: offer.request, quantity: offer.quantity, region: offer.region })).digest('hex');
}
const publicOrder = row => row && Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('sealed') && k !== 'lockToken'));
export class SupplierOrderService {
  constructor({ supplier, pricing, wallets, checkout, cipher, adminIds, now = () => new Date() }) {
    Object.assign(this, { supplier, pricing, wallets, checkout, cipher, now });
    this.admins = new Set(String(adminIds).split(',').map(s => s.trim()).filter(s => /^[1-9]\d*$/.test(s)));
  }
  get simulation() { return this.supplier.mode === 'mock'; }
  authorize(actor) { if (!this.admins.has(String(actor))) reject('ADMIN_ONLY'); }
  async init() { await SupplierOrder.init(); }
  async #transition(id, from, state, patch = {}, { session, token } = {}) {
    if (!transitions[from]?.includes(state)) reject('INVALID_TRANSITION');
    const result = await SupplierOrder.findOneAndUpdate({ _id: id, state: from, ...(token ? { lockToken: token } : {}) }, {
      $set: { ...patch, state, updatedAt: this.now() }, $inc: { version: 1 }, $push: { timeline: { $each: [{ state, at: this.now(), ...(patch.errorCode ? { code: patch.errorCode } : {}) }], $slice: -50 } },
    }, { new: true, session, timestamps: false }).lean();
    if (!result) reject('ORDER_CHANGED');
    return result;
  }
  async #fresh(productId, variantId) {
    const local = await CatalogProduct.findOne({ _id: productId, present: true, hidden: false, enabled: true }).lean();
    if (!local) reject('PRODUCT_UNAVAILABLE');
    let product, variant;
    if (local.source === 'catalog') {
      const catalog = await this.supplier.getCatalogSnapshot({ force: true });
      product = catalog.products.find(p => p._id === productId); variant = catalog.variants.find(v => v._id === variantId && v.product === productId);
    } else {
      const root = await this.supplier.getGamesCatalog({ force: true });
      product = root.products.find(p => p._id === productId);
      if (product && product.kind !== 'steam_refill') variant = (await this.supplier.getGameDetails(product, { force: true })).variants.find(v => v._id === variantId && v.product === productId);
    }
    if (!product || product.kind !== 'steam_refill' && !variant) reject('PRODUCT_UNAVAILABLE');
    return { product, variant };
  }
  async inputSchema(actor, productId, variantId) {
    if (!this.cipher.ready) reject('FULFILLMENT_KEY_REQUIRED');
    if (!await User.exists({ telegramId: String(actor) })) reject('START_REQUIRED');
    const { product, variant } = await this.#fresh(productId, variantId);
    return { fields: fieldsFor(product, variant), title: `${product.title}${variant ? ` · ${variant.title}` : ''}` };
  }
  async #quote(record, inputs) {
    const started = this.now(), { product, variant } = await this.#fresh(record.product, record.variant);
    const offer = buildOffer(product, variant, record.quantity, inputs);
    let cost, balance, quoteId = null, expiresIn = 60;
    if (offer.channel === 'standard') {
      const item = await this.supplier.getCatalogItem(variant.supplierVariantId);
      if (item.id !== variant.supplierVariantId || !item.available || item.stock < record.quantity) reject('OUT_OF_STOCK');
      cost = minorInteger(BigInt(item.price) * BigInt(record.quantity)); balance = await this.supplier.getBalance();
      offer.fulfillmentMode = item.delivery;
    } else {
      if (offer.type === 'refill' && !await this.supplier.checkSteam(offer.inputs.login)) reject('INVALID_INPUT');
      const quote = await this.supplier.quoteGame(offer.request);
      if (!quote.enabled) reject('SUPPLIER_DISABLED');
      cost = quote.price; balance = quote.balance; quoteId = quote.id; expiresIn = quote.expiresIn;
    }
    if (balance < cost) reject('INSUFFICIENT_SUPPLIER_BALANCE');
    const expiresAt = new Date(started.getTime() + expiresIn * 1000);
    if (expiresAt <= this.now()) reject('QUOTE_EXPIRED');
    const price = await this.pricing.supplierTotal(record.product, record.variant, cost);
    if (!price) reject('PRICE_UNAVAILABLE');
    const expectedProfitMinor = minorInteger(BigInt(price.totalMinor) - BigInt(price.bufferedCostMinor));
    return { offer, price, patch: { supplierQuoteId: quoteId, supplierCostMinor: cost, supplierBalanceMinor: balance, quoteExpiresAt: expiresAt,
      title: `${product.title}${variant ? ` · ${variant.title}` : ''}`.slice(0, 400), priceSnapshot: price, expectedProfitMinor, quoteFingerprint: fingerprint(price, offer), channel: offer.channel, productType: offer.type, deliveryKind: offer.delivery,
      fulfillmentMode: offer.fulfillmentMode || 'auto', region: offer.region, supplierProductId: variant?.supplierProductId || product.supplierProductId,
      supplierVariantId: variant?.supplierVariantId || null, inputNames: offer.fields.map(f => f.name),
      sealedRequest: this.cipher.seal(offer.request, `${record._id}:request`) } };
  }
  async preview(actor, { product, variant = null, quantity = 1, inputs = {} }) {
    if (!this.cipher.ready) reject('FULFILLMENT_KEY_REQUIRED');
    const user = await User.findOne({ telegramId: String(actor) }).lean(); if (!user) reject('START_REQUIRED');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) reject('INVALID_QUANTITY');
    if (await SupplierOrder.countDocuments({ telegramId: String(actor), createdAt: { $gt: new Date(this.now().getTime() - 60000) } }) >= 6) reject('BUSY');
    const id = randomUUID();
    let record = await SupplierOrder.create({ _id: id, user: user._id, telegramId: String(actor), product, variant, quantity,
      source: this.simulation ? 'mock' : 'lightstore', requestId: `ais:${id}`, sealedInputs: this.cipher.seal(inputs, `${id}:inputs`), timeline: [{ state: 'pending_payment', at: this.now() }], createdAt: this.now(), updatedAt: this.now() });
    await this.#transition(id, 'pending_payment', 'supplier_quote_pending');
    try {
      const quote = await this.#quote(record.toObject(), inputs);
      record = await this.#transition(id, 'supplier_quote_pending', 'supplier_quoted', quote.patch);
      return publicOrder(record);
    } catch (e) { await this.#transition(id, 'supplier_quote_pending', 'failed', { errorCode: fulfillmentErrorCode(e) }); throw e; }
  }
  async get(actor, id, { admin = false } = {}) {
    if (admin) this.authorize(actor);
    if (typeof id !== 'string' || id.length > 80) reject('ORDER_NOT_FOUND');
    const row = await SupplierOrder.findOne({ _id: id, ...(admin ? {} : { telegramId: String(actor) }) }).lean();
    if (!row) reject('ORDER_NOT_FOUND'); return publicOrder(row);
  }
  async confirmSimulation(actor, id, expectedFingerprint) {
    // No runtime/env/admin setting can treat sandbox credit as real payment.
    if (!this.simulation) reject('REAL_PURCHASE_DISABLED');
    let record = await this.get(actor, id);
    if (record.source !== 'mock') reject('SOURCE_MISMATCH');
    if (record.baseOrder) return record;
    if (record.state !== 'supplier_quoted') reject('ORDER_CHANGED');
    if (record.quoteExpiresAt <= this.now()) reject('QUOTE_EXPIRED');
    const sensitive = await SupplierOrder.findById(id).select('+sealedInputs').lean();
    const quote = await this.#quote(record, this.cipher.open(sensitive.sealedInputs, `${id}:inputs`));
    await this.wallets.account(actor);
    await mongoose.connection.transaction(async session => {
      await fencePricing(session);
      const current = await SupplierOrder.findById(id).session(session).lean();
      if (current.baseOrder) { record = current; return; }
      if (current.state !== 'supplier_quoted' || current.quoteExpiresAt <= this.now() || quote.patch.quoteExpiresAt <= this.now()) reject('QUOTE_EXPIRED');
      const price = await this.pricing.supplierTotal(current.product, current.variant, quote.patch.supplierCostMinor, { session });
      if (!price) reject('PRICE_UNAVAILABLE');
      quote.patch.priceSnapshot = price; quote.patch.quoteFingerprint = fingerprint(price, quote.offer);
      quote.patch.expectedProfitMinor = minorInteger(BigInt(price.totalMinor) - BigInt(price.bufferedCostMinor));
      if (current.quoteFingerprint !== expectedFingerprint || current.quoteFingerprint !== quote.patch.quoteFingerprint) {
        record = await this.#transition(id, 'supplier_quoted', 'supplier_quoted', quote.patch, { session }); return;
      }
      const wallet = await this.wallets.lock(current.user, session);
      const [order] = await Order.create([{ user: current.user, mode: 'sandbox', catalogProduct: current.product, catalogVariant: current.variant || `product:${current.product}`,
        pricingSnapshot: { ...price, itemQuantity: current.quantity, supplierQuoteId: quote.patch.supplierQuoteId, supplierRequestId: current.requestId, variantTitle: quote.patch.title },
        confirmedAt: this.now(), quantity: current.quantity, totalMinor: price.totalMinor, currency: 'UZS', status: 'sandbox_confirmed',
        fundingStatus: price.totalMinor ? 'reserved' : 'unreserved', reservationExpiresAt: new Date(this.now().getTime() + 30 * 60000), idempotencyKey: `fulfillment:${id}` }], { session });
      if (price.totalMinor) await this.wallets.apply(wallet, { type: 'reserve', amountMinor: price.totalMinor, order: order._id, actorId: actor, reason: 'order_confirmed', idempotencyKey: `order:${order._id}:reserve` }, session);
      record = await this.#transition(id, 'supplier_quoted', 'payment_confirmed', { ...quote.patch, baseOrder: order._id, confirmedSnapshot: price }, { session });
    });
    return publicOrder(record);
  }
  async #result(record, result, token) {
    if (record.supplierOrderId && result.id !== record.supplierOrderId || result.price != null && result.price !== record.supplierCostMinor) return this.#transition(record._id, record.state, 'manual_review', { errorCode: 'SUPPLIER_ID_OR_PRICE_MISMATCH', lockUntil: null }, { token });
    let state = { completed: 'completed', refunded: 'refunded', declined: 'refunded', review: 'manual_review', queued: 'supplier_processing', submitting: 'supplier_processing', processing: 'supplier_processing', paid: 'supplier_processing', pending: 'manual_review' }[result.status];
    let delivery = result.delivery;
    if (state === 'completed' && !delivery.length && record.deliveryKind !== 'recharge') state = 'manual_review';
    if (state === 'completed' && !delivery.length) delivery = ['To‘ldirish xizmati bajarildi.'];
    const patch = { supplierOrderId: result.id, lockUntil: null, nextAttemptAt: new Date(this.now().getTime() + 10000), errorCode: state === 'manual_review' ? 'SUPPLIER_REVIEW' : null,
      deliveryStatus: state === 'completed' ? 'ready' : state === 'manual_review' || record.fulfillmentMode === 'manual' ? 'manual' : 'none' };
    if (state === 'completed') patch.sealedDelivery = this.cipher.seal({ kind: record.deliveryKind, values: delivery }, `${record._id}:delivery`);
    const updated = await this.#transition(record._id, record.state, state, patch, { token });
    if (state === 'refunded' && record.baseOrder) {
      try { await this.checkout.cancel(record.telegramId, String(record.baseOrder)); await SupplierOrder.updateOne({ _id: record._id }, { $set: { reservationReleasedAt: this.now() } }); }
      catch { await SupplierOrder.updateOne({ _id: record._id }, { $set: { errorCode: 'RESERVATION_RELEASE_PENDING' } }); }
    }
    return publicOrder(updated);
  }
  async submitSimulation(actor, id) {
    if (!this.simulation) reject('REAL_PURCHASE_DISABLED');
    const owned = await this.get(actor, id);
    if (owned.source !== 'mock') reject('SOURCE_MISMATCH');
    if (owned.state !== 'payment_confirmed') return owned;
    const base = await Order.findOne({ _id: owned.baseOrder, user: owned.user, mode: 'sandbox', status: 'sandbox_confirmed' }).lean();
    if (!base || base.reservationExpiresAt <= this.now()) reject('PAYMENT_UNAVAILABLE');
    if (owned.quoteExpiresAt <= this.now()) {
      return this.#transition(id, 'payment_confirmed', 'manual_review', { errorCode: 'QUOTE_EXPIRED' });
    }
    const token = randomUUID();
    let record;
    try { record = await this.#transition(id, 'payment_confirmed', 'supplier_ordering', { lockToken: token, lockUntil: new Date(this.now().getTime() + 120000), lastAttemptAt: this.now(), submitAttempts: 1 }); }
    catch (e) { if (e.code === 'ORDER_CHANGED') return this.get(actor, id); throw e; }
    try {
      const secure = await SupplierOrder.findById(id).select('+sealedRequest').lean();
      const body = record.channel === 'games' ? { quote_id: record.supplierQuoteId } : this.cipher.open(secure.sealedRequest, `${id}:request`);
      const request = purchaseRequest(record.channel, body, record.requestId);
      const result = await this.supplier.createSupplierOrder(record.channel, request);
      return await this.#result(record, result, token);
    } catch (e) { return this.#attemptError(record, e, token); }
  }
  async #attemptError(record, error, token) {
    const code = fulfillmentErrorCode(error);
    if (['HTTP_401','HTTP_403','HTTP_404','HTTP_409','INVALID_SCHEMA','INVALID_JSON','REAL_PURCHASE_DISABLED','FULFILLMENT_DECRYPT_FAILED'].includes(code)) return this.#transition(record._id, record.state, 'manual_review', { errorCode: code, lockUntil: null }, { token });
    if (code === 'HTTP_402' || code === 'INSUFFICIENT_SUPPLIER_BALANCE') {
      if (record.state !== 'supplier_ordering' || record.supplierOrderId) return this.#transition(record._id, record.state, 'manual_review', { errorCode: code, lockUntil: null }, { token });
      const failed = await this.#transition(record._id, record.state, 'failed', { errorCode: code, lockUntil: null }, { token });
      if (record.baseOrder) { await this.checkout.cancel(record.telegramId, String(record.baseOrder)); return this.#transition(record._id, 'failed', 'refunded', { errorCode: code, reservationReleasedAt: this.now() }); }
      return failed;
    }
    await SupplierOrder.updateOne({ _id: record._id, lockToken: token }, { $set: { errorCode: code, lockUntil: null, nextAttemptAt: new Date(this.now().getTime() + Math.min(300000, 10000 * 2 ** Math.min(record.reconcileAttempts || 0, 5))) } });
    return this.get(record.telegramId, record._id);
  }
  async reconcile(actor, id, { admin = false } = {}) {
    const owned = await this.get(actor, id, { admin });
    if (owned.source !== (this.simulation ? 'mock' : 'lightstore')) reject('SOURCE_MISMATCH');
    if (!['supplier_ordering','supplier_processing','manual_review'].includes(owned.state)) return owned;
    const token = randomUUID(), now = this.now();
    const record = await SupplierOrder.findOneAndUpdate({ _id: id, state: owned.state, $and: [ { $or: [{ lockUntil: null }, { lockUntil: { $lte: now } }] }, { $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] } ] },
      { $set: { lockToken: token, lockUntil: new Date(now.getTime() + 120000), lastAttemptAt: now }, $inc: { reconcileAttempts: 1 } }, { new: true }).lean();
    if (!record) return this.get(owned.telegramId, id);
    try {
      let result;
      if (record.supplierOrderId) result = await this.supplier.getSupplierOrder(record.channel, record.supplierOrderId);
      else {
        await this.supplier.listSupplierOrders(record.channel); // Reconcile first; no undocumented list fields or heuristic matching.
        if (!this.simulation || record.state !== 'supplier_ordering' || record.submitAttempts >= 3) return this.#transition(id, record.state, 'manual_review', { errorCode: 'UNKNOWN_ORDER_ID', lockUntil: null }, { token });
        const secure = await SupplierOrder.findById(id).select('+sealedRequest').lean();
        const body = record.channel === 'games' ? { quote_id: record.supplierQuoteId } : this.cipher.open(secure.sealedRequest, `${id}:request`);
        await SupplierOrder.updateOne({ _id: id, lockToken: token }, { $inc: { submitAttempts: 1 } });
        result = await this.supplier.createSupplierOrder(record.channel, purchaseRequest(record.channel, body, record.requestId));
      }
      return await this.#result(record, result, token);
    } catch (e) { return this.#attemptError(record, e, token); }
  }
  async list(actor, { admin = false, problem = false, delivery = false, page = 0 } = {}) {
    if (admin) this.authorize(actor);
    const filter = { ...(admin ? {} : { telegramId: String(actor) }), ...(problem ? { state: { $in: ['manual_review','failed'] } } : {}), ...(delivery ? { deliveryStatus: { $ne: 'none' } } : {}) };
    const total = await SupplierOrder.countDocuments(filter), pages = Math.max(1, Math.ceil(total / 5)), current = Math.min(pageIndex(page), pages - 1);
    return { items: (await SupplierOrder.find(filter).sort({ createdAt: -1, _id: -1 }).skip(current * 5).limit(5).lean()).map(publicOrder), total, page: current, pages };
  }
  async statistics(actor) {
    this.authorize(actor);
    const rows = await SupplierOrder.aggregate([{ $group: { _id: { source: '$source', state: '$state' }, count: { $sum: 1 } } }]);
    return { rows, realRevenueMinor: 0, automaticPurchases: false, encryptionReady: this.cipher.ready };
  }
  async supplierStatus(actor) { this.authorize(actor); return { balanceMinor: await this.supplier.getBalance(), currency: 'RUB', automaticPurchases: false, encryptionReady: this.cipher.ready }; }
  async tick() {
    // Recover interrupted quotes; no purchase was attempted in these states.
    await SupplierOrder.updateMany({ state: 'supplier_quote_pending', updatedAt: { $lt: new Date(this.now().getTime() - 120000) } }, { $set: { state: 'failed', errorCode: 'QUOTE_INTERRUPTED' }, $inc: { version: 1 }, $push: { timeline: { state: 'failed', at: this.now(), code: 'QUOTE_INTERRUPTED' } } });
    const failed = await SupplierOrder.find({ state: { $in: ['failed','refunded'] }, baseOrder: { $exists: true }, reservationReleasedAt: null }).limit(10).lean();
    for (const record of failed) {
      await this.checkout.cancel(record.telegramId, String(record.baseOrder));
      if (record.state === 'failed') await this.#transition(record._id, 'failed', 'refunded', { reservationReleasedAt: this.now() });
      else await SupplierOrder.updateOne({ _id: record._id }, { $set: { reservationReleasedAt: this.now(), errorCode: null } });
    }
    const pending = await SupplierOrder.find({ source: this.simulation ? 'mock' : 'lightstore', state: { $in: ['supplier_ordering','supplier_processing'] }, $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: this.now() } }] }).limit(5).lean();
    for (const order of pending) await this.reconcile(order.telegramId, order._id);
  }
}
