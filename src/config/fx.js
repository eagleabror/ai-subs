import { decimal, inRange } from '../utils/decimal.js';
export const CBU_URL = 'https://cbu.uz/uz/arkhiv-kursov-valyut/json/';
export function fxConfig(env = process.env) {
  const config = { mode: env.FX_RATE_MODE || (env.RUB_TO_UZS_RATE ? 'legacy' : 'auto'), url: env.FX_CBU_URL || CBU_URL,
    intervalMinutes: Number(env.FX_REFRESH_INTERVAL_MINUTES || 360), maxAgeDays: Number(env.FX_MAX_AGE_DAYS || 7),
    maxFetchAgeHours: Number(env.FX_MAX_FETCH_AGE_HOURS || 48), timeoutMs: Number(env.FX_TIMEOUT_MS || 10000),
    bufferPercent: env.FX_COST_BUFFER_PERCENT || '0', legacyRate: env.RUB_TO_UZS_RATE || null, errors: [] };
  if (!['auto','manual','legacy'].includes(config.mode)) config.errors.push('FX_RATE_MODE');
  // Official source only; no arbitrary SSRF target or redirect with runtime configuration.
  if (config.url !== CBU_URL) config.errors.push('FX_CBU_URL');
  for (const [key, field, min, max] of [
    ['FX_REFRESH_INTERVAL_MINUTES','intervalMinutes',1,1440], ['FX_MAX_AGE_DAYS','maxAgeDays',1,30],
    ['FX_MAX_FETCH_AGE_HOURS','maxFetchAgeHours',1,720], ['FX_TIMEOUT_MS','timeoutMs',100,60000],
  ]) if (!Number.isInteger(config[field]) || config[field] < min || config[field] > max) config.errors.push(key);
  if (!inRange(config.bufferPercent)) config.errors.push('FX_COST_BUFFER_PERCENT');
  if (config.mode === 'legacy') { try { decimal(config.legacyRate, { positive: true }); } catch { config.errors.push('RUB_TO_UZS_RATE'); } }
  return config;
}
