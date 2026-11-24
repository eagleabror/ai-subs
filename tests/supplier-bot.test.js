import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot/index.js';
import { FulfillmentError } from '../src/services/supplier-order.service.js';
const P = 'a'.repeat(24), V = 'b'.repeat(24), C = 'c'.repeat(24);
function harness() {
  const calls = [], replies = [], page = items => ({ items, total: items.length, page: 0, pages: 1 });
  const record = { _id: 'order-uuid', telegramId: '99', state: 'completed', source: 'mock', quantity: 1, deliveryStatus: 'ready', supplierCostMinor: 1000, expectedProfitMinor: 100,
    quoteExpiresAt: new Date('2026-11-23T10:03:00Z'), priceSnapshot: { totalMinor: 120000 } };
  const authorize = id => { if (String(id) !== '42') throw new FulfillmentError('ADMIN_ONLY'); };
  const service = { authorize,
    inputSchema: async (actor, product, variant) => { calls.push(['schema', actor, product, variant]); return { title: 'Telegram example', fields: [{ name: 'Input1', label: 'Username', required: true }] }; },
    preview: async (actor, request) => { calls.push(['preview', actor, request]); return { ...record, state: 'supplier_quoted', source: 'lightstore' }; },
    list: async (actor, options) => { if (options.admin) authorize(actor); calls.push(['list', actor, options]); return page([record]); },
    get: async (actor, _id, options) => { if (options.admin) authorize(actor); else if (String(actor) !== '99') throw new FulfillmentError('ORDER_NOT_FOUND'); calls.push(['get', actor]); return record; },
    reconcile: async (actor, id, options) => { if (options.admin) authorize(actor); calls.push(['reconcile', actor, id]); return record; },
    supplierStatus: async actor => { authorize(actor); calls.push(['status', actor]); return { balanceMinor: 100000, encryptionReady: true }; },
    statistics: async actor => { authorize(actor); return { rows: [] }; },
  };
  const delivery = { messages: async (actor, id) => { if (String(actor) !== '99') throw new FulfillmentError('DELIVERY_NOT_FOUND'); calls.push(['delivery', actor, id]); return ['MOCK-SENSITIVE-CODE']; } };
  const catalog = { categories: async () => page([{ _id: C, title: 'Telegram' }]), products: async () => page([{ _id: P, title: 'Stars' }]), variants: async () => ({ ...page([{ _id: V, title: '50 Stars' }]), product: { _id: P, title: 'Stars' } }),
    detail: async () => ({ product: { _id: P, title: 'Stars' }, variant: { _id: V, title: '50 Stars', inputComplete: true, inputSchema: [{ label: 'Username' }], quoteRequired: true }, price: null, selectable: false, quantity: 1 }) };
  const bot = createBot({ token: '123:mock', adminTelegramId: '42', supplier: {}, catalog, adminPricing: { authorize }, supplierOrders: service, delivery });
  bot.botInfo = { id: 123, is_bot: true, username: 'test_bot', first_name: 'Test' };
  bot.context.reply = bot.context.editMessageText = async (text, extra) => replies.push({ text, extra });
  bot.context.answerCbQuery = async text => { if (text) replies.push({ text }); };
  const message = (id, text, type = 'private') => ({ message_id: 1, date: 1, chat: { id, type }, from: { id, first_name: 'Test' }, text });
  const send = (text, id = 99, type = 'private') => bot.handleUpdate({ update_id: 1, message: { ...message(id, text, type), ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) } });
  const click = (data, id = 99) => bot.handleUpdate({ update_id: 2, callback_query: { id: 'cb', from: { id, first_name: 'Test' }, chat_instance: 'test', message: message(id, ''), data } });
  const button = text => replies.at(-1).extra?.reply_markup.inline_keyboard.flat().find(b => b.text === text)?.callback_data;
  return { calls, replies, send, click, button };
}
test('customer enters only supplier-defined inputs and explicitly requests a non-charging quote', async () => {
  const h = harness(); await h.send('🛒 Obuna sotib olish'); await h.click(h.button('Telegram')); await h.click(h.button('Stars')); await h.click(h.button('50 Stars'));
  await h.click(h.button('🧾 Supplier hisobini tekshirish')); assert.match(h.replies.at(-1).text, /Username/);
  await h.send('private_user'); assert.match(h.replies.at(-1).text, /mablag‘ yechmaydi/); assert.equal(h.calls.filter(c => c[0] === 'preview').length, 0);
  const callback = h.button('🧾 Supplier hisobini olish'); assert.ok(!callback.includes('private_user')); assert.ok(Buffer.byteLength(callback) <= 64);
  await h.click(callback); assert.deepEqual(h.calls.find(c => c[0] === 'preview')[2], { product: P, variant: V, quantity: 1, inputs: { Input1: 'private_user' } });
  assert.match(h.replies.at(-1).text, /Haqiqiy xarid o‘chirilgan/); assert.ok(!h.replies.at(-1).text.includes('private_user'));
});
test('admin has six safe supplier controls and no purchase or delivery-secret action', async () => {
  const h = harness(); await h.send('/admin', 42);
  for (const label of ['📦 Buyurtmalar','🔄 Supplier holati','🚚 Yetkazib berish','⚠️ Muammoli buyurtmalar','📊 Savdo statistikasi','⚙️ Avtomatik xarid sozlamalari']) assert.ok(h.button(label));
  await h.click(h.button('⚙️ Avtomatik xarid sozlamalari'), 42); assert.match(h.replies.at(-1).text, /AUTO_PURCHASE_ENABLED=false/);
  await h.send('/admin', 42); await h.click(h.button('🚚 Yetkazib berish'), 42);
  await h.click(h.replies.at(-1).extra.reply_markup.inline_keyboard[0][0].callback_data, 42);
  assert.equal(h.button('🔐 Natijani shaxsiy olish'), undefined); assert.ok(!h.replies.at(-1).text.includes('MOCK-SENSITIVE'));
});
test('delivery is private owner-only; forwarded callbacks and groups cannot retrieve it', async () => {
  const h = harness(); await h.send('/supplier_orders'); await h.click(h.replies.at(-1).extra.reply_markup.inline_keyboard[0][0].callback_data);
  const data = h.button('🔐 Natijani shaxsiy olish'); await h.click(data, 42); assert.match(h.replies.at(-1).text, /Tugma eskirgan/);
  await h.click(data); assert.equal(h.replies.at(-1).text, 'MOCK-SENSITIVE-CODE'); assert.equal(h.replies.at(-1).extra.protect_content, true);
  const count = h.calls.length; await h.send('/supplier_orders', 99, 'group'); assert.equal(h.calls.length, count);
});
test('non-admin command and forwarded admin menu do not invoke supplier reads', async () => {
  const h = harness(); await h.send('/admin'); assert.match(h.replies.at(-1).text, /faqat administrator/);
  await h.send('/admin', 42); const token = h.button('🔄 Supplier holati'); await h.click(token); assert.match(h.replies.at(-1).text, /Tugma eskirgan/);
  assert.equal(h.calls.length, 0); await h.click(token, 42); assert.deepEqual(h.calls.at(-1), ['status', 42]);
});
