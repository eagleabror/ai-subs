import { adminOnly } from '../middleware/admin.js';
import { CallbackStore, shortText, pageButtons } from '../keyboards/catalog.js';
import { formatMoney } from '../../utils/money.js';
import { MENU } from '../keyboards/main.js';
const HOME = { view: 'home' }, PRICE_HOME = { view: 'pricing' };
const labels = { global: 'Umumiy', category: 'Kategoriya', product: 'Mahsulot', variant: 'Variant' };
const errors = {
  ADMIN_ONLY: 'Bu bo‘lim faqat administrator uchun.', INVALID_MARKUP: 'Ustama ruxsat etilgan oraliqda bo‘lishi kerak.',
  INVALID_ROUNDING: 'Yaxlitlash qadami musbat bo‘lishi va tiyin aniqligiga mos kelishi kerak.', INVALID_RATE: 'Kurs musbat o‘nlik son bo‘lishi kerak.',
  PREVIEW_CHANGED: 'Sozlamalar o‘zgardi. Yangi hisobni ko‘rib, yana tasdiqlang.', PREVIEW_EXPIRED: 'Hisob muddati tugadi. O‘zgarishni qayta kiriting.',
};
const date = value => value ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'yo‘q';
function sampleText(sample) {
  const { variant: v, context: c, price: p } = sample;
  return `${shortText(v.title, 100)}${v.region ? ` · ${shortText(v.region, 40)}` : ''}\nSupplier narxi: ${formatMoney(v.supplierPriceMinor, 'RUB')}\nKurs: ${c?.fx.displayRate || 'yaroqli kurs yo‘q'} UZS\nKonvertatsiya xarajati: ${p ? formatMoney(p.convertedCostMinor, 'UZS') : 'hisoblanmadi'}\nFX buferli xarajat: ${p ? formatMoney(p.bufferedCostMinor, 'UZS') : 'hisoblanmadi'}\nUstama: ${c?.markup ?? '—'}% (${labels[c?.markupSource] || '—'})\nSotuv narxi: ${p ? formatMoney(p.unitMinor, 'UZS') : 'o‘chirilgan'}`;
}
export function registerAdminPricing(bot, service, adminIds, walletPanel, supplierPanel) {
  const store = new CallbackStore({ prefix: 'adm', ttl: 5 * 60000 }), pending = new Map();
  const auth = adminOnly(adminIds);
  async function render(ctx, route, editing = false) {
    service.authorize(ctx.from.id);
    const button = (title, next) => ({ text: shortText(title), callback_data: store.put(ctx.from.id, next) });
    const back = next => [button('⬅️ Orqaga', next || PRICE_HOME)];
    let text = '', rows = [];
    if (route.view === 'home') {
      text = 'Administrator paneli'; rows = [[button('💰 Narxlarni boshqarish', PRICE_HOME)]];
      if (walletPanel) rows.push([walletPanel.adminButton(ctx)]);
      if (supplierPanel) rows.push(...supplierPanel.adminButtons(ctx));
    } else if (route.view === 'pricing') {
      text = '💰 NARXLARNI BOSHQARISH';
      rows = [[button('💱 RUB/UZS kursi', { view: 'fx' })], [button('📊 Umumiy ustama', { view: 'global' })],
        [button('📁 Kategoriya ustamasi', { view: 'list', scope: 'category', mode: 'category', page: 0 })],
        [button('📦 Mahsulot ustamasi', { view: 'list', scope: 'category', mode: 'product', page: 0 })],
        [button('🎯 Variant ustamasi', { view: 'list', scope: 'category', mode: 'variant', page: 0 })],
        [button('⚙️ Yaxlitlash sozlamalari', { view: 'rounding' })], [button('🔄 Kursni yangilash', { view: 'refresh' })],
        [button('📜 Narx o‘zgarishlari tarixi', { view: 'history', page: 0 })], back(HOME)];
    } else if (route.view === 'fx') {
      const { fx, settings } = await service.settings(ctx.from.id);
      text = `💱 RUB/UZS kursi\nRejim: ${fx.mode}\nManba: ${fx.rate?.source || 'yo‘q'}\n1 RUB: ${fx.displayRate || '—'} UZS\nAmal sanasi: ${fx.rate?.effectiveDate || '—'}\nYuklangan: ${date(fx.rate?.fetchedAt)}\nHolat: ${fx.acceptable ? 'yaroqli' : 'checkout o‘chirilgan — kurs yo‘q yoki eskirgan'}\nOxirgi urinish: ${date(fx.lastAttempt)}\nXato: ${fx.lastError || fx.errors.join(', ') || 'yo‘q'}\nFX xarajat buferi: ${settings.fxBufferPercent ?? service.fx.config.bufferPercent}%\nCBU kursi ma’lumot uchun; supplierning haqiqiy xarid kursidan farq qilishi mumkin.`;
      rows = [[button('✏️ Qo‘lda kurs kiritish', { view: 'input', scope: 'fx', target: 'RUB', field: 'manual', back: route })],
        [button('🔁 Avtomatik kursga qaytish', { view: 'propose', change: { scope: 'fx', target: 'RUB', field: 'mode', value: 'auto' }, back: route })],
        [button('⚙️ FX xarajat buferi', { view: 'input', scope: 'global', target: 'global', field: 'fxBufferPercent', back: route })],
        [button('🔄 Kursni yangilash', { view: 'refresh' })], back()];
    } else if (route.view === 'refresh') {
      await ctx.reply('CBU kursi yangilanmoqda…');
      try { await service.refresh(ctx.from.id); } catch { await ctx.reply('CBU kursini yangilab bo‘lmadi. Oldingi yaroqli kurs saqlandi.'); }
      return render(ctx, { view: 'fx' }, editing);
    } else if (route.view === 'global' || route.view === 'rounding') {
      const { settings, config } = await service.settings(ctx.from.id), rounding = route.view === 'rounding';
      text = rounding ? `Yaxlitlash qadami: ${settings.rounding ?? config.rounding} UZS\nHar bir birlik narxi yuqoriga yaxlitlanadi.` : `Umumiy ustama: ${settings.markup ?? config.markup}%\nRuxsat etilgan oraliq: ${config.minMarkup}–${config.maxMarkup}%`;
      rows = [[button('✏️ O‘zgartirish', { view: 'input', scope: 'global', target: 'global', field: rounding ? 'rounding' : 'markup', back: route })], back()];
    } else if (route.view === 'list') {
      const result = await service.list(ctx.from.id, route.scope, route);
      text = `${labels[route.scope]} tanlang (${result.page + 1}/${result.pages})${route.query ? `\nQidiruv: ${shortText(route.query, 80)}` : ''}`;
      if (!result.items.length) text += '\nNatija topilmadi. Katalogni /catalog_sync bilan yangilang.';
      const here = { ...route, page: result.page };
      rows = result.items.map(item => {
        let next;
        if (route.scope === 'category' && route.mode !== 'category') next = { view: 'list', scope: 'product', mode: route.mode, parent: item._id, page: 0, back: here };
        else if (route.scope === 'product' && route.mode === 'variant') next = { view: 'list', scope: 'variant', mode: 'variant', parent: item._id, page: 0, back: here };
        else next = { view: 'entity', scope: route.scope, target: item._id, back: here };
        return [button(`${item.hidden || item.enabled === false || item.present === false ? '👁‍🗨 ' : ''}${item.title}${item.region ? ` · ${item.region}` : ''}`, next)];
      });
      rows.push(...pageButtons(result, route, button));
      if (route.scope === 'product') rows.push([button('🔎 Mahsulot qidirish', { view: 'search', back: here })]);
      rows.push(back(route.back));
    } else if (route.view === 'search') {
      if (pending.size >= 1000) pending.delete(pending.keys().next().value);
      pending.set(ctx.from.id, { route, expires: Date.now() + 300000 });
      text = 'Mahsulot nomini yozing (1–80 belgi). Qidiruv barcha kategoriyalarni qamraydi.'; rows = [back(route.back)];
    } else if (route.view === 'entity') {
      const item = await service.entity(ctx.from.id, route.scope, route.target);
      if (!item) return render(ctx, PRICE_HOME, editing);
      text = `${labels[route.scope]}: ${shortText(item.title, 180)}\nShaxsiy ustama: ${item.markupOverride ?? 'meros olinadi'}${item.markupOverride != null ? '%' : ''}`;
      if (route.scope === 'product') text += `\nHolat: ${item.hidden || !item.enabled ? 'yashirilgan' : 'yoqilgan'}`;
      const samples = await service.samples(ctx.from.id, route.scope, route.target);
      text += `\n\n${samples.map(sampleText).join('\n\n') || 'Narx namunasi uchun variant tafsilotlarini /catalog_sync orqali yuklang.'}`;
      rows = [[button('✏️ Ustamani o‘zgartirish', { view: 'input', scope: route.scope, target: route.target, field: 'markup', back: route })],
        [button('🔁 Standart ustamaga qaytish', { view: 'propose', change: { scope: route.scope, target: route.target, field: 'markup', value: null }, back: route })]];
      if (route.scope === 'product') rows.push([button(item.hidden || !item.enabled ? '👁 Mahsulotni yoqish' : '👁 Mahsulotni yashirish', { view: 'propose', change: { scope: 'product', target: route.target, field: 'enabled', value: item.hidden || !item.enabled }, back: route })]);
      rows.push(back(route.back));
    } else if (route.view === 'input') {
      if (pending.size >= 1000) pending.delete(pending.keys().next().value);
      pending.set(ctx.from.id, { route, expires: Date.now() + 300000 });
      text = route.field === 'markup' ? `Yangi ustamani foizda kiriting (${service.pricing.config.minMarkup}–${service.pricing.config.maxMarkup}).` : route.field === 'manual' ? '1 RUB uchun yangi UZS kursini kiriting. Qo‘lda o‘zgartirish auditda qayd etiladi.' : route.field === 'rounding' ? 'Yaxlitlash qadamini UZSda kiriting.' : 'FX xarajat buferini foizda kiriting (0–1000).';
      rows = [back(route.back)];
    } else if (route.view === 'propose' || route.view === 'save') {
      const preview = route.view === 'propose' ? await service.preview(ctx.from.id, route.change) : route.preview;
      if (route.view === 'save') {
        try { await service.save(ctx.from.id, preview); await ctx.reply('Sozlama saqlandi va auditga yozildi.'); return render(ctx, route.back || PRICE_HOME, editing); }
        catch (error) {
          if (error.code === 'PREVIEW_CHANGED') { await ctx.reply(errors.PREVIEW_CHANGED); return render(ctx, { view: 'propose', change: preview.change, back: route.back }, editing); }
          throw error;
        }
      }
      text = `Saqlashdan oldingi hisob\n${labels[preview.change.scope] || 'Kurs'} · ${{ markup: 'Ustama', enabled: 'Mahsulot holati', manual: 'Qo‘lda kurs', mode: 'Kurs rejimi', rounding: 'Yaxlitlash', fxBufferPercent: 'FX xarajat buferi' }[preview.change.field]}: ${preview.change.value ?? 'meros olish'}\n\n${preview.samples.map(sampleText).join('\n\n')}`;
      if (preview.change.scope === 'fx') text += `Kurs rejimi: ${preview.currentFx.mode}; joriy: ${preview.currentFx.displayRate || 'yo‘q'} UZS.\nYangi ${preview.change.field === 'manual' ? `qo‘lda kurs: ${preview.change.value} UZS` : 'rejim: auto'}.\nBarcha yangi hisoblar shu sozlamadan foydalanadi; tasdiqlangan order narxi o‘zgarmaydi.`;
      text += '\nFaqat ko‘rsatilgan sozlama saqlanadi. Narxlar serverda qayta hisoblanadi.';
      rows = [[button('✅ Tasdiqlash va saqlash', { view: 'save', preview, back: route.back })], back(route.back)];
    } else if (route.view === 'history') {
      const result = await service.history(ctx.from.id, route.page);
      text = `📜 Narx o‘zgarishlari tarixi (${result.page + 1}/${result.pages})\n${result.items.map(item => `${date(item.createdAt)} · ${item.actorId}\n${item.action} · ${item.scope}:${item.target}\n${shortText(JSON.stringify(item.before), 180)} → ${shortText(JSON.stringify(item.after), 180)}`).join('\n\n') || 'Hali o‘zgarish yo‘q.'}`;
      rows = [...pageButtons(result, route, button), back()];
    }
    const extra = { reply_markup: { inline_keyboard: rows } };
    if (editing) { try { return await ctx.editMessageText(text.slice(0, 4000), extra); } catch (error) { if (error.response?.description?.includes('message is not modified')) return; } }
    return ctx.reply(text.slice(0, 4000), extra);
  }
  const safely = handler => async ctx => { try { return await handler(ctx); } catch (error) { return ctx.reply(errors[error.code] || 'Sozlamani bajarib bo‘lmadi. Qayta urinib ko‘ring.'); } };
  bot.use((ctx, next) => {
    const text = ctx.message?.text;
    if (ctx.callbackQuery || (text && (text.startsWith('/') || Object.values(MENU).includes(text)))) pending.delete(ctx.from.id);
    return next();
  });
  bot.command('admin', auth, safely(ctx => render(ctx, HOME)));
  bot.action(/^adm:/, auth, safely(async ctx => {
    const route = store.get(ctx.from.id, ctx.callbackQuery.data);
    await ctx.answerCbQuery(route ? undefined : 'Tugma eskirgan. /admin ni qayta oching.');
    if (route) return render(ctx, route, true);
  }));
  bot.on('text', async (ctx, next) => {
    const entry = pending.get(ctx.from.id);
    if (!entry || entry.expires <= Date.now()) { pending.delete(ctx.from.id); return next(); }
    return auth(ctx, () => safely(async () => {
      const raw = ctx.message.text.trim();
      const value = entry.route.view === 'search' ? raw : raw.replace(',', '.');
      if (entry.route.view === 'search') {
        if (!value || value.length > 80) return ctx.reply('1–80 belgi kiriting.');
        pending.delete(ctx.from.id);
        return render(ctx, { view: 'list', scope: 'product', mode: entry.route.back.mode, query: value, page: 0, back: entry.route.back });
      }
      const { scope, target, field, back } = entry.route;
      await render(ctx, { view: 'propose', change: { scope, target, field, value }, back });
      pending.delete(ctx.from.id);
    })(ctx));
  });
  return { propose: (ctx, change) => safely(() => render(ctx, { view: 'propose', change, back: PRICE_HOME }))(ctx) };
}
