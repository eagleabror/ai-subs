import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot/index.js';
import { MENU } from '../src/bot/keyboards/main.js';
import { CallbackStore } from '../src/bot/keyboards/catalog.js';
function harness() {
  const replies = [], calls = [], state = { hidden: false, stock: 3, price: true };
  const page = (items, total = items.length, current = 0, pages = 1) => ({ items, total, page: current, pages });
  const product = { _id: 'p1', title: 'Example AI', key: 'catalog:product:1' };
  const catalog = {
    categories: async p => { calls.push(['categories', p]); return page([{ _id: 'c1', title: 'AI' }], 7, p, 2); },
    products: async (id, p) => { calls.push(['products', id, p]); return page([product]); },
    variants: async (id, p) => { calls.push(['variants', id, p]); return { ...page([{ _id: 'v1', title: 'Pro' }]), product }; },
    detail: async (id, quantity) => { calls.push(['detail', id, quantity]); return state.hidden ? null : { product, variant: { title: 'Pro', stock: state.stock, available: state.stock > 0, inputComplete: true, inputSchema: [{ name: 'user_input', label: 'Account email' }] }, price: state.price ? { unitMinor: 10000, totalMinor: 10000 * quantity } : null, selectable: state.stock > 0 && state.price, maximum: state.stock, quantity }; },
    search: async (query, p) => { calls.push(['search', query, p]); return page([product], 7, p, 2); },
    syncAll: async () => { calls.push(['sync']); return { sources: [], loaded: 1, errors: 0 }; },
    status: async () => { calls.push(['status']); return { categories: 7, products: 14, variants: 15, detailsLoaded: 4, states: [] }; },
    pricingSettings: async () => { calls.push(['pricing']); return { rate: null, markup: '0', rounding: '1', overrides: {}, errors: ['RUB_TO_UZS_RATE'] }; },
    setMarkup: async (...args) => { calls.push(['markup', ...args]); return true; },
    setProductEnabled: async (...args) => { calls.push(['enabled', ...args]); return true; },
    adminProducts: async query => { calls.push(['adminProducts', query]); return [product]; },
  };
  const bot = createBot({ token: '123:mock', adminTelegramId: '42,43', supplier: {}, catalog, users: { register: async () => {} } });
  bot.botInfo = { id: 123, is_bot: true, username: 'test_bot', first_name: 'Test' };
  bot.context.reply = bot.context.editMessageText = async (text, extra) => { replies.push({ text, extra }); };
  bot.context.answerCbQuery = async text => { if (text) replies.push({ text }); };
  const from = id => ({ id, is_bot: false, first_name: 'Test' });
  const msg = (id, text) => ({ message_id: 1, date: 1, chat: { id, type: 'private' }, from: from(id), text });
  async function send(text, id = 42) {
    await bot.handleUpdate({ update_id: 1, message: { ...msg(id, text), ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) } });
  }
  async function click(data, id = 42) { await bot.handleUpdate({ update_id: 2, callback_query: { id: 'cb1', from: from(id), chat_instance: 'test', message: msg(id, 'catalog'), data } }); }
  function button(label) { const buttons = replies.at(-1).extra?.reply_markup.inline_keyboard.flat() || []; return buttons.find(b => b.text === label)?.callback_data; }
  return { replies, calls, state, send, click, button };
}
test('inline categories -> products -> variants -> details -> quantity; back preserves location', async () => {
  const h = harness(); await h.send(MENU.buy);
  await h.click(h.button('Keyingi ➡️')); assert.deepEqual(h.calls.at(-1), ['categories', 1]);
  await h.click(h.button('AI')); assert.deepEqual(h.calls.at(-1), ['products', 'c1', 0]);
  await h.click(h.button('Example AI')); await h.click(h.button('Pro'));
  assert.match(h.replies.at(-1).text, /Account email/); assert.match(h.replies.at(-1).text, /Pul yechilmaydi/);
  await h.click(h.button('➕')); assert.deepEqual(h.calls.at(-1), ['detail', 'v1', 2]);
  assert.match(h.replies.at(-1).text, /Miqdor: 2/);
  await h.click(h.button('⬅️ Orqaga')); assert.deepEqual(h.calls.at(-1), ['variants', 'p1', 0]);
  await h.click(h.button('⬅️ Orqaga')); await h.click(h.button('⬅️ Orqaga'));
  assert.deepEqual(h.calls.at(-1), ['categories', 1]);
});
test('search prompt, paginated results and back retain original query', async () => {
  const h = harness(); await h.send('/search'); await h.send('Steam [US]');
  assert.deepEqual(h.calls.at(-1), ['search', 'Steam [US]', 0]);
  await h.click(h.button('Keyingi ➡️')); await h.click(h.button('Example AI'));
  await h.click(h.button('⬅️ Orqaga')); assert.deepEqual(h.calls.at(-1), ['search', 'Steam [US]', 1]);
  await h.send('/search'); await h.send(MENU.buy); await h.send('unrelated');
  assert.match(h.replies.at(-1).text, /bo‘lim tanlang/);
});
test('out-of-stock and missing prices remove quantity buttons; old callbacks recheck visibility', async () => {
  const h = harness(); await h.send(MENU.buy); await h.click(h.button('AI')); await h.click(h.button('Example AI'));
  const detail = h.button('Pro'); h.state.stock = 0; await h.click(detail);
  assert.match(h.replies.at(-1).text, /tugagan/); assert.equal(h.button('➕'), undefined);
  h.state.stock = 3; h.state.price = false; await h.click(detail);
  assert.match(h.replies.at(-1).text, /kursni tekshirishi kerak/); assert.equal(h.button('➕'), undefined);
  h.state.hidden = true; await h.click(detail); assert.deepEqual(h.calls.at(-1), ['categories', 0]);
});
test('opaque callback tokens fit Telegram limit, reject tampering, other users and expired tokens', async () => {
  let now = 0; const store = new CallbackStore({ now: () => now, ttl: 10, limit: 2 });
  const token = store.put(42, { id: '😀'.repeat(500) });
  assert.ok(Buffer.byteLength(token) <= 64); assert.equal(store.get(99, token), null); assert.equal(store.get(42, 'cat:forged'), null);
  assert.ok(store.get(42, token)); now = 11; assert.equal(store.get(42, token), null);
  const h = harness(); await h.send(MENU.buy); const data = h.button('AI'); const previous = h.calls.length;
  await h.click(data, 99); assert.equal(h.calls.length, previous); assert.match(h.replies.at(-1).text, /Tugma eskirgan/);
});
test('every catalog/admin control requires authorized sender ID, including a configured second admin', async () => {
  const h = harness();
  const commands = ['/catalog_sync','/catalog_status','/products_count','/pricing_settings','/set_markup 20','/hide_product catalog:product:1','/enable_product catalog:product:1','/product_settings Example'];
  for (const command of commands) { await h.send(command, 99); assert.match(h.replies.at(-1).text, /faqat administrator/); }
  assert.equal(h.calls.length, 0);
  for (const command of commands) await h.send(command, 43);
  assert.ok(h.calls.some(c => c[0] === 'sync')); assert.ok(h.calls.some(c => c[0] === 'markup'));
  assert.deepEqual(h.calls.filter(c => c[0] === 'enabled').map(c => c[2]), [false, true]);
});
