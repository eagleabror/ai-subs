import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { CatalogCategory as Category, CatalogProduct as Product, CatalogVariant as Variant, CatalogSyncState as SyncState, PricingSettings } from '../models/Catalog.js';
import { LightStoreError } from './catalog/error.js';
import { pricingConfig, sellingPrice, validMarkup } from './pricing.service.js';

export const PAGE_SIZE = 6;
export function pageNumber(value) { return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Math.min(Number(value), 100000) : 0; }
export const escapeSearch = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visible = { present: true, hidden: false, enabled: true };
const safeError = error => error instanceof LightStoreError ? `${error.code}${error.status ? `_${error.status}` : ''}` : 'DATABASE_ERROR';

export class CatalogService {
  #supplier;
  #pricing;
  #pending;
  #fullPending;
  constructor(supplier, pricing = pricingConfig()) { this.#supplier = supplier; this.#pricing = pricing; }
  async #locked(scope, work) {
    try { await SyncState.updateOne({ _id: scope }, { $setOnInsert: { lockUntil: new Date(0) } }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
    const owner = randomUUID(), now = new Date();
    const lease = await SyncState.findOneAndUpdate({ _id: scope, lockUntil: { $lte: now } }, {
      $set: { owner, lockUntil: new Date(Date.now() + 300000), lastAttempt: now },
    }, { new: true }).lean();
    if (!lease) throw new LightStoreError('SYNC_BUSY');
    try {
      const snapshot = await work.fetch();
      await mongoose.connection.transaction(async session => {
        // Fence stale writers, including a worker whose supplier read outlived the lease.
        const fence = await SyncState.updateOne({ _id: scope, owner, lockUntil: { $gt: new Date() } }, { $set: work.detail ? { detailLastSuccess: new Date(), detailErrorCode: null } : { lastSuccess: new Date(), errorCode: null, unsupportedTypes: snapshot.unsupportedTypes || [] } }, { session });
        if (fence.matchedCount !== 1) throw new LightStoreError('SYNC_BUSY');
        await work.save(snapshot, session);
      });
      return { scope, ok: true };
    } catch (error) {
      await SyncState.updateOne({ _id: scope, owner }, { $set: { [work.detail ? 'detailErrorCode' : 'errorCode']: safeError(error) } });
      throw error;
    } finally {
      await SyncState.updateOne({ _id: scope, owner }, { $set: { lockUntil: new Date(0) }, $unset: { owner: 1 } });
    }
  }
  async #upsert(Model, rows, run, session, extra = {}) {
    if (!rows.length) return;
    // Adapters own the supplier fields; never include local admin fields in $set.
    await Model.bulkWrite(rows.map(row => {
      const { _id, ...data } = row;
      return { updateOne: { filter: { _id }, update: { $set: { ...data, ...extra, present: true, seenRun: run, syncedAt: new Date() } }, upsert: true } };
    }), { session });
  }
  async #saveVariants(snapshot, run, session) {
    const settings = await PricingSettings.findById('global').session(session).lean() || {};
    const productIds = [...new Set(snapshot.variants.map(v => v.product))];
    const products = new Map((await Product.find({ _id: { $in: productIds } }).session(session).lean()).map(p => [p._id, p]));
    const rows = snapshot.variants.map(v => ({ ...v, sellingPriceMinor: v.quoteRequired ? null : sellingPrice(v.supplierPriceMinor, this.#pricing, products.get(v.product), settings)?.unitMinor ?? null, pricedAt: new Date() }));
    await this.#upsert(Variant, rows, run, session);
  }
  async syncSource(source) {
    if (!['catalog','games'].includes(source)) throw new LightStoreError('INVALID_SCHEMA');
    return this.#locked(source, {
      fetch: () => source === 'catalog' ? this.#supplier.getCatalogSnapshot() : this.#supplier.getGamesCatalog(),
      save: async (snapshot, session) => {
        const run = randomUUID();
        await this.#upsert(Category, snapshot.categories, run, session);
        await this.#upsert(Product, snapshot.products, run, session);
        await this.#saveVariants(snapshot, run, session);
        for (const Model of [Category, Product]) await Model.updateMany({ source, seenRun: { $ne: run } }, { $set: { present: false } }, { session });
        if (source === 'catalog') await Variant.updateMany({ source, seenRun: { $ne: run } }, { $set: { present: false, available: false, sellingPriceMinor: null } }, { session });
        else {
          const removed = await Product.find({ source, present: false }).session(session).distinct('_id');
          await Variant.updateMany({ source, product: { $in: removed } }, { $set: { present: false, available: false, sellingPriceMinor: null } }, { session });
        }
      },
    });
  }
  async sync() {
    if (!this.#pending) this.#pending = (async () => {
      const results = [];
      for (const source of ['catalog','games']) {
        try { results.push(await this.syncSource(source)); }
        catch (error) { results.push({ scope: source, ok: false, error: safeError(error) }); }
      }
      return results;
    })().finally(() => { this.#pending = undefined; });
    return this.#pending;
  }
  async syncAll() {
    if (!this.#fullPending) this.#fullPending = (async () => {
      const sources = await this.sync();
      const result = { sources, loaded: 0, errors: 0 };
      if (sources.find(s => s.scope === 'games')?.ok) {
        // Stream all discovered products; each detail snapshot commits independently.
        // No hardcoded product list and no transaction spanning slow network reads.
        const cursor = Product.find({ source: 'games', present: true, kind: { $ne: 'steam_refill' } }).sort({ _id: 1 }).lean().cursor();
        try {
          for await (const product of cursor) {
            try { await this.refreshDetails(product._id, { adminSync: true }); result.loaded++; }
            catch { result.errors++; }
          }
        } finally { await cursor.close(); }
      }
      return result;
    })().finally(() => { this.#fullPending = undefined; });
    return this.#fullPending;
  }
  async #page(Model, filter, page) {
    const total = await Model.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(pageNumber(page), pages - 1);
    const items = await Model.find(filter).sort({ title: 1, _id: 1 }).skip(current * PAGE_SIZE).limit(PAGE_SIZE).lean();
    return { items, total, page: current, pages };
  }
  categories(page = 0) { return this.#page(Category, { present: true }, page); }
  async products(category, page = 0) {
    if (!await Category.exists({ _id: category, present: true })) return null;
    return this.#page(Product, { ...visible, category }, page);
  }
  search(query, page = 0) {
    const text = String(query).trim().slice(0, 80);
    if (!text) return Promise.resolve({ items: [], total: 0, page: 0, pages: 1 });
    return this.#page(Product, { ...visible, title: { $regex: escapeSearch(text), $options: 'i' } }, page);
  }
  async product(id) { return Product.findOne({ _id: id, ...visible }).lean(); }
  async refreshDetails(id, { adminSync = false } = {}) {
    const product = adminSync ? await Product.findOne({ _id: id, present: true }).lean() : await this.product(id);
    if (!product || product.source !== 'games' || product.kind === 'steam_refill') return product;
    if (product.detailsSyncedAt && Date.now() - product.detailsSyncedAt.getTime() < 30000) return product;
    // Same games lease as root synchronization: no removed-product resurrection race.
    try { await this.#locked('games', {
      detail: true,
      fetch: () => this.#supplier.getGameDetails(product),
      save: async (snapshot, session) => {
        if (!await Product.exists({ _id: id, ...(adminSync ? { present: true } : visible) }).session(session)) throw new LightStoreError('UNAVAILABLE');
        const run = randomUUID();
        await this.#saveVariants(snapshot, run, session);
        await Variant.updateMany({ product: id, seenRun: { $ne: run } }, { $set: { present: false, available: false, sellingPriceMinor: null } }, { session });
        await Product.updateOne({ _id: id }, { $set: { detailsLoaded: true, detailsSyncedAt: new Date(), detailErrorCode: null } }, { session });
      },
    }); } catch (error) {
      await Product.updateOne({ _id: id }, { $set: { detailErrorCode: safeError(error) } });
      throw error;
    }
    return this.product(id);
  }
  async variants(productId, page = 0) {
    let refreshError = null;
    try { await this.refreshDetails(productId); } catch (error) { refreshError = safeError(error); }
    const product = await this.product(productId);
    if (!product) return null;
    return { ...await this.#page(Variant, { product: productId, present: true }, page), product, refreshError };
  }
  async detail(id, quantity = 1) {
    let variant = await Variant.findOne({ _id: id, present: true }).lean();
    if (!variant) return null;
    let refreshError = null;
    try { await this.refreshDetails(variant.product); } catch (error) { refreshError = safeError(error); }
    variant = await Variant.findOne({ _id: id, present: true }).lean();
    if (!variant) return null;
    const product = await this.product(variant.product);
    if (!product) return null;
    const settings = await PricingSettings.findById('global').lean() || {};
    const price = variant.quoteRequired ? null : sellingPrice(variant.supplierPriceMinor, this.#pricing, product, settings, quantity);
    const stale = !variant.syncedAt || Date.now() - variant.syncedAt.getTime() > 15 * 60 * 1000;
    const maximum = Math.min(99, variant.stock ?? 99, variant.maxQuantity ?? 99);
    const selectable = !refreshError && !stale && price !== null && variant.available !== false && maximum > 0 && variant.inputComplete === true && !variant.quoteRequired;
    await Variant.updateOne({ _id: id }, { $set: { sellingPriceMinor: price?.unitMinor ?? null, pricedAt: new Date() } });
    return { product, variant, price, maximum, stale, refreshError, selectable: selectable && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= maximum, quantity };
  }
  async status() {
    const [categories, products, variants, detailsLoaded, states, detailErrors] = await Promise.all([
      Category.countDocuments({ present: true }), Product.countDocuments({ present: true }), Variant.countDocuments({ present: true }),
      Product.countDocuments({ source: 'games', present: true, detailsLoaded: true }), SyncState.find().lean(),
      Product.countDocuments({ present: true, detailErrorCode: { $type: 'string' } }),
    ]);
    return { categories, products, variants, detailsLoaded, states, detailErrors, fullSyncRunning: Boolean(this.#fullPending) };
  }
  async pricingSettings() { return { ...this.#pricing, ...(await PricingSettings.findById('global').lean() || {}) }; }
  async setMarkup(value, productKey) {
    if (!validMarkup(value)) return false;
    if (productKey) {
      const product = await Product.findOneAndUpdate({ key: productKey }, { $set: { markupOverride: value } }, { new: true });
      if (!product) return false;
      await Variant.updateMany({ product: product._id }, { $set: { sellingPriceMinor: null } });
    } else {
      await PricingSettings.updateOne({ _id: 'global' }, { $set: { markup: value } }, { upsert: true });
      await Variant.updateMany({}, { $set: { sellingPriceMinor: null } });
    }
    return true;
  }
  adminProducts(query) {
    const regex = { $regex: escapeSearch(query.slice(0, 80)), $options: 'i' };
    return Product.find({ $or: [{ title: regex }, { key: regex }] }).sort({ title: 1, _id: 1 }).limit(6).lean();
  }
  async setProductEnabled(key, enabled) {
    return (await Product.updateOne({ key }, { $set: { enabled, hidden: !enabled } })).matchedCount === 1;
  }
}
