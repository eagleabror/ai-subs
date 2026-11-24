import { SupplierOrder } from '../models/index.js';
import { FulfillmentError } from './supplier-order.service.js';
export function deliveryMessages(payload, { simulation = false } = {}) {
  const labels = { activation_link: 'Aktivatsiya havolasi', license_key: 'Litsenziya kaliti', gift_card: 'Gift card kodi', instructions: 'Yetkazish ko‘rsatmalari / supplier javobi', recharge: 'To‘ldirish tasdig‘i', manual: 'Qo‘lda yetkazish holati' };
  if (!payload || !Object.hasOwn(labels, payload.kind) || !Array.isArray(payload.values) || payload.values.some(v => typeof v !== 'string') || payload.values.join('').length > 64000) throw new FulfillmentError('INVALID_DELIVERY');
  // The supplier has no typed payload for standard products. Never infer a link/key from its text.
  if (payload.kind === 'activation_link') for (const value of payload.values) { let u; try { u = new URL(value); } catch { throw new FulfillmentError('INVALID_DELIVERY'); }
    if (u.protocol !== 'https:' || u.username || u.password) throw new FulfillmentError('INVALID_DELIVERY'); }
  const text = `${simulation ? '🧪 MOCK — haqiqiy mahsulot emas\n' : ''}${labels[payload.kind]}\n${payload.values.join('\n\n')}`;
  return Array.from({ length: Math.ceil(text.length / 3500) }, (_, i) => text.slice(i * 3500, (i + 1) * 3500));
}
export class DeliveryService {
  constructor(cipher, { now = () => new Date() } = {}) { this.cipher = cipher; this.now = now; }
  async messages(actor, id) {
    const row = await SupplierOrder.findOne({ _id: id, telegramId: String(actor), state: 'completed' }).select('+sealedDelivery').lean();
    if (!row?.sealedDelivery) throw new FulfillmentError('DELIVERY_NOT_FOUND');
    return deliveryMessages(this.cipher.open(row.sealedDelivery, `${id}:delivery`), { simulation: row.source === 'mock' });
  }
  async deliver(actor, id, send) {
    // Owner is checked before acquiring the outbox lease. Admin status access does not grant payload access.
    const owner = await SupplierOrder.findOne({ _id: id, telegramId: String(actor), state: 'completed' }).lean();
    if (!owner) throw new FulfillmentError('DELIVERY_NOT_FOUND');
    const row = await SupplierOrder.findOneAndUpdate({ _id: id, telegramId: String(actor), state: 'completed', deliveryStatus: 'ready' }, { $set: { deliveryStatus: 'sending', deliveryAttemptAt: this.now() } }, { new: true }).lean();
    if (!row) return { status: owner.deliveryStatus };
    try {
      const ids = [];
      for (const text of await this.messages(actor, id)) {
        const result = await send(row.telegramId, text, { protect_content: true, link_preview_options: { is_disabled: true } });
        if (Number.isSafeInteger(result?.message_id)) ids.push(result.message_id);
      }
      const saved = await SupplierOrder.updateOne({ _id: id, deliveryStatus: 'sending' }, { $set: { deliveryStatus: 'sent', deliveredAt: this.now(), deliveryMessageIds: ids } });
      return { status: saved.modifiedCount ? 'sent' : 'uncertain' };
    } catch {
      // Telegram has no documented message idempotency. A lost response must not cause an automatic resend.
      await SupplierOrder.updateOne({ _id: id, deliveryStatus: 'sending' }, { $set: { deliveryStatus: 'uncertain' } });
      return { status: 'uncertain' };
    }
  }
  async tick(send) {
    await SupplierOrder.updateMany({ deliveryStatus: 'sending', deliveryAttemptAt: { $lt: new Date(this.now().getTime() - 120000) } }, { $set: { deliveryStatus: 'uncertain' } });
    const rows = await SupplierOrder.find({ state: 'completed', deliveryStatus: 'ready' }).limit(5).lean();
    for (const row of rows) await this.deliver(row.telegramId, row._id, send);
  }
}
