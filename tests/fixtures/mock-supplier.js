import { adaptSubscriptions } from '../../src/services/catalog/subscriptions.adapter.js';
import { adaptGamesCatalog, adaptGameDetails } from '../../src/services/catalog/games.adapter.js';
import { gameQuoteResponse, orderResponse, purchaseRequest } from '../../src/services/supplier/contracts.js';
import { LightStoreError } from '../../src/services/lightstore.service.js';
import { subscriptions, games, steam, gift, telegram, mobile } from './universal.js';
// No fetch/network capability. This fixture is never imported by src/server.js.
export class MockSupplier {
  mode = 'mock';
  constructor(store = { orders: new Map(), quotes: new Map(), identities: new Map() }) {
    this.store = store; this.calls = []; this.balance = 100000000; this.price = 10000; this.expiresIn = 180; this.enabled = true;
    this.creationStatus = 'processing'; this.status = 'completed'; this.values = ['SYNTHETIC-CODE-NOT-A-REAL-PRODUCT'];
    this.catalog = structuredClone(subscriptions); this.details = { steam_games: structuredClone(steam), gift_cards: structuredClone(gift), telegram: structuredClone(telegram), mobile_games: structuredClone(mobile) };
    this.details.mobile_games.servers = {}; this.fail = null; this.loseResponse = false;
  }
  async getCatalogSnapshot() { return adaptSubscriptions(this.catalog); }
  async getGamesCatalog() { return adaptGamesCatalog(structuredClone(games)); }
  async getGameDetails(product) { return adaptGameDetails(this.details[product.kind], product); }
  async getBalance() { this.calls.push(['balance']); return this.balance; }
  async getCatalogItem(id) { const variant = (await this.getCatalogSnapshot()).variants.find(v => v.supplierVariantId === String(id)); return { id: String(id), price: variant.supplierPriceMinor, stock: variant.stock, available: variant.available, delivery: variant.delivery }; }
  async checkSteam() { return this.canSteam !== false; }
  async quoteGame(body) {
    this.calls.push(['quote', structuredClone(body)]); if (this.failQuote) throw this.failQuote;
    const id = `quote_${this.store.quotes.size + 1}`; this.store.quotes.set(id, structuredClone(body));
    return gameQuoteResponse({ ok: true, quote_id: id, price: this.price, price_unit: 'kopecks', balance: this.balance, expires_in: this.expiresIn, enabled: this.enabled });
  }
  async createSupplierOrder(channel, request) {
    const expected = purchaseRequest(channel, request.body, request.headers['Idempotency-Key']);
    if (JSON.stringify(expected) !== JSON.stringify(request)) throw new Error('unexpected mock contract');
    this.calls.push(['purchase', structuredClone(request)]);
    if (this.fail) throw this.fail;
    const identity = channel === 'games' ? request.body.quote_id : request.headers['Idempotency-Key'];
    let order = this.store.identities.get(identity);
    if (!order) {
      const price = channel === 'games' ? this.price : (await this.getCatalogItem(request.body.variant_id)).price * request.body.quantity;
      const id = channel === 'games' ? `mock_${this.store.orders.size + 1}` : String(1000 + this.store.orders.size);
      const status = channel === 'games' ? this.creationStatus : this.creationStatus === 'completed' ? 'completed' : 'paid';
      order = { id, channel, status, price, delivery: status === 'completed' ? this.values : [] };
      this.store.orders.set(id, order); this.store.identities.set(identity, order);
    }
    if (this.loseResponse) { this.loseResponse = false; throw new LightStoreError('TIMEOUT'); }
    return orderResponse(channel === 'games' ? { ok: true, order: { order_id: order.id, status: order.status, price: order.price, delivery: order.delivery } } : { ok: true, order_id: Number(order.id), status: order.status, price: order.price, delivered_data: order.delivery.join('\n') }, channel, { creation: true });
  }
  async getSupplierOrder(channel, id) {
    this.calls.push(['status', channel, id]); if (this.failStatus) throw this.failStatus;
    const o = this.store.orders.get(id); if (!o) throw new LightStoreError('HTTP_ERROR', 404);
    const status = channel === 'games' ? this.status : this.status === 'refunded' ? 'declined' : this.status === 'completed' ? 'completed' : 'paid';
    return orderResponse(channel === 'games' ? { ok: true, order: { order_id: id, status, delivery: status === 'completed' ? this.values : [] } } : { ok: true, order_id: Number(id), status, delivered_data: status === 'completed' ? this.values.join('\n') : '' }, channel);
  }
  async listSupplierOrders() { this.calls.push(['list']); if (this.failList) throw this.failList; return [...this.store.orders.values()]; }
}
