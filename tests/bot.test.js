import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot/index.js';
import { MENU } from '../src/bot/keyboards/main.js';

function harness() {
  const calls = { register: 0, supplier: 0, wallet: 0 };
  const replies = [];
  const bot = createBot({ catalog: { categories: async () => ({ items: [], total: 0, page: 0, pages: 1 }) }, token: '123:mock', adminTelegramId: '42',
    users: { register: async () => { calls.register++; }, getWallet: async () => { calls.wallet++; return { balanceMinor: 50000, currency: 'UZS' }; } },
    supplier: { findGeminiSixMonthOffers: async () => { calls.supplier++; return [{ productId: 1, variantId: 2, title: 'Gemini AI Plus 6 months', stock: 2, available: true, supplierPriceMinor: 12345, currency: 'RUB' }]; } },
  });
  bot.botInfo = { id: 123, is_bot: true, username: 'ai_subs_test_bot', first_name: 'Test' };
  bot.context.reply = async (text, extra) => { replies.push({ text, extra }); };
  async function send(text, id = 42, type = 'private') {
    await bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: 1, chat: { id, type }, from: { id, is_bot: false, first_name: 'Test' }, text,
      ...(text.startsWith('/') ? { entities: [{ offset: 0, length: text.split(' ')[0].length, type: 'bot_command' }] } : {}),
    } });
  }
  return { calls, replies, send };
}

test('/start, every menu option, back and unknown text work through Telegraf', async () => {
  const h = harness();
  await h.send('/start');
  assert.equal(h.calls.register, 1);
  assert.match(h.replies.at(-1).text, /Assalomu alaykum/);
  assert.deepEqual(h.replies.at(-1).extra.reply_markup.keyboard.flat(), [MENU.buy, MENU.balance, MENU.referral, MENU.info]);
  await h.send(MENU.buy);
  assert.match(h.replies.at(-1).text, /Pul yechilmaydi/);
  await h.send(MENU.balance);
  assert.equal(h.calls.wallet, 1);
  assert.match(h.replies.at(-1).text, /Balansingiz/);
  await h.send(MENU.referral);
  assert.match(h.replies.at(-1).text, /bonus hisoblanmaydi/);
  await h.send(MENU.info);
  assert.match(h.replies.at(-1).text, /Phase 1/);
  await h.send(MENU.back);
  assert.match(h.replies.at(-1).text, /Bosh menyu/);
  await h.send('unknown');
  assert.match(h.replies.at(-1).text, /bo‘lim tanlang/);
});

test('/supplier_status is restricted by sender ID before any supplier request', async () => {
  const h = harness();
  await h.send('/supplier_status', 99);
  assert.equal(h.calls.supplier, 0);
  assert.match(h.replies.at(-1).text, /faqat administrator/);
  await h.send('/supplier_status', 42);
  assert.equal(h.calls.supplier, 1);
  assert.match(h.replies.at(-1).text, /Mahsulot ID: 1; variant ID: 2/);
  assert.match(h.replies.at(-1).text, /Qoldiq: 2/);
});

test('group messages cannot expose wallet or supplier data', async () => {
  const h = harness();
  await h.send('/supplier_status', 42, 'group');
  await h.send(MENU.balance, 42, 'group');
  assert.equal(h.replies.length, 0);
  assert.equal(h.calls.supplier, 0);
  assert.equal(h.calls.wallet, 0);
});
