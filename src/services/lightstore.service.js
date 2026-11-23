// Contract: https://light-store.net/api/ (GET /catalog), reviewed 2026-11-23.
import { LightStoreError } from './catalog/error.js';
import { adaptSubscriptions } from './catalog/subscriptions.adapter.js';
import { adaptGamesCatalog, adaptGameDetails } from './catalog/games.adapter.js';
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
  constructor(config, { fetchImpl = globalThis.fetch, now = Date.now,
    sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    this.#config = config;
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#sleep = sleep;
  }
  async getCatalog() { return parseCatalog(await this.#get('/catalog', adaptSubscriptions)); }
  async getCatalogSnapshot({ force = false } = {}) { return adaptSubscriptions(await this.#get('/catalog', adaptSubscriptions, force)); }
  async getGamesCatalog() { return adaptGamesCatalog(await this.#get('/games/catalog', adaptGamesCatalog)); }
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
  async #request(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);
    try {
      const response = await this.#fetch(`${this.#config.baseUrl.replace(/\/$/, '')}${path}`, {
        method: 'GET', headers: { Authorization: `Bearer ${this.#config.apiKey}`, Accept: 'application/json' },
        redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429) {
          const retry = response.headers?.get('retry-after');
          const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - this.#now();
          this.#retryUntil = this.#now() + (Number.isFinite(delay) && delay > 0 ? delay : 60000);
          this.#nextRequest = Math.max(this.#nextRequest, this.#retryUntil);
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
