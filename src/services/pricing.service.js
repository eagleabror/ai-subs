import { decimal, inRange, minorInteger } from '../utils/decimal.js';
export { decimal } from '../utils/decimal.js';
export function validMarkup(value, range = {}) { return inRange(value, range.min ?? '0', range.max ?? '1000'); }
export function pricingConfig(env = process.env) {
  const config = { rate: env.RUB_TO_UZS_RATE || null, markup: env.DEFAULT_MARKUP_PERCENT || '20', rounding: env.ROUNDING_INCREMENT_UZS || '1000', overrides: {}, minMarkup: env.MARKUP_MIN_PERCENT || '0', maxMarkup: env.MARKUP_MAX_PERCENT || '1000', errors: [] };
  try { decimal(config.rate, { positive: true }); } catch { config.errors.push('RUB_TO_UZS_RATE'); }
  if (!inRange(config.minMarkup, '0', config.maxMarkup) || !inRange(config.maxMarkup, '0', '100000')) config.errors.push('MARKUP_RANGE');
  if (!validMarkup(config.markup, { min: config.minMarkup, max: config.maxMarkup })) config.errors.push('DEFAULT_MARKUP_PERCENT');
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

export const CALCULATION_VERSION = 'ai-subs-pricing-v3.1';
export function calculatePrice({ supplierPriceMinor, quantity = 1, rate, markup, buffer = '0', rounding = '1000', markupSource }) {
  if (!Number.isSafeInteger(supplierPriceMinor) || supplierPriceMinor < 0 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) return null;
  try {
    const r = { n: BigInt(rate.numerator), d: BigInt(rate.denominator) };
    if (r.n <= 0n || r.d <= 0n) return null;
    const m = decimal(markup), b = decimal(buffer), step = decimal(rounding, { positive: true });
    if (step.n * 100n % step.d !== 0n) return null;
    const increment = step.n * 100n / step.d;
    const convertedN = BigInt(supplierPriceMinor) * r.n, convertedD = r.d;
    const bufferedN = convertedN * (100n * b.d + b.n), bufferedD = convertedD * 100n * b.d;
    const finalN = bufferedN * (100n * m.d + m.n), finalD = bufferedD * 100n * m.d;
    const unit = (finalN + finalD * increment - 1n) / (finalD * increment) * increment;
    return { supplierPriceMinor, supplierCurrency: 'RUB', currency: 'UZS', quantity,
      convertedCostMinor: minorInteger((convertedN + convertedD - 1n) / convertedD),
      convertedCostExact: { numerator: String(convertedN), denominator: String(convertedD) },
      bufferedCostMinor: minorInteger((bufferedN + bufferedD - 1n) / bufferedD),
      unitMinor: minorInteger(unit), totalMinor: minorInteger(unit * BigInt(quantity)),
      markup: String(markup), markupSource, fxBufferPercent: String(buffer), rounding: String(rounding),
      rate: `${rate.rate}/${rate.nominal}`, exchangeRate: { ...rate }, calculationVersion: CALCULATION_VERSION };
  } catch { return null; }
}
