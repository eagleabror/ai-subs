import { createHash } from 'node:crypto';
import { SupplierBudget } from '../../models/SupplierOrder.js';
export class SupplierLimiter {
  constructor(apiKey, { now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    this.id = createHash('sha256').update(apiKey).digest('hex'); this.now = now; this.sleep = sleep;
  }
  async init() {
    try { await SupplierBudget.updateOne({ _id: this.id }, { $setOnInsert: { revision: 0 } }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
  }
  async acquire({ purchase = false } = {}) {
    for (;;) {
      const current = await SupplierBudget.findById(this.id).lean();
      if (!current) throw new Error('SUPPLIER_BUDGET_MISSING');
      const time = Math.max(this.now(), current.nextRequestAt?.getTime() || 0, current.blockedUntil?.getTime() || 0, purchase ? current.nextPurchaseAt?.getTime() || 0 : 0);
      // Reserve only when due. A crash cannot leave a long queue of phantom future slots.
      if (time > this.now()) { await this.sleep(Math.min(time - this.now(), 1000)); continue; }
      const next = { nextRequestAt: new Date(time + 1100), ...(purchase ? { nextPurchaseAt: new Date(time + 6100) } : {}) };
      const updated = await SupplierBudget.updateOne({ _id: this.id, revision: current.revision }, { $set: next, $inc: { revision: 1 } });
      if (updated.modifiedCount) return;
    }
  }
  async cooldown(until) { await SupplierBudget.updateOne({ _id: this.id }, { $max: { blockedUntil: new Date(until) } }); }
}
