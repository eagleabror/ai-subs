import { adminOnly } from '../middleware/admin.js';
const brief = value => String(value).slice(0, 250);
export function registerCatalogAdmin(bot, catalog, adminId) {
  const restricted = (name, handler) => bot.command(name, adminOnly(adminId), handler);
  restricted('catalog_sync', async ctx => {
    await ctx.reply('To‘liq katalog sinxronlanishi boshlandi. Katta katalog bir necha daqiqa olishi mumkin. Holat: /catalog_status');
    // Do not block Telegraf's next polling batch while a large catalog is loading.
    void catalog.syncAll().then(result => ctx.reply(`${result.sources.map(r => `${r.scope}: ${r.ok ? 'yangilandi' : r.error}`).join('\n')}\nGames tafsilotlari: ${result.loaded}; xatolar: ${result.errors}`)).catch(() => ctx.reply('Sinxronlashni yakunlash yoki xabar yuborishda xato. /catalog_status bilan tekshiring.').catch(() => {}));
  });
  const counts = s => `Kategoriyalar: ${s.categories}\nMahsulotlar: ${s.products}\nVariantlar: ${s.variants}\nTafsiloti yuklangan games mahsulotlari: ${s.detailsLoaded}\nTafsilot xatolari: ${s.detailErrors}\nTo‘liq sync: ${s.fullSyncRunning ? 'davom etmoqda' : 'ishlamayapti'}\nGames variantlari to‘liq sync yoki mahsulot ochilganda yuklanadi.`;
  restricted('products_count', async ctx => ctx.reply(counts(await catalog.status())));
  restricted('catalog_status', async ctx => {
    const s = await catalog.status();
    const states = s.states.map(v => `${v._id}: ${v.lastSuccess?.toISOString() || 'hali sinxronlanmagan'}; xato: ${v.errorCode || 'yo‘q'}; tafsilot xatosi: ${v.detailErrorCode || 'yo‘q'}${v.unsupportedTypes?.length ? `; noma’lum bo‘limlar: ${v.unsupportedTypes.map(brief).join(', ').slice(0, 400)}` : ''}`);
    return ctx.reply(`${counts(s)}\n${states.join('\n')}`);
  });
  restricted('pricing_settings', async ctx => {
    const s = await catalog.pricingSettings();
    return ctx.reply(`RUB → UZS kursi: ${s.rate || 'sozlanmagan'}\nStandart ustama: ${s.markup}%\nYaxlitlash: ${s.rounding} UZS\nEnv mahsulot ustamalari: ${Object.keys(s.overrides).length}\nSozlama xatolari: ${s.errors.join(', ') || 'yo‘q'}\n/set_markup <foiz> [mahsulot kaliti]\n/hide_product <mahsulot kaliti>\n/enable_product <mahsulot kaliti>\nKalitni /product_settings <mahsulot nomi> bilan toping.`);
  });
  restricted('set_markup', async ctx => {
    const [, value, key, extra] = ctx.message.text.trim().split(/\s+/);
    if (!value || extra || !await catalog.setMarkup(value, key)) return ctx.reply('Format: /set_markup <0–1000 foiz> [mahsulot kaliti]. Mahsulot mavjud bo‘lishi kerak.');
    return ctx.reply('Ustama saqlandi. Narxlar ko‘rishda qayta hisoblanadi.');
  });
  for (const [command, enabled] of [['hide_product', false], ['enable_product', true]]) restricted(command, async ctx => {
    const [, key, extra] = ctx.message.text.trim().split(/\s+/);
    if (!key || extra || !await catalog.setProductEnabled(key, enabled)) return ctx.reply(`Format: /${command} <mahsulot kaliti>. Mahsulot topilmadi.`);
    return ctx.reply(enabled ? 'Mahsulot yoqildi.' : 'Mahsulot yashirildi.');
  });
  restricted('product_settings', async ctx => {
    const query = ctx.message.text.split(/\s+/).slice(1).join(' ');
    if (!query || query.length > 80) return ctx.reply('Format: /product_settings <mahsulot nomi yoki kaliti> (80 belgigacha)');
    const products = await catalog.adminProducts(query);
    return ctx.reply(products.length ? products.map(p => `${brief(p.title)}\nKalit: ${brief(p.key)}\nHolat: ${p.hidden || !p.enabled ? 'yashirilgan' : 'yoqilgan'}; ustama: ${p.markupOverride ?? 'standart'}; tafsilot xatosi: ${p.detailErrorCode || 'yo‘q'}`).join('\n\n') : 'Mahsulot topilmadi.');
  });
}
