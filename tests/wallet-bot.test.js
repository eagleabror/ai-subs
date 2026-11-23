import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot/index.js';
import { WalletError } from '../src/services/sandbox-wallet.service.js';
const ID = 'a'.repeat(24), ORDER = 'b'.repeat(24);
function harness() {
  const replies = [], calls = [];
  const payment = { _id: ID, telegramId: '99', status: 'pending', amountMinor: 100001, expiresAt: new Date('2026-11-24T10:00:00Z') };
  const order = { _id: ORDER, totalMinor: 100000, status: 'sandbox_confirmed', fundingStatus: 'reserved', reservationExpiresAt: new Date('2026-11-23T11:00:00Z'), pricingSnapshot: { variantTitle: 'Example product' } };
  const page = items => ({ items, total: items.length, pages: 2, page: 0 });
  const authorize = actor => { if (String(actor) !== '42') throw new WalletError('ADMIN_ONLY'); };
  const wallets = {
    account: async actor => { calls.push(['account', actor]); },
    balance: async actor => { calls.push(['balance', actor]); return { balanceMinor: 200000, reservedMinor: 100000, availableMinor: 100000 }; },
    history: async (actor, p) => { calls.push(['history', actor, p]); return page([]); },
  };
  const payments = { authorize,
    request: async (actor, amount, token) => { calls.push(['request', actor, amount, token]); return payment; },
    list: async (actor, options) => { if (options.admin) authorize(actor); calls.push(['list', actor, options]); return page([payment]); },
    get: async (actor, id, options) => { if (options.admin) authorize(actor); calls.push(['get', actor, id]); return payment; },
    decide: async (actor, id, decision) => { if (decision !== 'cancelled') authorize(actor); calls.push(['decide', actor, id, decision]); payment.status = decision; return payment; },
  };
  const checkout = {
    wallets, releaseExpired: async actor => { calls.push(['expiry', actor]); },
    listOrders: async (actor, p) => { calls.push(['orders', actor, p]); return page([order]); },
    getOrder: async (actor, id) => { calls.push(['order', actor, id]); return order; },
    cancel: async (actor, id) => { calls.push(['cancel', actor, id]); order.status = 'cancelled'; order.fundingStatus = 'released'; return order; },
  };
  const bot = createBot({ token: '123:mock', adminTelegramId: '42', supplier: {}, catalog: {}, wallets, payments, checkout,
    users: { getWallet: async () => ({ balanceMinor: 123, currency: 'UZS' }), ensureUser: async () => {} }, adminPricing: { authorize } });
  bot.botInfo = { id: 123, is_bot: true, username: 'test_bot', first_name: 'Test' };
  bot.context.reply = bot.context.editMessageText = async (text, extra) => { replies.push({ text, extra }); };
  bot.context.answerCbQuery = async text => { if (text) replies.push({ text }); };
  const msg = (id, text, type = 'private') => ({ message_id: 1, date: 1, chat: { id, type }, from: { id, first_name: 'Test' }, text });
  async function send(text, id = 99, type = 'private') { await bot.handleUpdate({ update_id: 1, message: { ...msg(id, text, type), ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) } }); }
  async function click(data, id = 99) { await bot.handleUpdate({ update_id: 2, callback_query: { id: 'cb1', from: { id, first_name: 'Test' }, chat_instance: 'test', message: msg(id, 'screen'), data } }); }
  const button = label => replies.at(-1).extra?.reply_markup.inline_keyboard.flat().find(b => b.text === label)?.callback_data;
  return { send, click, button, replies, calls };
}
test('balance shows real and sandbox amounts separately; top-up requires a preview and confirmation', async () => {
  const h = harness(); await h.send('💼 Balansim');
  assert.match(h.replies.at(-1).text, /Haqiqiy balans/); assert.match(h.replies.at(-1).text, /Sinov balansi/); assert.match(h.replies.at(-1).text, /Foydalanish mumkin/);
  await h.click(h.button('➕ Sinov balansini to‘ldirish')); assert.match(h.replies.at(-1).text, /Pul yubormang/);
  await h.send('1000,01'); assert.match(h.replies.at(-1).text, /So‘rovni yuborishdan oldin/);
  assert.equal(h.calls.filter(c => c[0] === 'request').length, 0);
  const data = h.button('✅ Sinov so‘rovini yuborish'); assert.ok(Buffer.byteLength(data) <= 64);
  await h.click(data); const request = h.calls.find(c => c[0] === 'request'); assert.deepEqual(request.slice(0, 3), ['request', 99, '1000.01']); assert.match(request[3], /^[a-zA-Z0-9_-]{16,80}$/);
  assert.match(h.replies.at(-1).text, /kutilmoqda/); assert.equal(h.calls.filter(c => c[0] === 'decide').length, 0);
});
test('invalid input retries safely; leaving a top-up prompt clears its state', async () => {
  const h = harness(); await h.send('/topup'); await h.send('1000.001'); assert.match(h.replies.at(-1).text, /2 kasr xonasi/);
  await h.send('1000'); assert.match(h.replies.at(-1).text, /So‘rovni yuborishdan oldin/);
  await h.send('/topup'); await h.click(h.button('⬅️ Balansga qaytish')); await h.send('2000');
  assert.match(h.replies.at(-1).text, /Quyidagi menyudan/); assert.equal(h.calls.filter(c => c[0] === 'request').length, 0);
});
test('payment admin menu previews approval before credit and exposes history navigation', async () => {
  const h = harness(); await h.send('/admin', 42); await h.click(h.button('🧪 To‘lov so‘rovlari'), 42);
  const select = h.replies.at(-1).extra.reply_markup.inline_keyboard[0][0].callback_data;
  await h.click(select, 42); assert.match(h.replies.at(-1).text, /Telegram ID: 99/);
  await h.click(h.button('✅ Sinov mablag‘ini qo‘shish'), 42); assert.match(h.replies.at(-1).text, /Faqat ko‘rsatilgan SINOV/);
  assert.equal(h.calls.filter(c => c[0] === 'decide').length, 0);
  await h.click(h.button('✅ Qarorni tasdiqlash'), 42); assert.deepEqual(h.calls.find(c => c[0] === 'decide'), ['decide', 42, ID, 'approved']);
  await h.click(h.button('⬅️ So‘rovlar'), 42); await h.click(h.button('📜 Barcha so‘rovlar'), 42);
  assert.equal(h.calls.filter(c => c[0] === 'list').at(-1)[2].all, true);
});
test('non-admin commands, forwarded callbacks and group messages cannot access payment controls', async () => {
  const h = harness(); await h.send('/payments'); assert.match(h.replies.at(-1).text, /faqat administrator/);
  await h.send('/admin', 42); const data = h.button('🧪 To‘lov so‘rovlari'); await h.click(data, 99);
  assert.match(h.replies.at(-1).text, /Tugma eskirgan/); assert.equal(h.calls.length, 0);
  await h.send('/wallet', 99, 'group'); await h.send('/payments', 42, 'group'); assert.equal(h.calls.length, 0);
});
test('customer request cancellation and order cancellation both require explicit confirmation', async () => {
  const h = harness(); await h.send('/wallet'); await h.click(h.button('📋 So‘rovlarim'));
  await h.click(h.replies.at(-1).extra.reply_markup.inline_keyboard[0][0].callback_data);
  await h.click(h.button('❌ So‘rovni bekor qilish')); assert.equal(h.calls.filter(c => c[0] === 'decide').length, 0);
  await h.click(h.button('✅ Qarorni tasdiqlash')); assert.deepEqual(h.calls.find(c => c[0] === 'decide'), ['decide', 99, ID, 'cancelled']);
  await h.send('/orders'); await h.click(h.replies.at(-1).extra.reply_markup.inline_keyboard[0][0].callback_data);
  assert.match(h.replies.at(-1).text, /sinov mablag‘i band/); await h.click(h.button('❌ Buyurtmani bekor qilish'));
  assert.equal(h.calls.filter(c => c[0] === 'cancel').length, 0);
  await h.click(h.button('✅ Bekor qilishni tasdiqlash')); assert.deepEqual(h.calls.find(c => c[0] === 'cancel'), ['cancel', 99, ORDER]); assert.match(h.replies.at(-1).text, /qaytarilgan/);
});
