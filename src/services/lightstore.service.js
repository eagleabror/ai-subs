// Contract: https://light-store.net/api/ (GET /catalog), reviewed 2026-11-23.
import { LightStoreError } from './catalog/error.js';
import { adaptSubscriptions } from './catalog/subscriptions.adapter.js';
import { adaptGamesCatalog, adaptGameDetails } from './catalog/games.adapter.js';
import { randomUUID } from 'node:crypto';
import { balanceResponse, itemResponse, gameQuoteResponse, orderResponse, orderListResponse, numericId } from './supplier/contracts.js';
export { LightStoreError } from './catalog/error.js';

const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const title = (value) => typeof value === 'string' && value.trim().length > 0;
function requireSchema(condition) {
  if (!condition) throw new LightStoreError('INVALID_SCHEMA');
}

export function parseCatalog(data) {
  if (data?.ok === false) throw new LightStoreError('API_ERROR');
  requireSchema(data?.ok === true && data.currency === 'RUB' && Array.isArray(data.categories));
  const products = [];
  for (const category of data.categories) {
    requireSchema(category && integer(category.category_id) && title(category.title) && Array.isArray(category.products));
    for (const product of category.products) {
      requireSchema(product && integer(product.product_id) && title(product.title) && Array.isArray(product.variants));
      const variants = product.variants.map((variant) => {
        requireSchema(variant && integer(variant.variant_id) && title(variant.title)
          && integer(variant.price) && integer(variant.in_stock) && typeof variant.available === 'boolean');
        return {
          variantId: variant.variant_id,
          title: variant.title,
          supplierPriceMinor: variant.price,
          currency: data.currency,
          stock: variant.in_stock,
          available: variant.available,
        };
      });
      products.push({ categoryId: category.category_id, productId: product.product_id, title: product.title, variants });
    }
  }
  return products;
}

export function findGeminiSixMonthOffers(products) {
  return products.flatMap((product) => product.variants.flatMap((variant) => {
    const name = `${product.title} ${variant.title}`.normalize('NFKC').toLowerCase();
    const sixMonths = /(?:^|[^\p{L}\p{N}])6\s*[-–]?\s*(?:months?|mos?|m|oy(?:lik)?|месяц(?:а|ев)?|мес\.?)($|[^\p{L}\p{N}])/u.test(name);
    if (!/\bgemini\b/.test(name) || !/\bai\s+plus\b/.test(name) || !sixMonths) return [];
    return [{ productId: product.productId, productTitle: product.title, ...variant }];
  }));
}

export class LightStoreService {
  #config;
  #fetch;
  #cache = new Map();
  #pending = new Map();
  #queue = Promise.resolve();
  #nextRequest = 0;
  #retryUntil = 0;
  #now;
  #sleep;
  #limiter;
  constructor(config, { fetchImpl = globalThis.fetch, now = Date.now,
    sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)), limiter } = {}) {
    this.#config = config;
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#sleep = sleep;
    this.#limiter = limiter;
  }
  get mode() { return 'live-readonly'; }
  async getBalance() { return this.#operation('/balance', balanceResponse); }
  async getCatalogItem(variantId) { requireSchema(numericId(variantId)); return this.#operation(`/catalog/${variantId}`, itemResponse); }
  async checkSteam(login) { requireSchema(typeof login === 'string' && login.length > 0 && login.length <= 500); return this.#operation(`/games/steam/check?login=${encodeURIComponent(login)}`, data => { requireSchema(data?.ok === true && typeof data.can === 'boolean'); return data.can; }); }
  async quoteGame(body) {
    requireSchema(['mobile','refill','gift','key','voucher'].includes(body?.kind));
    return this.#operation('/games/quote', gameQuoteResponse, { method: 'POST', body });
  }
  async getSupplierOrder(channel, id) {
    requireSchema(['games','standard'].includes(channel) && (channel === 'standard' ? numericId(id) : typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)));
    return this.#operation(`${channel === 'games' ? '/games' : ''}/order/${id}`, data => orderResponse(data, channel));
  }
  async listSupplierOrders(channel) {
    requireSchema(['games','standard'].includes(channel));
    return this.#operation(channel === 'games' ? '/games/orders' : '/orders?limit=100&offset=0', data => orderListResponse(data, channel));
  }
  async createSupplierOrder() { throw new LightStoreError('REAL_PURCHASE_DISABLED'); }
  async #operation(path, parse, options = {}) {
    if (this.#pending.size >= 20) throw new LightStoreError('BUSY');
    const key = randomUUID();
    const promise = this.#queue.then(async () => {
      if (this.#retryUntil > this.#now()) throw new LightStoreError('HTTP_ERROR', 429);
      while (this.#nextRequest > this.#now()) await this.#sleep(this.#nextRequest - this.#now());
      this.#nextRequest = this.#now() + 1100;
      return parse(await this.#request(path, options));
    });
    this.#queue = promise.catch(() => {});
    this.#pending.set(key, promise);
    try { return await promise; } finally { this.#pending.delete(key); }
  }
  async getCatalog() { return parseCatalog(await this.#get('/catalog', adaptSubscriptions)); }
  async getCatalogSnapshot({ force = false } = {}) { return adaptSubscriptions(await this.#get('/catalog', adaptSubscriptions, force)); }
  async getGamesCatalog({ force = false } = {}) { return adaptGamesCatalog(await this.#get('/games/catalog', adaptGamesCatalog, force)); }
  async getGameDetails(product, { force = false } = {}) {
    const paths = { steam_games: 'game', gift_cards: 'brand', telegram: 'mobile', mobile_games: 'mobile' };
    if (!Object.hasOwn(paths, product.kind) || !product.supplierProductId) throw new LightStoreError('INVALID_SCHEMA');
    const path = `/games/${paths[product.kind]}/${encodeURIComponent(product.supplierProductId)}`;
    return adaptGameDetails(await this.#get(path, data => adaptGameDetails(data, product), force), product);
  }
  async #get(path, validate, force = false) {
    const cached = this.#cache.get(path);
    if (!force && cached && cached.expires > this.#now()) return structuredClone(cached.data);
    if (this.#retryUntil > this.#now()) throw new LightStoreError('HTTP_ERROR', 429);
    if (!this.#pending.has(path)) {
      // All reads share one queue: 1 request / 1.1 seconds, below the documented 60/min.
      // Bound the queue and cache so arbitrary catalog browsing cannot grow memory forever.
      if (this.#pending.size >= 20) throw new LightStoreError('BUSY');
      const request = this.#queue.then(async () => {
        if (this.#retryUntil > this.#now()) throw new LightStoreError('HTTP_ERROR', 429);
        while (this.#nextRequest > this.#now()) await this.#sleep(this.#nextRequest - this.#now());
        this.#nextRequest = this.#now() + 1100;
        const data = await this.#request(path);
        validate(data); // Never cache invalid or failed responses.
        if (this.#cache.size >= 200) this.#cache.delete(this.#cache.keys().next().value);
        this.#cache.set(path, { data, expires: this.#now() + 30000 });
        return data;
      });
      this.#queue = request.catch(() => {});
      this.#pending.set(path, request.finally(() => this.#pending.delete(path)));
    }
    return structuredClone(await this.#pending.get(path));
  }
  async #request(path, { method = 'GET', body } = {}) {
    // Unconditional transport guard: neither an env flag nor an admin action can enable purchases.
    if (method !== 'GET' && !(method === 'POST' && path === '/games/quote')) throw new LightStoreError('REAL_PURCHASE_DISABLED');
    await this.#limiter?.acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);
    try {
      const response = await this.#fetch(`${this.#config.baseUrl.replace(/\/$/, '')}${path}`, {
        method, headers: { Authorization: `Bearer ${this.#config.apiKey}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429) {
          const retry = response.headers?.get('retry-after');
          const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - this.#now();
          this.#retryUntil = this.#now() + (Number.isFinite(delay) && delay > 0 ? delay : 60000);
          this.#nextRequest = Math.max(this.#nextRequest, this.#retryUntil);
          await this.#limiter?.cooldown(this.#retryUntil);
        }
        await response.body?.cancel();
        throw new LightStoreError('HTTP_ERROR', response.status);
      }
      try { return await response.json(); }
      catch { throw new LightStoreError(controller.signal.aborted ? 'TIMEOUT' : 'INVALID_JSON'); }
    } catch (error) {
      if (controller.signal.aborted) throw new LightStoreError('TIMEOUT');
      if (error instanceof LightStoreError) throw error;
      throw new LightStoreError('NETWORK_ERROR');
    } finally { clearTimeout(timer); }
  }
  async findGeminiSixMonthOffers() { return findGeminiSixMonthOffers(await this.getCatalog()); }
}
