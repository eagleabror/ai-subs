// Decimal strings -> exact rational numbers. No binary floating-point arithmetic for money.
export function decimal(value, { positive = false } = {}) {
  const s = String(value ?? '');
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(s)) throw new Error('INVALID_DECIMAL');
  const [whole, fraction = ''] = s.split('.');
  const n = BigInt(whole + fraction), d = 10n ** BigInt(fraction.length);
  if (positive && n === 0n) throw new Error('INVALID_DECIMAL');
  return { n, d };
}
export function validMarkup(value) {
  try { const { n, d } = decimal(value); return n <= 1000n * d; } catch { return false; }
}
export function pricingConfig(env = process.env) {
  const config = { rate: env.RUB_TO_UZS_RATE || null, markup: env.DEFAULT_MARKUP_PERCENT || '0', rounding: env.ROUNDING_INCREMENT_UZS || '1', overrides: {}, errors: [] };
  try { decimal(config.rate, { positive: true }); } catch { config.errors.push('RUB_TO_UZS_RATE'); }
  if (!validMarkup(config.markup)) config.errors.push('DEFAULT_MARKUP_PERCENT');
  try { const { n, d } = decimal(config.rounding, { positive: true }); if (n * 100n % d) throw new Error(); } catch { config.errors.push('ROUNDING_INCREMENT_UZS'); }
  try {
    const overrides = JSON.parse(env.PRODUCT_MARKUP_OVERRIDE || '{}');
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.values(overrides).some(v => !validMarkup(v))) throw new Error();
    config.overrides = overrides;
  } catch { config.errors.push('PRODUCT_MARKUP_OVERRIDE'); }
  return config;
}
export function sellingPrice(supplierPriceMinor, config, product, settings = {}, quantity = 1) {
  if (config.errors.length || !Number.isSafeInteger(supplierPriceMinor) || supplierPriceMinor < 0 || !Number.isSafeInteger(quantity) || quantity < 1) return null;
  try {
    const markup = product?.markupOverride ?? (Object.hasOwn(config.overrides, product?.key) ? config.overrides[product.key] : settings.markup ?? config.markup);
    if (!validMarkup(markup)) return null;
    const rate = decimal(config.rate, { positive: true }), margin = decimal(markup), rounding = decimal(config.rounding, { positive: true });
    const step = rounding.n * 100n / rounding.d;
    if (step < 1n) return null;
    const n = BigInt(supplierPriceMinor) * rate.n * (100n * margin.d + margin.n);
    const d = rate.d * 100n * margin.d;
    const unitMinor = ((n + d * step - 1n) / (d * step)) * step;
    const totalMinor = unitMinor * BigInt(quantity);
    if (totalMinor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { unitMinor: Number(unitMinor), totalMinor: Number(totalMinor), currency: 'UZS', rate: config.rate, markup: String(markup), rounding: config.rounding };
  } catch { return null; }
}
