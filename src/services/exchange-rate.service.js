import mongoose from 'mongoose';
import { ExchangeRate, PriceAudit } from '../models/Pricing.js';
import { decimal, fraction, fractionText } from '../utils/decimal.js';
import { fxConfig } from '../config/fx.js';
import { ensurePricingRevision, fencePricing } from './pricing/revision.js';
const DAY = 86400000;
export class ExchangeRateError extends Error { constructor(code) { super(code); this.code = code; this.name = 'ExchangeRateError'; } }
export function tashkentDate(now) { return new Date(now.getTime() + 5 * 3600000).toISOString().slice(0, 10); }
export function parseCbu(data, now = new Date()) {
  if (!Array.isArray(data)) throw new ExchangeRateError('CBU_INVALID_SCHEMA');
  const rows = data.filter(r => r?.Ccy === 'RUB');
  if (rows.length !== 1) throw new ExchangeRateError('CBU_RUB_MISSING_OR_DUPLICATE');
  const row = rows[0];
  try {
    // The official response uses strings. Reject coerced numbers, null and scientific notation.
    if (typeof row.Rate !== 'string' || typeof row.Nominal !== 'string') throw new Error();
    const rate = decimal(row.Rate, { positive: true }), nominal = decimal(row.Nominal, { positive: true });
    if (nominal.n % nominal.d !== 0n) throw new Error();
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(row.Date);
    if (!m) throw new Error();
    const effectiveDate = `${m[3]}-${m[2]}-${m[1]}`;
    const parsed = new Date(`${effectiveDate}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== effectiveDate || Number(m[3]) < 2000) throw new Error();
    // Future effective rates must never be used early. Preserve the current cache instead.
    if (effectiveDate > tashkentDate(now)) throw new ExchangeRateError('CBU_FUTURE_RATE');
    const ratio = fraction(rate.n * nominal.d, rate.d * nominal.n);
    return { ccy: 'RUB', rate: row.Rate, nominal: row.Nominal, numerator: String(ratio.n), denominator: String(ratio.d), effectiveDate, fetchedAt: now, source: 'cbu' };
  } catch (error) { if (error instanceof ExchangeRateError) throw error; throw new ExchangeRateError('CBU_INVALID_SCHEMA'); }
}
export function rateAcceptable(rate, config, now = new Date()) {
  if (!rate || config.errors.length) return false;
  try {
    const parsed = decimal(rate.rate, { positive: true }), nominal = decimal(rate.nominal, { positive: true });
    const expected = fraction(parsed.n * nominal.d, parsed.d * nominal.n);
    if (rate.ccy !== 'RUB' || !['cbu','manual','legacy'].includes(rate.source) || nominal.n % nominal.d !== 0n || String(expected.n) !== rate.numerator || String(expected.d) !== rate.denominator) return false;
    const today = Date.parse(`${tashkentDate(now)}T00:00:00Z`), effective = Date.parse(`${rate.effectiveDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rate.effectiveDate) || !Number.isFinite(effective) || new Date(effective).toISOString().slice(0, 10) !== rate.effectiveDate) return false;
    const fetchTime = new Date(rate.fetchedAt).getTime();
    return Number.isFinite(effective) && rate.effectiveDate <= tashkentDate(now) && today - effective <= config.maxAgeDays * DAY
      && Number.isFinite(fetchTime) && fetchTime <= now.getTime() && now.getTime() - fetchTime <= config.maxFetchAgeHours * 3600000;
  } catch { return false; }
}
export class ExchangeRateService {
  #pending;
  #timer;
  constructor(config = fxConfig(), { fetchImpl = globalThis.fetch, now = () => new Date(), schedule = setInterval, unschedule = clearInterval } = {}) {
    this.config = config; this.fetch = fetchImpl; this.now = now; this.schedule = schedule; this.unschedule = unschedule;
  }
  async init() {
    await ensurePricingRevision();
    const mode = ['auto','manual','legacy'].includes(this.config.mode) ? this.config.mode : 'auto';
    const initial = { _id: 'RUB', mode };
    if (mode === 'legacy' && !this.config.errors.length) initial.manual = this.#manualRecord(this.config.legacyRate, 'legacy');
    await mongoose.connection.transaction(async session => {
      await fencePricing(session);
      if (!await ExchangeRate.exists({ _id: 'RUB' }).session(session)) {
        await ExchangeRate.create([initial], { session });
        if (initial.manual) await PriceAudit.create([{ actorId: 'system:legacy-env', action: 'fx_legacy_import', scope: 'fx', target: 'RUB', after: initial.manual }], { session });
      }
    });
    // Environment bootstraps only once. DB mode/overrides survive every later restart.
  }
  start() {
    if (this.#timer || this.config.errors.length) return;
    void this.refresh().catch(() => {});
    this.#timer = this.schedule(() => { void this.refresh().catch(() => {}); }, this.config.intervalMinutes * 60000);
    this.#timer?.unref?.();
  }
  stop() { if (this.#timer) this.unschedule(this.#timer); this.#timer = null; }
  async current({ session } = {}) {
    const state = await ExchangeRate.findById('RUB').session(session || null).lean();
    const rate = state?.mode === 'auto' ? state.automatic : state?.manual;
    let displayRate = null;
    try { if (rate) displayRate = fractionText({ n: BigInt(rate.numerator), d: BigInt(rate.denominator) }); } catch { /* Corrupt caches must fail closed. */ }
    return { mode: state?.mode || this.config.mode, rate: rate || null, acceptable: rateAcceptable(rate, this.config, this.now()),
      displayRate,
      lastAttempt: state?.lastAttempt, lastError: state?.lastError, errors: this.config.errors };
  }
  async refresh(actorId) {
    if (!this.#pending) this.#pending = this.#refresh(actorId).finally(() => { this.#pending = null; });
    return this.#pending;
  }
  async #refresh(actorId) {
    if (this.config.errors.length) throw new ExchangeRateError('FX_CONFIG_INVALID');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetch(this.config.url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
      if (!response.ok) { await response.body?.cancel(); throw new ExchangeRateError(`CBU_HTTP_${response.status}`); }
      let data;
      try { data = await response.json(); } catch { throw new ExchangeRateError('CBU_INVALID_JSON'); }
      const next = parseCbu(data, this.now());
      if (!rateAcceptable(next, this.config, this.now())) throw new ExchangeRateError('CBU_STALE_RATE');
      await mongoose.connection.transaction(async session => {
        await fencePricing(session, true);
        const previous = await ExchangeRate.findById('RUB').session(session).lean();
        if (previous?.automatic?.effectiveDate > next.effectiveDate) throw new ExchangeRateError('CBU_REGRESSING_DATE');
        await ExchangeRate.updateOne({ _id: 'RUB' }, { $set: { automatic: next, lastAttempt: this.now(), lastError: null } }, { session });
        if (actorId || previous?.automatic?.rate !== next.rate || previous?.automatic?.nominal !== next.nominal || previous?.automatic?.effectiveDate !== next.effectiveDate) {
          await PriceAudit.create([{ actorId: actorId ? String(actorId) : 'system:cbu', action: 'fx_refresh', scope: 'fx', target: 'RUB', before: previous?.automatic || null, after: next }], { session });
        }
      });
      return this.current();
    } catch (error) {
      const code = controller.signal.aborted ? 'CBU_TIMEOUT' : error instanceof ExchangeRateError ? error.code : 'CBU_UNAVAILABLE';
      await ExchangeRate.updateOne({ _id: 'RUB' }, { $set: { lastAttempt: this.now(), lastError: code } });
      throw new ExchangeRateError(code);
    } finally { clearTimeout(timer); }
  }
  #manualRecord(value, source = 'manual') {
    const d = decimal(value, { positive: true }), ratio = fraction(d.n, d.d), now = this.now();
    return { ccy: 'RUB', rate: String(value), nominal: '1', numerator: String(ratio.n), denominator: String(ratio.d), effectiveDate: tashkentDate(now), fetchedAt: now, source };
  }
  manualRecord(value) { return this.#manualRecord(value); }
}
