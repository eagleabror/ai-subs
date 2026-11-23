import { envelope, requireSchema, integer, text, object, entity, variant, snapshot } from './contracts.js';
// These are documented API sections, not a hardcoded product list.
const sections = { steam_games: ['Steam o‘yinlari', 'app_id'], gift_cards: ['Gift cards', 'slug'], telegram: ['Telegram', 'game_id'], mobile_games: ['Mobil o‘yinlar', 'game_id'] };
export function adaptGamesCatalog(data) {
  envelope(data);
  requireSchema(data.currency === 'RUB' && data.price_unit === 'kopecks');
  const categories = [], products = [];
  for (const [kind, [title, idField]] of Object.entries(sections)) {
    requireSchema(Array.isArray(data[kind]));
    const category = entity(`games:category:${kind}`, { source: 'games', supplierCategoryId: null, title, kind });
    categories.push(category);
    for (const row of data[kind]) {
      requireSchema(row && text(row.title) && (idField === 'slug' ? text(row[idField]) && row[idField].length <= 200 : integer(row[idField])));
      requireSchema(row.price === undefined || integer(row.price));
      requireSchema(row.gift_available === undefined || typeof row.gift_available === 'boolean');
      requireSchema(row.key_available === undefined || typeof row.key_available === 'boolean');
      requireSchema(row.regions_count === undefined || integer(row.regions_count));
      products.push(entity(`games:${kind}:${row[idField]}`, {
        source: 'games', kind, category: category._id, supplierProductId: String(row[idField]), title: row.title,
        discoveryPriceMinor: row.price ?? null, currency: 'RUB',
        giftAvailable: row.gift_available ?? null, keyAvailable: row.key_available ?? null, regionsCount: row.regions_count ?? null,
      }));
    }
  }
  requireSchema(object(data.steam_refill) && object(data.steam_refill.rates));
  requireSchema(Object.values(data.steam_refill.rates).every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0));
  requireSchema(typeof data.steam_refill.mk === 'number' && Number.isFinite(data.steam_refill.mk));
  const category = entity('games:category:steam_refill', { source: 'games', supplierCategoryId: null, title: 'Steam balansini to‘ldirish', kind: 'steam_refill' });
  categories.push(category);
  products.push(entity('games:steam_refill', { source: 'games', kind: 'steam_refill', category: category._id, supplierProductId: null,
    title: 'Steam balansini to‘ldirish', quoteRequired: true, detailsLoaded: true,
    refillMetadata: { rates: data.steam_refill.rates, mk: data.steam_refill.mk },
    inputSchema: [{ name: 'login', label: 'Steam login', type: 'text', required: true, origin: 'supplier' },
      { name: 'cur', label: 'Valyuta', type: 'select', options: ['RUB', 'KZT', 'UAH'], required: true, origin: 'supplier' },
      { name: 'amount', label: 'To‘ldirish summasi', type: 'number', required: true, origin: 'supplier' }],
  }));
  const known = new Set(['ok','currency','price_unit','steam_refill', ...Object.keys(sections)]);
  return snapshot(categories, products, [], { unsupportedTypes: Object.keys(data).filter(k => !known.has(k)).map(k => k.slice(0, 80)) });
}

export function adaptGameDetails(data, product) {
  envelope(data);
  const variants = [];
  if (product.kind === 'steam_games') {
    const game = data.game;
    requireSchema(game && String(game.app_id) === product.supplierProductId && Array.isArray(game.editions) && Array.isArray(game.keys));
    for (const edition of game.editions) {
      requireSchema(edition && integer(edition.package_id) && text(edition.title) && Array.isArray(edition.regions));
      for (const region of edition.regions) {
        requireSchema(region && text(region.region) && integer(region.price));
        variants.push(variant(`${product.key}:package:${edition.package_id}:${region.region}`, product, {
          supplierVariantId: String(edition.package_id), packageId: edition.package_id, region: region.region,
          title: edition.title, supplierPriceMinor: region.price, inputComplete: true, available: product.giftAvailable ?? null,
          inputSchema: [{ name: 'profile', label: 'Steam profil havolasi', type: 'url', required: true, origin: 'supplier' }],
        }));
      }
    }
    for (const key of game.keys) {
      requireSchema(key && integer(key.product_id) && integer(key.variant_id) && text(key.title) && text(key.region) && integer(key.price));
      variants.push(variant(`${product.key}:key:${key.product_id}:${key.variant_id}`, product, {
        supplierProductId: String(key.product_id), supplierVariantId: String(key.variant_id), region: key.region,
        title: key.title, supplierPriceMinor: key.price, inputComplete: true, available: product.keyAvailable ?? null,
      }));
    }
  } else if (product.kind === 'gift_cards') {
    requireSchema(Array.isArray(data.products));
    for (const p of data.products) {
      requireSchema(p && integer(p.product_id) && text(p.region) && Array.isArray(p.variants));
      for (const v of p.variants) {
        requireSchema(v && integer(v.variant_id) && text(v.title) && integer(v.price) && integer(v.stock));
        variants.push(variant(`${product.key}:card:${p.product_id}:${v.variant_id}`, product, {
          supplierProductId: String(p.product_id), supplierVariantId: String(v.variant_id), region: p.region,
          title: v.title, supplierPriceMinor: v.price, stock: v.stock, available: v.stock > 0, inputComplete: true,
        }));
      }
    }
  } else if (['telegram','mobile_games'].includes(product.kind)) {
    requireSchema(String(data.game_id) === product.supplierProductId && object(data.fields) && object(data.servers) && Array.isArray(data.positions));
    requireSchema(data.quantity_field === null || text(data.quantity_field));
    const fields = Object.entries(data.fields).map(([name, label]) => {
      requireSchema(text(name) && text(label));
      return { name, label, type: 'text', required: true, origin: 'supplier' };
    });
    // The docs don't name a request field for a separate server selector. Preserve choices,
    // but fail closed until the mapping is documented instead of inventing a field name.
    const servers = Object.entries(data.servers).map(([value, label]) => {
      requireSchema(text(value) && text(label));
      return { value, label };
    });
    if (data.quantity_field !== null) {
      requireSchema(integer(data.quantity_min) && integer(data.quantity_max) && data.quantity_min > 0 && data.quantity_max >= data.quantity_min);
      const existing = fields.findIndex(field => field.name === data.quantity_field);
      const quantity = { name: data.quantity_field, label: existing >= 0 ? fields[existing].label : data.quantity_field, type: 'number', required: true, min: data.quantity_min, max: data.quantity_max, origin: 'supplier' };
      if (existing >= 0) fields[existing] = quantity;
      else fields.push(quantity);
    }
    for (const p of data.positions) {
      requireSchema(p && integer(p.position_id) && text(p.title) && integer(p.price));
      variants.push(variant(`${product.key}:position:${p.position_id}`, product, {
        supplierVariantId: String(p.position_id), positionId: p.position_id, title: p.title, supplierPriceMinor: p.price,
        inputSchema: fields, serverOptions: servers, inputComplete: servers.length === 0, quoteRequired: data.quantity_field !== null,
      }));
    }
  } else requireSchema(false);
  return snapshot([], [], variants);
}
