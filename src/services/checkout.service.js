import mongoose from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import { CheckoutQuote } from '../models/Pricing.js';
import { CatalogVariant, CatalogProduct } from '../models/Catalog.js';
import { User, Order } from '../models/index.js';
import { fencePricing } from './pricing/revision.js';
export class CheckoutError extends Error { constructor(code) { super(code); this.code = code; this.name = 'CheckoutError'; } }
export function quoteFingerprint(snapshot) {
  // A successful refresh of the same effective rate changes fetchedAt but not the offer.
  const { fetchedAt, ...fx } = snapshot.exchangeRate;
  const { supplierStock, supplierMaxQuantity, ...offer } = snapshot;
  return createHash('sha256').update(JSON.stringify({ ...offer, exchangeRate: fx })).digest('hex');
}
export class CheckoutService {
  constructor(pricing, supplier, { now = () => new Date(), ttlMs = 5 * 60000 } = {}) { this.pricing = pricing; this.supplier = supplier; this.now = now; this.ttlMs = ttlMs; }
  async #live(variantId) {
    const v = await CatalogVariant.findById(variantId).lean();
    const p = v && await CatalogProduct.findById(v.product).lean();
    if (!v?.present || !p?.present || p.hidden || !p.enabled) throw new CheckoutError('PRODUCT_UNAVAILABLE');
    let snapshot;
    try { snapshot = p.source === 'catalog' ? await this.supplier.getCatalogSnapshot({ force: true }) : await this.supplier.getGameDetails(p, { force: true }); }
    catch { throw new CheckoutError('SUPPLIER_UNAVAILABLE'); }
    const live = snapshot.variants.find(item => item._id === variantId && item.product === p._id);
    if (!live || live.available === false || live.stock === 0) throw new CheckoutError('PRODUCT_UNAVAILABLE');
    if (live.stock == null || live.available !== true || live.quoteRequired || !live.inputComplete) throw new CheckoutError('SUPPLIER_QUOTE_REQUIRED');
    return live;
  }
  async #snapshot(variantId, quantity, live, session) {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > Math.min(99, live.stock, live.maxQuantity ?? 99)) throw new CheckoutError('STOCK_LIMIT');
    const price = await this.pricing.quote(variantId, quantity, { supplierVariant: live, session });
    if (!price) throw new CheckoutError('PRICE_UNAVAILABLE');
    return { ...price, catalogProduct: live.product, catalogVariant: live._id, supplierProductId: live.supplierProductId,
      supplierVariantId: live.supplierVariantId, supplierStock: live.stock, supplierMaxQuantity: live.maxQuantity,
      variantTitle: live.title, region: live.region || null, delivery: live.delivery || null, inputSchema: live.inputSchema || [], mode: 'sandbox' };
  }
  async create(telegramId, variantId, quantity) {
    if (!await User.exists({ telegramId: String(telegramId) })) throw new CheckoutError('START_REQUIRED');
    const live = await this.#live(variantId);
    let result;
    await mongoose.connection.transaction(async session => {
      await fencePricing(session);
      const snapshot = await this.#snapshot(variantId, quantity, live, session);
      [result] = await CheckoutQuote.create([{ _id: randomUUID(), telegramId: String(telegramId), variantId, quantity,
        snapshot, fingerprint: quoteFingerprint(snapshot), expiresAt: new Date(this.now().getTime() + this.ttlMs) }], { session });
    });
    return result.toObject();
  }
  async confirm(telegramId, quoteId, expectedFingerprint) {
    const quote = await CheckoutQuote.findOne({ _id: quoteId, telegramId: String(telegramId) }).lean();
    if (!quote) throw new CheckoutError('QUOTE_NOT_FOUND');
    if (quote.status === 'confirmed') return { status: 'confirmed', order: await Order.findById(quote.orderId).lean() };
    if (quote.expiresAt <= this.now()) throw new CheckoutError('QUOTE_EXPIRED');
    // Every confirmation re-reads supplier prices and stock, bypassing its 30-second cache.
    const live = await this.#live(quote.variantId);
    let result;
    await mongoose.connection.transaction(async session => {
      await fencePricing(session); // Serialize against admin/FX changes until the order snapshot is committed.
      const current = await CheckoutQuote.findOne({ _id: quoteId, telegramId: String(telegramId) }).session(session).lean();
      if (current.status === 'confirmed') { result = { status: 'confirmed', order: await Order.findById(current.orderId).session(session).lean() }; return; }
      if (current.expiresAt <= this.now()) throw new CheckoutError('QUOTE_EXPIRED');
      const snapshot = await this.#snapshot(current.variantId, current.quantity, live, session), fingerprint = quoteFingerprint(snapshot);
      if (current.fingerprint !== expectedFingerprint || fingerprint !== current.fingerprint) {
        await CheckoutQuote.updateOne({ _id: quoteId }, { $set: { snapshot, fingerprint, expiresAt: new Date(this.now().getTime() + this.ttlMs) } }, { session });
        result = { status: 'changed', quote: { ...current, snapshot, fingerprint } }; return;
      }
      const user = await User.findOne({ telegramId: String(telegramId) }).session(session).lean();
      if (!user) throw new CheckoutError('START_REQUIRED');
      const [order] = await Order.create([{ user: user._id, mode: 'sandbox', catalogProduct: snapshot.catalogProduct, catalogVariant: snapshot.catalogVariant,
        quantity: current.quantity, totalMinor: snapshot.totalMinor, currency: 'UZS', pricingSnapshot: snapshot, confirmedAt: this.now(),
        status: 'sandbox_confirmed', idempotencyKey: `sandbox:${quoteId}` }], { session });
      await CheckoutQuote.updateOne({ _id: quoteId }, { $set: { status: 'confirmed', orderId: order._id } }, { session });
      result = { status: 'confirmed', order: order.toObject() };
      // No Wallet, WalletTransaction, payment provider or supplier purchase writes.
    });
    return result;
  }
  async orders(telegramId) {
    const user = await User.findOne({ telegramId: String(telegramId) }).lean();
    return user ? Order.find({ user: user._id, mode: 'sandbox' }).sort({ createdAt: -1 }).limit(10).lean() : [];
  }
}
