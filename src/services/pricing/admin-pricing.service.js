import mongoose from 'mongoose';
import { CatalogCategory, CatalogProduct, CatalogVariant, PricingSettings } from '../../models/Catalog.js';
import { ExchangeRate, PriceAudit, PricingRevision } from '../../models/Pricing.js';
import { decimal, inRange } from '../../utils/decimal.js';
import { pageNumber, PAGE_SIZE, escapeSearch } from '../catalog.service.js';
import { fencePricing } from './revision.js';
export class AdminPricingError extends Error { constructor(code) { super(code); this.code = code; this.name = 'AdminPricingError'; } }
const models = { category: CatalogCategory, product: CatalogProduct, variant: CatalogVariant };
export class AdminPricingService {
  constructor(pricing, adminIds, { now = () => new Date() } = {}) { this.pricing = pricing; this.fx = pricing.fx; this.admins = new Set(String(adminIds).split(',').map(id => id.trim())); this.now = now; }
  authorize(actor) { if (!this.admins.has(String(actor))) throw new AdminPricingError('ADMIN_ONLY'); }
  async settings(actor) {
    this.authorize(actor);
    return { config: this.pricing.config, settings: await PricingSettings.findById('global').lean() || {}, fx: await this.fx.current() };
  }
  async list(actor, scope, { parent, query, page = 0 } = {}) {
    this.authorize(actor);
    if (!Object.hasOwn(models, scope)) throw new AdminPricingError('INVALID_CHANGE');
    const filter = {};
    if (scope === 'product' && parent) filter.category = parent;
    if (scope === 'variant' && parent) filter.product = parent;
    if (query) filter.title = { $regex: escapeSearch(String(query).slice(0, 80)), $options: 'i' };
    const Model = models[scope], total = await Model.countDocuments(filter), pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(pageNumber(page), pages - 1);
    return { items: await Model.find(filter).sort({ title: 1, _id: 1 }).skip(current * PAGE_SIZE).limit(PAGE_SIZE).lean(), total, pages, page: current };
  }
  async entity(actor, scope, id) {
    this.authorize(actor);
    if (!Object.hasOwn(models, scope)) throw new AdminPricingError('INVALID_CHANGE');
    return models[scope].findById(id).lean();
  }
  async samples(actor, scope, target, patch) {
    this.authorize(actor);
    const filter = scope === 'variant' ? { _id: target } : scope === 'product' ? { product: target } : scope === 'category' ? { category: target } : {};
    const variants = await CatalogVariant.find(filter).sort({ title: 1, _id: 1 }).limit(3).lean();
    const result = [];
    for (const variant of variants) {
      const context = await this.pricing.context(variant._id, { patch });
      const price = await this.pricing.quote(variant._id, 1, { patch, allowHidden: true });
      result.push({ variant, context, price });
    }
    return result;
  }
  #validate(change) {
    const { scope, target, field, value } = change || {};
    if (!['global','category','product','variant','fx'].includes(scope) || typeof target !== 'string') throw new AdminPricingError('INVALID_CHANGE');
    if (scope === 'fx') {
      if (target !== 'RUB' || (field !== 'mode' && field !== 'manual')) throw new AdminPricingError('INVALID_CHANGE');
      if (field === 'mode' && value !== 'auto') throw new AdminPricingError('INVALID_CHANGE');
      if (field === 'manual') { try { decimal(value, { positive: true }); } catch { throw new AdminPricingError('INVALID_RATE'); } }
      return;
    }
    if (scope !== 'global' && !/^[a-f0-9]{24}$/.test(target)) throw new AdminPricingError('INVALID_CHANGE');
    if (scope === 'global' && target !== 'global') throw new AdminPricingError('INVALID_CHANGE');
    if (scope === 'product' && field === 'enabled' && typeof value === 'boolean') return;
    if (scope === 'global' && field === 'rounding') {
      try { const d = decimal(value, { positive: true }); if (d.n * 100n % d.d) throw new Error(); return; }
      catch { throw new AdminPricingError('INVALID_ROUNDING'); }
    }
    if (scope === 'global' && field === 'fxBufferPercent') { if (inRange(value)) return; throw new AdminPricingError('INVALID_MARKUP'); }
    if (field !== 'markup') throw new AdminPricingError('INVALID_CHANGE');
    if (value !== null && !inRange(value, this.pricing.config.minMarkup, this.pricing.config.maxMarkup)) throw new AdminPricingError('INVALID_MARKUP');
  }
  async preview(actor, change) {
    this.authorize(actor); this.#validate(change);
    if (models[change.scope] && !await models[change.scope].exists({ _id: change.target })) throw new AdminPricingError('NOT_FOUND');
    const revision = (await PricingRevision.findById('global').lean()).revision;
    // Return only server-generated settings/quotes; callers never supply monetary amounts.
    return { change: structuredClone(change), revision, createdAt: this.now().toISOString(),
      samples: change.scope === 'fx' ? [] : await this.samples(actor, change.scope, change.target, change),
      currentFx: change.scope === 'fx' ? await this.fx.current() : null };
  }
  async save(actor, preview) {
    this.authorize(actor); this.#validate(preview.change);
    if (!Number.isFinite(Date.parse(preview.createdAt)) || this.now().getTime() - Date.parse(preview.createdAt) > 5 * 60000) throw new AdminPricingError('PREVIEW_EXPIRED');
    const { scope, target, field, value } = preview.change;
    await mongoose.connection.transaction(async session => {
      const revision = await fencePricing(session);
      if (revision.revision !== preview.revision) throw new AdminPricingError('PREVIEW_CHANGED');
      let before, after;
      if (scope === 'fx') {
        const state = await ExchangeRate.findById('RUB').session(session).lean();
        before = { mode: state.mode, manual: state.manual || null };
        after = field === 'manual' ? { mode: 'manual', manual: this.fx.manualRecord(value) } : { mode: 'auto' };
        await ExchangeRate.updateOne({ _id: 'RUB' }, { $set: after }, { session });
      } else if (scope === 'global') {
        const settings = await PricingSettings.findById('global').session(session).lean();
        before = settings?.[field] ?? null; after = value;
        await PricingSettings.updateOne({ _id: 'global' }, { $set: { [field]: value } }, { session });
      } else {
        const Model = models[scope], entity = await Model.findById(target).session(session).lean();
        if (!entity) throw new AdminPricingError('NOT_FOUND');
        if (field === 'enabled') {
          before = { enabled: entity.enabled, hidden: entity.hidden }; after = { enabled: value, hidden: !value };
        } else {
          before = { markupOverride: entity.markupOverride ?? null, ...(scope === 'product' ? { markupInherited: entity.markupInherited } : {}) };
          after = { markupOverride: value, ...(scope === 'product' ? { markupInherited: value === null } : {}) };
        }
        await Model.updateOne({ _id: target }, { $set: after }, { session });
      }
      await fencePricing(session, true);
      await PriceAudit.create([{ actorId: String(actor), action: field === 'markup' && value === null ? 'markup_reset' : `${scope}_${field}`, scope, target, before, after }], { session });
      // Stored catalogue prices are caches only; subsequent views recalculate dynamically.
      const filter = scope === 'variant' ? { _id: target } : scope === 'product' ? { product: target } : scope === 'category' ? { category: target } : {};
      await CatalogVariant.updateMany(filter, { $set: { sellingPriceMinor: null } }, { session });
    });
    return true;
  }
  async refresh(actor) { this.authorize(actor); return this.fx.refresh(actor); }
  async history(actor, page = 0) {
    this.authorize(actor);
    const total = await PriceAudit.countDocuments(), pages = Math.max(1, Math.ceil(total / 5)), current = Math.min(pageNumber(page), pages - 1);
    return { items: await PriceAudit.find().sort({ createdAt: -1, _id: -1 }).skip(current * 5).limit(5).lean(), total, pages, page: current };
  }
}
