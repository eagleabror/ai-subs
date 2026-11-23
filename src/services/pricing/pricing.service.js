import mongoose from 'mongoose';
import { CatalogCategory, CatalogProduct, CatalogVariant, PricingSettings } from '../../models/Catalog.js';
import { PriceAudit } from '../../models/Pricing.js';
import { calculatePrice, validMarkup } from '../pricing.service.js';
import { ensurePricingRevision, fencePricing } from './revision.js';
export class PricingService {
  constructor(config, fx) { this.config = config; this.fx = fx; }
  async init() {
    await ensurePricingRevision();
    await PricingSettings.updateOne({ _id: 'global' }, { $setOnInsert: {} }, { upsert: true });
    await mongoose.connection.transaction(async session => {
      await fencePricing(session, true);
      const settings = await PricingSettings.findById('global').session(session).lean();
      if (!settings.legacyOverridesMigrated) {
        await PricingSettings.updateOne({ _id: 'global' }, { $set: { legacyOverrides: this.config.overrides, legacyOverridesMigrated: true } }, { session });
        if (Object.keys(this.config.overrides).length) await PriceAudit.create([{ actorId: 'system:migration', action: 'legacy_product_overrides_imported', scope: 'global', target: 'global', after: this.config.overrides }], { session });
      }
    });
  }
  async context(variantId, { session, patch } = {}) {
    // No parallel operations on a MongoDB transaction/session.
    const variant = await CatalogVariant.findById(variantId).session(session || null).lean();
    if (!variant) return null;
    const product = await CatalogProduct.findById(variant.product).session(session || null).lean();
    const category = await CatalogCategory.findById(product?.category || variant.category).session(session || null).lean();
    const settings = await PricingSettings.findById('global').session(session || null).lean() || {};
    if (!product || !category) return null;
    if (patch) {
      const entity = patch.scope === 'variant' ? variant : patch.scope === 'product' ? product : patch.scope === 'category' ? category : settings;
      if (patch.scope === 'global') entity[patch.field] = patch.value;
      else if (entity._id === patch.target && patch.field === 'markup') { entity.markupOverride = patch.value; if (patch.scope === 'product') entity.markupInherited = patch.value === null; }
    }
    const productMarkup = product.markupOverride ?? (!product.markupInherited ? settings.legacyOverrides?.[product.key] : null);
    const choices = [['variant', variant.markupOverride], ['product', productMarkup], ['category', category.markupOverride], ['global', settings.markup ?? this.config.markup]];
    const [markupSource, markup] = choices.find(([, value]) => value != null);
    return { variant, product, category, settings, markup, markupSource, fx: await this.fx.current({ session }) };
  }
  async quote(variantId, quantity = 1, { session, supplierVariant, patch, allowHidden = false } = {}) {
    const ctx = await this.context(variantId, { session, patch });
    if (!ctx) return null;
    const variant = supplierVariant || ctx.variant;
    if (!allowHidden && (!ctx.product.present || ctx.product.hidden || !ctx.product.enabled || !ctx.variant.present || !ctx.category.present)) return null;
    if (variant.currency !== 'RUB' || variant.product !== ctx.product._id || variant.quoteRequired || !ctx.fx.acceptable) return null;
    if (this.config.errors.some(e => e !== 'RUB_TO_UZS_RATE') || !validMarkup(ctx.markup, { min: this.config.minMarkup, max: this.config.maxMarkup })) return null;
    const buffer = ctx.settings.fxBufferPercent ?? this.fx.config.bufferPercent;
    if (!validMarkup(buffer)) return null;
    return calculatePrice({ supplierPriceMinor: variant.supplierPriceMinor, quantity, rate: ctx.fx.rate, markup: ctx.markup,
      buffer, rounding: ctx.settings.rounding ?? this.config.rounding, markupSource: ctx.markupSource });
  }
  async supplierTotal(productId, variantId, supplierTotalMinor, { session } = {}) {
    let context;
    if (variantId) context = await this.context(variantId, { session });
    else {
      const product = await CatalogProduct.findById(productId).session(session || null).lean();
      const category = product && await CatalogCategory.findById(product.category).session(session || null).lean();
      const settings = await PricingSettings.findById('global').session(session || null).lean() || {};
      if (!product || !category) return null;
      const choices = [['product', product.markupOverride ?? (!product.markupInherited ? settings.legacyOverrides?.[product.key] : null)], ['category', category.markupOverride], ['global', settings.markup ?? this.config.markup]];
      const [markupSource, markup] = choices.find(([, v]) => v != null);
      context = { product, category, settings, markupSource, markup, fx: await this.fx.current({ session }) };
    }
    const c = context;
    if (!c || c.product._id !== productId || !c.product.present || c.product.hidden || !c.product.enabled || !c.category.present || variantId && !c.variant.present || !c.fx.acceptable) return null;
    const buffer = c.settings.fxBufferPercent ?? this.fx.config.bufferPercent;
    if (this.config.errors.some(e => e !== 'RUB_TO_UZS_RATE') || !validMarkup(c.markup, { min: this.config.minMarkup, max: this.config.maxMarkup }) || !validMarkup(buffer)) return null;
    const price = calculatePrice({ supplierPriceMinor: supplierTotalMinor, rate: c.fx.rate, markup: c.markup, markupSource: c.markupSource, buffer, rounding: c.settings.rounding ?? this.config.rounding });
    return price ? { ...price, priceBasis: 'supplier_total', calculationVersion: 'ai-subs-supplier-v4.1' } : null;
  }
}
