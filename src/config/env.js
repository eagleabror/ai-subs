import { fxConfig } from './fx.js';
import { pricingConfig } from '../services/pricing.service.js';
export class ConfigurationError extends Error {
  constructor(issues) {
    super(`Sozlamalarni tekshiring: ${issues.join('; ')}`);
    this.name = 'ConfigurationError';
  }
}

export function loadSupplierConfig(env = process.env) {
  const issues = [];
  const apiKey = env.LIGHTSTORE_API_KEY?.trim();
  if (!apiKey || /\s/.test(apiKey)) issues.push('LIGHTSTORE_API_KEY kerak (bo‘shliqsiz)');
  let baseUrl;
  try {
    baseUrl = new URL(env.LIGHTSTORE_API_BASE_URL);
    if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error();
  } catch {
    issues.push('LIGHTSTORE_API_BASE_URL haqiqiy HTTPS manzil bo‘lishi kerak');
  }
  const timeoutMs = Number(env.LIGHTSTORE_TIMEOUT_MS ?? 10000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
    issues.push('LIGHTSTORE_TIMEOUT_MS 100–60000 oralig‘ida bo‘lishi kerak');
  }
  if ((env.AUTO_PURCHASE_ENABLED ?? 'false') !== 'false') {
    issues.push('Phase 1/2/3/4 uchun AUTO_PURCHASE_ENABLED faqat false bo‘lishi mumkin');
  }
  if (issues.length) throw new ConfigurationError(issues);
  return Object.freeze({ apiKey, baseUrl: baseUrl.href.replace(/\/$/, ''), timeoutMs });
}

export function loadConfig(env = process.env) {
  const issues = [];
  let supplier;
  try { supplier = loadSupplierConfig(env); } catch (error) { issues.push(error.message); }
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(env.TELEGRAM_BOT_TOKEN ?? '')) issues.push('TELEGRAM_BOT_TOKEN kerak yoki formati noto‘g‘ri');
  if (!/^mongodb(?:\+srv)?:\/\/\S+$/.test(env.MONGODB_URI ?? '')) issues.push('MONGODB_URI kerak yoki formati noto‘g‘ri');
  const adminIds = (env.ADMIN_TELEGRAM_ID ?? '').split(',').map(id => id.trim());
  if (adminIds.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) {
    issues.push('ADMIN_TELEGRAM_ID musbat ID yoki vergul bilan ajratilgan IDlar bo‘lishi kerak');
  }
  const port = Number(env.PORT ?? 3000);
  if (env.FULFILLMENT_ENCRYPTION_KEY && !/^[A-Za-z0-9+/]{43}=$/.test(env.FULFILLMENT_ENCRYPTION_KEY)) issues.push('FULFILLMENT_ENCRYPTION_KEY 32 baytli base64 bo‘lishi kerak');
  if (!Number.isInteger(port) || port < 1 || port > 65535) issues.push('PORT 1–65535 oralig‘ida bo‘lishi kerak');
  if (issues.length) throw new ConfigurationError(issues);
  return Object.freeze({
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    mongodbUri: env.MONGODB_URI,
    adminTelegramId: env.ADMIN_TELEGRAM_ID,
    autoPurchaseEnabled: false,
    port,
    supplier,
    pricing: pricingConfig(env),
    fx: fxConfig(env),
    fulfillmentEncryptionKey: env.FULFILLMENT_ENCRYPTION_KEY || null,
  });
}
