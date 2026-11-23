import { CallbackStore } from '../keyboards/catalog.js';
import { formatMoney } from '../../utils/money.js';
const messages = { START_REQUIRED: 'Avval /start buyrug‘ini yuboring.', SUPPLIER_UNAVAILABLE: 'Supplierni hozir tekshirib bo‘lmadi. Buyurtma tasdiqlanmadi.',
  SUPPLIER_QUOTE_REQUIRED: 'Bu mahsulot uchun supplierning yakuniy narx yoki qoldiq tasdig‘i kerak. Hozir faqat katalogni ko‘rish mumkin.',
  PRODUCT_UNAVAILABLE: 'Mahsulot mavjud emas yoki yashirilgan.', STOCK_LIMIT: 'Miqdor mavjud qoldiqdan oshdi. Katalogdan qayta tanlang.',
  PRICE_UNAVAILABLE: 'Yaroqli kurs yoki sotuv narxi yo‘q. Buyurtma tasdiqlanmadi.', QUOTE_EXPIRED: 'Hisob muddati tugadi. Katalogdan yangi hisob oling.', QUOTE_NOT_FOUND: 'Hisob topilmadi.' };
export function registerCheckout(bot, checkout) {
  const callbacks = new CallbackStore({ prefix: 'ord', ttl: 5 * 60000 });
  async function show(ctx, quote, changed = false) {
    const p = quote.snapshot;
    return ctx.reply(`${changed ? 'Narx yoki hisob shartlari o‘zgardi. Yangi hisobni qayta tasdiqlang.\n\n' : ''}Sinov buyurtmasi\n${String(p.variantTitle).slice(0, 200)}\nMiqdor: ${p.quantity}\nBirlik: ${formatMoney(p.unitMinor, 'UZS')}\nJami: ${formatMoney(p.totalMinor, 'UZS')}\nKurs manbasi: ${p.exchangeRate.source}; sana: ${p.exchangeRate.effectiveDate}\n\nPul yechilmaydi va mahsulot yetkazilmaydi.`, {
      reply_markup: { inline_keyboard: [[{ text: '✅ Sinov buyurtmasini tasdiqlash', callback_data: callbacks.put(ctx.from.id, { id: quote._id, fingerprint: quote.fingerprint }) }]] },
    });
  }
  async function error(ctx, e) { return ctx.reply(messages[e.code] || 'Sinov buyurtmasini bajarib bo‘lmadi. Pul yechilmadi.'); }
  bot.action(/^ord:/, async ctx => {
    const route = callbacks.get(ctx.from.id, ctx.callbackQuery.data);
    await ctx.answerCbQuery(route ? undefined : 'Tugma eskirgan. Yangi hisob oling.');
    if (!route) return;
    try {
      const result = await checkout.confirm(ctx.from.id, route.id, route.fingerprint);
      if (result.status === 'changed') return show(ctx, result.quote, true);
      return ctx.reply(`Sinov buyurtmasi saqlandi: ${result.order._id}\nJami: ${formatMoney(result.order.totalMinor, 'UZS')}\nPul yechilmadi. Yetkazish bajarilmaydi. /orders bilan ko‘rishingiz mumkin.`);
    } catch (e) { return error(ctx, e); }
  });
  bot.command('orders', async ctx => {
    const orders = await checkout.orders(ctx.from.id);
    return ctx.reply(orders.length ? orders.map(o => `${o._id}\n${formatMoney(o.totalMinor, 'UZS')} · sinov buyurtmasi`).join('\n\n') : 'Hozircha sinov buyurtmalari yo‘q.');
  });
  return { create: async (ctx, variant, quantity) => { try { return show(ctx, await checkout.create(ctx.from.id, variant, quantity)); } catch (e) { return error(ctx, e); } } };
}
