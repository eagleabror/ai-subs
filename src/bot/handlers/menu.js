import { MENU, mainKeyboard, backKeyboard } from '../keyboards/main.js';
import { formatMoney } from '../../utils/money.js';
import { supplierErrorMessage } from '../../utils/errors.js';

export function registerMenu(bot, { supplier, users }) {
  bot.hears(MENU.back, (ctx) => ctx.reply('Bosh menyu:', mainKeyboard()));
  bot.hears(MENU.buy, async (ctx) => {
    let offers;
    try { offers = await supplier.findGeminiSixMonthOffers(); }
    catch (error) { return ctx.reply(supplierErrorMessage(error), backKeyboard()); }
    const available = offers.filter((offer) => offer.available && offer.stock > 0);
    const status = available.length ? 'Gemini AI Plus — 6 oylik obuna katalogda mavjud.' : 'Gemini AI Plus — 6 oylik obuna hozircha mavjud emas.';
    return ctx.reply(`${status}\nXarid hali yoqilmagan. Pul yechilmaydi.`, backKeyboard());
  });
  bot.hears(MENU.balance, async (ctx) => {
    const wallet = await users.getWallet(ctx.from.id);
    if (!wallet) return ctx.reply('Avval /start buyrug‘ini yuboring.', mainKeyboard());
    return ctx.reply(`Balansingiz: ${formatMoney(wallet.balanceMinor, wallet.currency)}\nBalansni to‘ldirish va pul yechish hali yoqilmagan.`, backKeyboard());
  });
  bot.hears(MENU.referral, (ctx) => ctx.reply('Referal dasturi keyingi bosqichda ishga tushadi. Hozircha bonus hisoblanmaydi.', backKeyboard()));
  bot.hears(MENU.info, (ctx) => ctx.reply('AI Subs — Telegram orqali raqamli obunalar do‘koni.\nHozir Phase 1 sinov bosqichi. Katalogni ko‘rish mumkin, xarid va to‘lovlar o‘chirilgan.', backKeyboard()));
  bot.on('text', (ctx) => ctx.reply('Quyidagi menyudan bo‘lim tanlang yoki /start buyrug‘ini yuboring.', mainKeyboard()));
}
