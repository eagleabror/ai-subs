import { CallbackStore, pageButtons } from '../keyboards/catalog.js';
import { formatMoney } from '../../utils/money.js';
const messages = { START_REQUIRED: 'Avval /start buyrug‘ini yuboring.', SUPPLIER_UNAVAILABLE: 'Supplierni hozir tekshirib bo‘lmadi. Buyurtma tasdiqlanmadi.',
  SUPPLIER_QUOTE_REQUIRED: 'Bu mahsulot uchun supplierning yakuniy narx yoki qoldiq tasdig‘i kerak. Hozir faqat katalogni ko‘rish mumkin.',
  PRODUCT_UNAVAILABLE: 'Mahsulot mavjud emas yoki yashirilgan.', STOCK_LIMIT: 'Miqdor mavjud qoldiqdan oshdi. Katalogdan qayta tanlang.',
  PRICE_UNAVAILABLE: 'Yaroqli kurs yoki sotuv narxi yo‘q. Buyurtma tasdiqlanmadi.', QUOTE_EXPIRED: 'Hisob muddati tugadi. Katalogdan yangi hisob oling.', QUOTE_NOT_FOUND: 'Hisob topilmadi.',
  INSUFFICIENT_SANDBOX_BALANCE: 'Sinov balansi yetarli emas. /topup orqali sinov so‘rovi yarating. Haqiqiy pul yubormang.', ORDER_NOT_FOUND: 'Buyurtma topilmadi.' };
export function registerCheckout(bot, checkout) {
  const callbacks = new CallbackStore({ prefix: 'ord', ttl: 5 * 60000 });
  async function show(ctx, quote, changed = false) {
    const p = quote.snapshot;
    return ctx.reply(`${changed ? 'Narx yoki hisob shartlari o‘zgardi. Yangi hisobni qayta tasdiqlang.\n\n' : ''}Sinov buyurtmasi\n${String(p.variantTitle).slice(0, 200)}\nMiqdor: ${p.quantity}\nBirlik: ${formatMoney(p.unitMinor, 'UZS')}\nJami: ${formatMoney(p.totalMinor, 'UZS')}\nKurs manbasi: ${p.exchangeRate.source}; sana: ${p.exchangeRate.effectiveDate}\n\nPul yechilmaydi va mahsulot yetkazilmaydi.${checkout.wallets ? '\nSinov balansida jami summa 30 minutga rezerv qilinadi. Bekor qilinsa yoki muddat tugasa qaytariladi.' : ''}`, {
      reply_markup: { inline_keyboard: [[{ text: '✅ Sinov buyurtmasini tasdiqlash', callback_data: callbacks.put(ctx.from.id, { id: quote._id, fingerprint: quote.fingerprint }) }]] },
    });
  }
  async function error(ctx, e) { return ctx.reply(messages[e.code] || 'Sinov buyurtmasini bajarib bo‘lmadi. Pul yechilmadi.'); }
  const button = (ctx, text, route) => ({ text, callback_data: callbacks.put(ctx.from.id, route) });
  async function list(ctx, page = 0) {
    if (!checkout.listOrders) { const orders = await checkout.orders(ctx.from.id); return ctx.reply(orders.length ? orders.map(o => `${o._id}\n${formatMoney(o.totalMinor, 'UZS')} · sinov buyurtmasi`).join('\n\n') : 'Hozircha sinov buyurtmalari yo‘q.'); }
    await checkout.releaseExpired(ctx.from.id);
    const result = await checkout.listOrders(ctx.from.id, page), b = (text, route) => button(ctx, text, route);
    const rows = result.items.map(o => [b(`${formatMoney(o.totalMinor, 'UZS')} · ${o.status === 'cancelled' ? 'bekor qilingan' : 'sinov buyurtmasi'}`, { view: 'detail', id: String(o._id) })]);
    rows.push(...pageButtons(result, { view: 'list' }, b));
    return ctx.reply(`🧪 Buyurtmalar (${result.page + 1}/${result.pages})\n${result.total ? 'Tafsilotlar uchun buyurtmani tanlang.' : 'Hozircha sinov buyurtmalari yo‘q.'}`, { reply_markup: { inline_keyboard: rows } });
  }
  async function detail(ctx, order, cancelPreview = false) {
    const rows = [], b = (text, route) => button(ctx, text, route);
    let text = `🧪 Buyurtma: ${order._id}\n${String(order.pricingSnapshot?.variantTitle || '').slice(0, 200)}\nJami: ${formatMoney(order.totalMinor, 'UZS')}\nHolat: ${order.status === 'cancelled' ? 'bekor qilingan' : 'sinov tasdiqlangan'}\nRezerv: ${{ reserved: 'sinov mablag‘i band', released: 'qaytarilgan', unreserved: 'yo‘q' }[order.fundingStatus || 'unreserved']}\nHaqiqiy pul yechilmaydi; mahsulot yetkazilmaydi.`;
    if (order.reservationExpiresAt) text += `\nRezerv muddati: ${new Intl.DateTimeFormat('uz-UZ', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' }).format(new Date(order.reservationExpiresAt))} (Toshkent)`;
    if (order.status !== 'cancelled') {
      if (cancelPreview) text += '\n\nBuyurtmani bekor qilasizmi? Band sinov mablag‘i foydalanish uchun qaytariladi.';
      rows.push([b(cancelPreview ? '✅ Bekor qilishni tasdiqlash' : '❌ Buyurtmani bekor qilish', { view: cancelPreview ? 'cancel' : 'cancel_preview', id: String(order._id) })]);
    }
    rows.push([b('⬅️ Buyurtmalar', { view: 'list' })]);
    return ctx.reply(text, { reply_markup: { inline_keyboard: rows } });
  }
  bot.action(/^ord:/, async ctx => {
    const route = callbacks.get(ctx.from.id, ctx.callbackQuery.data);
    await ctx.answerCbQuery(route ? undefined : 'Tugma eskirgan. Yangi hisob oling.');
    if (!route) return;
    try {
      if (route.view === 'list') return await list(ctx, route.page);
      if (route.view === 'cancel') return await detail(ctx, await checkout.cancel(ctx.from.id, route.id));
      if (route.view === 'detail' || route.view === 'cancel_preview') return await detail(ctx, await checkout.getOrder(ctx.from.id, route.id), route.view === 'cancel_preview');
      const result = await checkout.confirm(ctx.from.id, route.id, route.fingerprint);
      if (result.status === 'changed') return show(ctx, result.quote, true);
      if (checkout.getOrder) return detail(ctx, result.order);
      return ctx.reply(`Sinov buyurtmasi saqlandi: ${result.order._id}\nJami: ${formatMoney(result.order.totalMinor, 'UZS')}\nPul yechilmadi. Yetkazish bajarilmaydi. /orders bilan ko‘rishingiz mumkin.`);
    } catch (e) { return error(ctx, e); }
  });
  bot.command('orders', async ctx => {
    try { return await list(ctx); } catch (e) { return error(ctx, e); }
  });
  return { create: async (ctx, variant, quantity) => { try { return show(ctx, await checkout.create(ctx.from.id, variant, quantity)); } catch (e) { return error(ctx, e); } } };
}
