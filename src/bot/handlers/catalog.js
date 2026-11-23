import { CallbackStore, shortText, pageButtons } from '../keyboards/catalog.js';
import { MENU } from '../keyboards/main.js';
import { formatMoney } from '../../utils/money.js';
const ROOT = { view: 'categories', page: 0 };
const NOTICE = 'Xarid hali yoqilmagan. Pul yechilmaydi.';
export function registerCatalog(bot, catalog) {
  const callbacks = new CallbackStore();
  const searchPending = new Map();
  bot.use((ctx, next) => {
    const text = ctx.message?.text;
    if (text && (text.startsWith('/') || Object.values(MENU).includes(text))) searchPending.delete(ctx.from.id);
    return next();
  });
  async function render(ctx, route, editing = false) {
    const button = (text, next) => ({ text: shortText(text), callback_data: callbacks.put(ctx.from.id, next) });
    const back = next => [button('⬅️ Orqaga', next)];
    let text, rows = [];
    if (route.view === 'categories') {
      const result = await catalog.categories(route.page);
      text = `🛒 Mahsulot kategoriyalari (${result.page + 1}/${result.pages})\n${NOTICE}`;
      if (!result.total) text += '\nKatalog hali tayyor emas. Administrator sinxronlashi kerak.';
      rows = result.items.map(c => [button(c.title, { view: 'products', category: c._id, page: 0, back: { ...route, page: result.page } })]);
      rows.push(...pageButtons(result, route, button), [button('🔎 Mahsulot qidirish', { view: 'search_prompt' })]);
    } else if (['products', 'search'].includes(route.view)) {
      const result = route.view === 'search' ? await catalog.search(route.query, route.page) : await catalog.products(route.category, route.page);
      if (!result) return render(ctx, ROOT, editing);
      text = `${route.view === 'search' ? `Qidiruv: ${shortText(route.query, 80)}` : 'Mahsulotlar'} (${result.page + 1}/${result.pages})`;
      if (!result.total) text += '\nMahsulot topilmadi.';
      rows = result.items.map(p => [button(p.title, { view: 'variants', product: p._id, page: 0, back: { ...route, page: result.page } })]);
      rows.push(...pageButtons(result, route, button), back(route.back || ROOT));
    } else if (route.view === 'variants') {
      const result = await catalog.variants(route.product, route.page);
      if (!result) return render(ctx, ROOT, editing);
      text = `${shortText(result.product.title, 250)}\nVariantlar (${result.page + 1}/${result.pages})`;
      if (result.refreshError) text += '\nYangilash vaqtincha ishlamayapti. Saqlangan ma’lumotlar ko‘rsatilmoqda.';
      if (!result.total) text += result.product.quoteRequired ? '\nYakuniy narx alohida hisoblanadi. Bu tur uchun miqdor tanlash hali yoqilmagan.' : '\nHozircha variant mavjud emas.';
      if (result.product.inputSchema?.length) text += `\nTalab qilinadigan maydonlar: ${result.product.inputSchema.map(f => shortText(f.label, 60)).join(', ').slice(0, 700)}`;
      rows = result.items.map(v => [button(`${v.available === false || v.stock === 0 ? '❌ ' : ''}${v.title}${v.region ? ` · ${v.region}` : ''}`, { view: 'detail', variant: v._id, quantity: 1, back: { ...route, page: result.page } })]);
      rows.push(...pageButtons(result, route, button), back(route.back || ROOT));
    } else if (route.view === 'detail') {
      const detail = await catalog.detail(route.variant, route.quantity);
      if (!detail) return render(ctx, ROOT, editing);
      const { variant: v, product: p, price, selectable, maximum } = detail;
      text = `${shortText(p.title, 200)}\n${shortText(v.title, 200)}`;
      text += `\nNarx: ${v.quoteRequired ? 'yakuniy hisob talab qilinadi' : price ? formatMoney(price.unitMinor, 'UZS') : 'sozlanmagan — administrator kursni tekshirishi kerak'}`;
      text += `\nMavjudlik: ${v.available === false || v.stock === 0 ? 'tugagan' : v.available === true ? 'mavjud' : 'yetkazib beruvchi aniq ko‘rsatmagan'}`;
      text += `\nQoldiq: ${v.stock ?? 'ko‘rsatilmagan'}`;
      if (v.region) text += `\nRegion: ${shortText(v.region, 60)}`;
      if (v.delivery) text += `\nYetkazish: ${shortText(v.delivery, 60)}`;
      text += `\nTalab qilinadigan maydonlar: ${v.inputSchema?.length ? v.inputSchema.map(f => shortText(f.label, 70)).join(', ').slice(0, 800) : 'yo‘q'}`;
      if (!v.inputComplete) text += '\nMaydonlar tavsifi to‘liq emas; miqdor tanlash o‘chirilgan.';
      if (v.quoteRequired) text += '\nYakuniy narx alohida hisoblanishi kerak; miqdor tanlash o‘chirilgan.';
      if (detail.stale || detail.refreshError) text += '\nMa’lumot eskirgan yoki yangilashda xato. Keyinroq qayta tekshiring.';
      if (selectable) {
        text += `\nMiqdor: ${detail.quantity}\nJami: ${formatMoney(price.totalMinor, 'UZS')}`;
        const controls = [];
        if (detail.quantity > 1) controls.push(button('➖', { ...route, quantity: detail.quantity - 1 }));
        if (detail.quantity < maximum) controls.push(button('➕', { ...route, quantity: detail.quantity + 1 }));
        if (controls.length) rows.push(controls);
      }
      text += `\n\n${NOTICE}\nBu bosqichda shaxsiy ma’lumot kiritish talab qilinmaydi.`;
      rows.push(back(route.back || ROOT));
    } else if (route.view === 'search_prompt') {
      if (searchPending.size >= 2000) searchPending.delete(searchPending.keys().next().value);
      searchPending.set(ctx.from.id, Date.now() + 300000);
      text = 'Mahsulot nomini yozing (80 belgigacha). Bekor qilish uchun katalog tugmasini bosing.';
      rows = [back(ROOT)];
    } else return;
    const extra = { reply_markup: { inline_keyboard: rows } };
    if (editing) {
      try { return await ctx.editMessageText(text, extra); }
      catch (error) { if (error.response?.description?.includes('message is not modified')) return; }
    }
    return ctx.reply(text, extra);
  }
  bot.hears(MENU.buy, ctx => render(ctx, ROOT));
  bot.command('search', ctx => render(ctx, { view: 'search_prompt' }));
  bot.action(/^cat:/, async ctx => {
    const route = callbacks.get(ctx.from.id, ctx.callbackQuery.data);
    await ctx.answerCbQuery(route ? undefined : 'Tugma eskirgan. Katalogni qayta oching.');
    if (!route) return;
    searchPending.delete(ctx.from.id);
    return render(ctx, route, true);
  });
  bot.on('text', async (ctx, next) => {
    if ((searchPending.get(ctx.from.id) || 0) <= Date.now()) { searchPending.delete(ctx.from.id); return next(); }
    const query = ctx.message.text.trim();
    if (!query || query.length > 80) return ctx.reply('Qidiruv 1–80 belgi bo‘lishi kerak.');
    searchPending.delete(ctx.from.id);
    // The query stays server-side in callback routes; no user input in callback_data.
    return render(ctx, { view: 'search', query, page: 0, back: ROOT });
  });
}
