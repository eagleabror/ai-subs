// Contract: https://light-store.net/api/ (GET /catalog), reviewed 2026-11-23.
export class LightStoreError extends Error {
  constructor(code, status) {
    super(`Light Store: ${code}`);
    this.name = 'LightStoreError';
    this.code = code;
    this.status = status;
  }
}

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
  #pending;
  #cached;
  #expires = 0;

  constructor(config, { fetchImpl = globalThis.fetch } = {}) {
    this.#config = config;
    this.#fetch = fetchImpl;
  }

  async getCatalog() {
    if (this.#cached && Date.now() < this.#expires) return structuredClone(this.#cached);
    if (!this.#pending) {
      this.#pending = this.#requestCatalog().then((products) => {
        this.#cached = products;
        this.#expires = Date.now() + 30000;
        return products;
      }).finally(() => { this.#pending = undefined; });
    }
    return structuredClone(await this.#pending);
  }

  async #requestCatalog() {
    const controller = new AbortController();
    // Timer covers both response headers and the JSON body.
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);
    try {
      const response = await this.#fetch(`${this.#config.baseUrl.replace(/\/$/, '')}/catalog`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.#config.apiKey}`, Accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new LightStoreError('HTTP_ERROR', response.status);
      }
      let data;
      try { data = await response.json(); } catch {
        if (controller.signal.aborted) throw new LightStoreError('TIMEOUT');
        throw new LightStoreError('INVALID_JSON');
      }
      return parseCatalog(data);
    } catch (error) {
      if (controller.signal.aborted) throw new LightStoreError('TIMEOUT');
      if (error instanceof LightStoreError) throw error;
      // Do not expose request headers, response bodies or upstream error text.
      throw new LightStoreError('NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
    }
  }

  async findGeminiSixMonthOffers() {
    return findGeminiSixMonthOffers(await this.getCatalog());
  }
}
