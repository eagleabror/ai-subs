import { CallbackStore, pageButtons, shortText } from '../keyboards/catalog.js';
import { formatMoney } from '../../utils/money.js';
import { FulfillmentError, fulfillmentErrorCode } from '../../services/supplier-order.service.js';
const messages = { FULFILLMENT_KEY_REQUIRED: 'Supplier hisoblari uchun shifrlash kaliti hali sozlanmagan. Katalog va sinov wallet ishlashda davom etadi.',
  INPUT_MAPPING_UNDOCUMENTED: 'Bu mahsulot maydonlarining API xaritasi to‘liq hujjatlashtirilmagan. Avtomatik xarid o‘chirilgan.', SENSITIVE_INPUT_UNSUPPORTED: 'Bu tur qo‘lda ko‘rib chiqilishi kerak. Parol yoki maxfiy token yubormang.',
  MISSING_INPUT: 'Majburiy maydon yetishmayapti.', INVALID_INPUT: 'Kiritilgan maydon formati noto‘g‘ri.', UNSUPPORTED_REGION: 'Region mos kelmaydi.',
  OUT_OF_STOCK: 'Mahsulot yoki so‘ralgan miqdor mavjud emas.', QUANTITY_UNDOCUMENTED: 'Bu tur uchun bir hisobda faqat bitta buyurtma tekshiriladi.',
  INSUFFICIENT_SUPPLIER_BALANCE: 'Supplier balansi yetarli emas. Xarid bajarilmadi.', QUOTE_EXPIRED: 'Hisob muddati tugagan. Katalogdan qayta hisob oling.',
  PRICE_UNAVAILABLE: 'Yaroqli kurs yoki narx yo‘q. Checkout o‘chirilgan.', REAL_PURCHASE_DISABLED: 'Haqiqiy xarid o‘chirilgan. Sinov mablag‘i haqiqiy to‘lov emas.',
  ADMIN_ONLY: 'Bu bo‘lim faqat administrator uchun.', ORDER_NOT_FOUND: 'Buyurtma topilmadi.', DELIVERY_NOT_FOUND: 'Sizga tegishli tayyor yetkazish natijasi topilmadi.', START_REQUIRED: 'Avval /start buyrug‘ini yuboring.' };
const states = { pending_payment: 'To‘lov kutilmoqda', payment_confirmed: 'Sinov rezervi tasdiqlangan', supplier_quote_pending: 'Supplier hisobi olinmoqda', supplier_quoted: 'Supplier hisobi tayyor', supplier_ordering: 'Supplier javobi kutilmoqda', supplier_processing: 'Bajarilmoqda', completed: 'Bajarilgan', manual_review: 'Qo‘lda tekshirish kerak', failed: 'Xato', refunded: 'Sinov rezervi qaytarilgan' };
export function registerSupplierOrders(bot, service, delivery) {
  const store = new CallbackStore({ prefix: 'sup', ttl: 300000 }), pending = new Map();
  const button = (ctx, text, route) => ({ text, callback_data: store.put(ctx.from.id, route) });
  const keyboard = rows => ({ reply_markup: { inline_keyboard: rows } });
  const safe = fn => async ctx => { try { return await fn(ctx); } catch (e) { return ctx.reply(messages[e.code || e.message] || `Supplier amalini bajarib bo‘lmadi (${fulfillmentErrorCode(e)}). Xarid yuborilmadi.`); } };
  async function detail(ctx, record, admin = false) {
    const b = (label, route) => button(ctx, label, route), rows = [];
    let text = `📦 ${record._id}\n${shortText(record.title || '', 250)}${record.region ? `\nRegion: ${shortText(record.region, 50)}` : ''}\nHolat: ${states[record.state]}\nRejim: ${record.source === 'mock' ? 'MOCK sinov' : 'faqat supplier hisobi'}\nHaqiqiy xarid o‘chirilgan.`;
    if (record.priceSnapshot) text += `\nJami sotuv narxi: ${formatMoney(record.priceSnapshot.totalMinor, 'UZS')}\nMiqdor: ${record.quantity}\nHisob muddati: ${new Intl.DateTimeFormat('uz-UZ', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' }).format(new Date(record.quoteExpiresAt))} (Toshkent)`;
    if (admin && record.supplierCostMinor != null) text += `\nSupplier xarajati: ${formatMoney(record.supplierCostMinor, 'RUB')}\nKutilgan foyda: ${formatMoney(record.expectedProfitMinor, 'UZS')}\nManba: ${record.productType}\nYetkazish holati: ${record.deliveryStatus}\nXato: ${record.errorCode || 'yo‘q'}`;
    if (['supplier_ordering','supplier_processing','manual_review'].includes(record.state)) rows.push([b('🔄 Holatni tekshirish', { view: 'reconcile', id: record._id, admin })]);
    if (!admin && record.state === 'completed') rows.push([b('🔐 Natijani shaxsiy olish', { view: 'delivery', id: record._id })]);
    rows.push([b('⬅️ Buyurtmalar', { view: 'list', admin })]);
    return ctx.reply(text, keyboard(rows));
  }
  async function render(ctx, route) {
    if (route.admin) service.authorize(ctx.from.id);
    const b = (label, next) => button(ctx, label, next);
    if (route.view === 'status') {
      const s = await service.supplierStatus(ctx.from.id);
      return ctx.reply(`🔄 Supplier holati\nBalans: ${formatMoney(s.balanceMinor, 'RUB')}\nHaqiqiy xarid: o‘chirilgan\nShifrlash: ${s.encryptionReady ? 'tayyor' : 'sozlanmagan'}`);
    }
    if (route.view === 'settings') { service.authorize(ctx.from.id); return ctx.reply('⚙️ Avtomatik xarid o‘chirilgan.\nAUTO_PURCHASE_ENABLED=false\nSinov balansini haqiqiy to‘lov sifatida ishlatish mumkin emas. Bu panel xaridni yoqa olmaydi.'); }
    if (route.view === 'statistics') {
      const s = await service.statistics(ctx.from.id);
      return ctx.reply(`📊 Savdo statistikasi\nHaqiqiy savdo: 0 UZS\n${s.rows.map(r => `${r._id.source} · ${states[r._id.state]}: ${r.count}`).join('\n') || 'Hali buyurtma yo‘q.'}\nMock natijalar haqiqiy savdo hisoblanmaydi.`);
    }
    if (route.view === 'list') {
      const result = await service.list(ctx.from.id, route);
      const rows = result.items.map(r => [b(`${states[r.state]} · ${r._id.slice(0, 8)}`, { view: 'detail', id: r._id, admin: route.admin })]);
      rows.push(...pageButtons(result, route, b));
      return ctx.reply(`📦 Supplier buyurtmalari (${result.page + 1}/${result.pages})\n${result.total ? 'Buyurtmani tanlang.' : 'Buyurtma yo‘q.'}`, keyboard(rows));
    }
    if (route.view === 'detail') return detail(ctx, await service.get(ctx.from.id, route.id, route), route.admin);
    if (route.view === 'reconcile') return detail(ctx, await service.reconcile(ctx.from.id, route.id, route), route.admin);
    if (route.view === 'delivery') {
      // Explicit owner pull can recover an uncertain Telegram send. Never expose this to admins.
      for (const text of await delivery.messages(ctx.from.id, route.id)) await ctx.reply(text, { protect_content: true, link_preview_options: { is_disabled: true } });
    }
    if (route.view === 'preview') return detail(ctx, await service.preview(ctx.from.id, route.request));
  }
  async function prompt(ctx, entry) {
    if (entry.index < entry.fields.length) {
      const f = entry.fields[entry.index];
      pending.set(ctx.from.id, { ...entry, expires: Date.now() + 300000 });
      return ctx.reply(`${shortText(entry.title, 250)}\n${shortText(f.label, 150)}${f.options?.length ? ` (${f.options.join(', ')})` : ''}${f.min != null ? ` · ${f.min}–${f.max}` : ''}\nParol yoki to‘lov ma’lumotlarini yubormang. Bekor qilish: /supplier_orders.`);
    }
    pending.delete(ctx.from.id);
    return ctx.reply('Kiritilgan maydonlar supplierga faqat narx va mavjudlikni tekshirish uchun yuboriladi. Hisob olish mablag‘ yechmaydi.', keyboard([[button(ctx, '🧾 Supplier hisobini olish', { view: 'preview', request: entry.request })]]));
  }
  const start = safe(async (ctx) => {
    const { product, variant, quantity } = ctx.state.supplierStart;
    const schema = await service.inputSchema(ctx.from.id, product, variant);
    if (pending.size >= 1000) pending.delete(pending.keys().next().value);
    return prompt(ctx, { ...schema, index: 0, request: { product, variant, quantity, inputs: {} } });
  });
  bot.command('supplier_orders', safe(ctx => render(ctx, { view: 'list' })));
  bot.action(/^sup:/, safe(async ctx => {
    const route = store.get(ctx.from.id, ctx.callbackQuery.data);
    await ctx.answerCbQuery(route ? undefined : 'Tugma eskirgan. Menyuni qayta oching.');
    if (route) return render(ctx, route);
  }));
  bot.on('text', async (ctx, next) => {
    const entry = pending.get(ctx.from.id);
    if (!entry || entry.expires <= Date.now()) { pending.delete(ctx.from.id); return next(); }
    return safe(async () => {
      const value = ctx.message.text.trim();
      if (!value || value.length > 500 || /[\x00-\x1f\x7f]/.test(value)) throw new FulfillmentError('INVALID_INPUT');
      Object.defineProperty(entry.request.inputs, entry.fields[entry.index].name, { value, enumerable: true, configurable: true }); entry.index++;
      return prompt(ctx, entry);
    })(ctx);
  });
  return { reset: actor => pending.delete(actor), start: (ctx, product, variant, quantity = 1) => { ctx.state.supplierStart = { product, variant, quantity }; return start(ctx); },
    adminButtons: ctx => [ ['📦 Buyurtmalar', { view: 'list' }], ['🔄 Supplier holati', { view: 'status' }], ['🚚 Yetkazib berish', { view: 'list', delivery: true }],
      ['⚠️ Muammoli buyurtmalar', { view: 'list', problem: true }], ['📊 Savdo statistikasi', { view: 'statistics' }], ['⚙️ Avtomatik xarid sozlamalari', { view: 'settings' }] ].map(([label, route]) => [button(ctx, label, { ...route, admin: true })]) };
}
