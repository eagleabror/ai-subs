import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot/index.js';
import { AdminPricingError } from '../src/services/pricing/admin-pricing.service.js';
const C = 'a'.repeat(24), P = 'b'.repeat(24), V = 'c'.repeat(24);
function harness() {
  const replies = [], calls = [];
  const page = items => ({ items, page: 0, pages: 2, total: 7 });
  const fx = { mode: 'auto', displayRate: '100', acceptable: true, rate: { source: 'cbu', effectiveDate: '2026-11-20', fetchedAt: new Date('2026-11-23') }, errors: [] };
  const config = { markup: '20', rounding: '1000', minMarkup: '0', maxMarkup: '1000' };
  const admin = {
    pricing: { config }, fx: { config: { bufferPercent: '0' } },
    authorize: id => { if (![42,43].includes(Number(id))) throw new AdminPricingError('ADMIN_ONLY'); },
    settings: async () => ({ fx, settings: {}, config }),
    list: async (_id, scope, options) => { calls.push(['list', scope, options]); return page([{ _id: scope === 'category' ? C : scope === 'product' ? P : V, title: scope === 'category' ? 'AI' : scope === 'product' ? 'Example AI' : 'Pro' }]); },
    entity: async (_id, scope, target) => ({ _id: target, title: scope === 'product' ? 'Example AI' : 'Pro', enabled: true, hidden: false, markupOverride: null }),
    samples: async () => [{ variant: { title: 'Pro', supplierPriceMinor: 10000 }, context: { fx, markup: '20', markupSource: 'global' }, price: { convertedCostMinor: 1000000, bufferedCostMinor: 1000000, unitMinor: 1200000 } }],
    preview: async (_actor, change) => { calls.push(['preview', change]); if (change.value === '1001') throw new AdminPricingError('INVALID_MARKUP'); return { change, revision: 1, samples: [], currentFx: fx }; },
    save: async (_actor, preview) => { calls.push(['save', preview.change]); },
    refresh: async () => { calls.push(['refresh']); },
    history: async (_actor, p) => { calls.push(['history', p]); return { items: [], total: 0, page: 0, pages: 1 }; },
  };
  const checkout = {
    create: async (_user, variant, quantity) => { calls.push(['checkout', variant, quantity]); return { _id: 'quote1', fingerprint: 'fingerprint', snapshot: { variantTitle: 'Pro', quantity, unitMinor: 10000, totalMinor: quantity*10000, exchangeRate: { source: 'cbu', effectiveDate: '2026-11-20' } } }; },
    confirm: async (_user, id, fingerprint) => { calls.push(['confirm', id, fingerprint]); return { status: 'confirmed', order: { _id: 'order1', totalMinor: 10000 } }; },
    orders: async () => [],
  };
  const catalog = { categories: async () => page([{ _id: C, title: 'AI' }]), products: async () => page([{ _id: P, title: 'Example AI' }]), variants: async () => ({ ...page([{ _id: V, title: 'Pro' }]), product: { title: 'Example AI' } }), detail: async () => ({ product: { title: 'Example AI' }, variant: { _id: V, title: 'Pro', available: true, stock: 3, inputComplete: true }, price: { unitMinor: 10000, totalMinor: 10000 }, selectable: true, quantity: 1, maximum: 3 }) };
  const bot = createBot({ token: '123:mock', adminTelegramId: '42,43', supplier: {}, catalog, adminPricing: admin, checkout });
  bot.botInfo = { id: 123, is_bot: true, username: 'test_bot', first_name: 'Test' };
  bot.context.reply = bot.context.editMessageText = async (text, extra) => replies.push({ text, extra });
  bot.context.answerCbQuery = async text => { if (text) replies.push({ text }); };
  const msg = (id,text) => ({ message_id: 1, date: 1, chat: { id, type: 'private' }, from: { id, first_name: 'Test' }, text });
  async function send(text,id=42) { await bot.handleUpdate({ update_id: 1, message: { ...msg(id,text), ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) } }); }
  async function click(data,id=42) { await bot.handleUpdate({ update_id: 2, callback_query: { id: 'cb1', from: { id, first_name: 'Test' }, chat_instance: 'test', message: msg(id,'screen'), data } }); }
  const button = text => replies.at(-1).extra?.reply_markup.inline_keyboard.flat().find(b => b.text === text)?.callback_data;
  return { replies, calls, send, click, button };
}
test('admin menu product markup input is previewed before saving and reset can be confirmed', async () => {
  const h = harness(); await h.send('/admin'); await h.click(h.button('💰 Narxlarni boshqarish'));
  assert.match(h.replies.at(-1).text, /NARXLARNI BOSHQARISH/);
  await h.click(h.button('📦 Mahsulot ustamasi')); await h.click(h.button('AI')); await h.click(h.button('Example AI'));
  assert.match(h.replies.at(-1).text, /Supplier narxi/); assert.match(h.replies.at(-1).text, /Konvertatsiya xarajati/);
  await h.click(h.button('✏️ Ustamani o‘zgartirish')); await h.send('35');
  assert.equal(h.calls.filter(c => c[0] === 'save').length, 0); assert.match(h.replies.at(-1).text, /Saqlashdan oldingi/);
  await h.click(h.button('✅ Tasdiqlash va saqlash'));
  assert.deepEqual(h.calls.find(c => c[0] === 'save')[1], { scope: 'product', target: P, field: 'markup', value: '35' });
  await h.click(h.button('🔁 Standart ustamaga qaytish')); await h.click(h.button('✅ Tasdiqlash va saqlash'));
  assert.equal(h.calls.filter(c => c[0] === 'save').at(-1)[1].value, null);
});
test('variant navigation, pagination, global search and manual-rate/automatic controls are wired', async () => {
  const h = harness(); await h.send('/admin'); await h.click(h.button('💰 Narxlarni boshqarish')); await h.click(h.button('🎯 Variant ustamasi'));
  await h.click(h.button('AI')); await h.click(h.button('🔎 Mahsulot qidirish')); await h.send('Game, Region');
  assert.equal(h.calls.at(-1)[2].query, 'Game, Region');
  await h.click(h.button('Keyingi ➡️')); assert.equal(h.calls.at(-1)[2].page, 1);
  await h.click(h.button('Example AI')); assert.equal(h.calls.at(-1)[1], 'variant'); await h.click(h.button('Pro'));
  await h.click(h.button('✏️ Ustamani o‘zgartirish')); await h.send('1001'); assert.match(h.replies.at(-1).text, /ruxsat etilgan/);
  await h.send('25'); await h.click(h.button('✅ Tasdiqlash va saqlash')); assert.equal(h.calls.filter(c => c[0] === 'save').at(-1)[1].scope, 'variant');
  await h.send('/admin'); await h.click(h.button('💰 Narxlarni boshqarish')); await h.click(h.button('💱 RUB/UZS kursi'));
  assert.match(h.replies.at(-1).text, /Amal sanasi: 2026-11-20/); assert.match(h.replies.at(-1).text, /Yuklangan:/);
  await h.click(h.button('✏️ Qo‘lda kurs kiritish')); await h.send('150,25'); await h.click(h.button('✅ Tasdiqlash va saqlash'));
  assert.equal(h.calls.filter(c => c[0] === 'save').at(-1)[1].value, '150.25');
  await h.click(h.button('🔁 Avtomatik kursga qaytish')); await h.click(h.button('✅ Tasdiqlash va saqlash'));
  assert.equal(h.calls.filter(c => c[0] === 'save').at(-1)[1].value, 'auto');
});
test('unauthorized admin commands/callbacks and forwarded admin buttons cannot change settings', async () => {
  const h = harness(); await h.send('/admin',99); assert.match(h.replies.at(-1).text, /faqat administrator/);
  await h.send('/admin'); const data = h.button('💰 Narxlarni boshqarish');
  await h.click(data,99); assert.match(h.replies.at(-1).text, /faqat administrator/);
  await h.click(data,43); assert.match(h.replies.at(-1).text, /Tugma eskirgan/); assert.equal(h.calls.length, 0);
});
test('customer sandbox checkout requires an explicit confirmation and never consumes submitted prices', async () => {
  const h = harness(); await h.send('🛒 Obuna sotib olish',99); await h.click(h.button('AI'),99); await h.click(h.button('Example AI'),99); await h.click(h.button('Pro'),99);
  await h.click(h.button('🧪 Sinov buyurtmasi'),99); assert.match(h.replies.at(-1).text, /Pul yechilmaydi va mahsulot yetkazilmaydi/);
  assert.equal(h.calls.filter(c => c[0] === 'confirm').length, 0);
  await h.click(h.button('✅ Sinov buyurtmasini tasdiqlash'),99); assert.deepEqual(h.calls.at(-1), ['confirm','quote1','fingerprint']);
});
