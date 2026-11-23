import { envelope, requireSchema, integer, text, entity, variant, snapshot } from './contracts.js';
export function adaptSubscriptions(data) {
  envelope(data);
  requireSchema(data.currency === 'RUB' && Array.isArray(data.categories));
  const categories = [], products = [], variants = [];
  for (const c of data.categories) {
    requireSchema(c && integer(c.category_id) && text(c.title) && Array.isArray(c.products));
    const category = entity(`catalog:category:${c.category_id}`, { source: 'catalog', supplierCategoryId: String(c.category_id), title: c.title });
    categories.push(category);
    for (const p of c.products) {
      requireSchema(p && integer(p.product_id) && text(p.title) && Array.isArray(p.variants));
      const product = entity(`catalog:product:${p.product_id}`, { source: 'catalog', kind: 'catalog', category: category._id, supplierProductId: String(p.product_id), title: p.title, detailsLoaded: true });
      products.push(product);
      for (const v of p.variants) {
        requireSchema(v && integer(v.variant_id) && text(v.title) && integer(v.price) && integer(v.in_stock) && typeof v.available === 'boolean');
        requireSchema(v.max_quantity === undefined || integer(v.max_quantity));
        requireSchema(v.requires_input === undefined || typeof v.requires_input === 'boolean');
        requireSchema(v.delivery === undefined || typeof v.delivery === 'string');
        requireSchema(v.input_prompt === undefined || typeof v.input_prompt === 'string');
        const missingInput = v.requires_input === undefined || (v.requires_input && !text(v.input_prompt));
        variants.push(variant(`catalog:variant:${v.variant_id}`, product, {
          supplierVariantId: String(v.variant_id), title: v.title, supplierPriceMinor: v.price,
          stock: v.in_stock, available: v.available, maxQuantity: v.max_quantity ?? null,
          delivery: v.delivery ?? null, inputComplete: !missingInput,
          inputSchema: v.requires_input ? [{ name: 'user_input', label: v.input_prompt || 'Yetkazib beruvchi maydoni aniqlanmagan', type: 'text', required: true, origin: 'supplier' }] : [],
        }));
      }
    }
  }
  return snapshot(categories, products, variants);
}
