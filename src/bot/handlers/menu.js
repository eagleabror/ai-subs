import { MENU, mainKeyboard, backKeyboard } from '../keyboards/main.js';
import { formatMoney } from '../../utils/money.js';

export function registerMenu(bot, { users }) {
  bot.hears(MENU.back, (ctx) => ctx.reply('Bosh menyu:', mainKeyboard()));
  bot.hears(MENU.balance, async (ctx) => {
    const wallet = await users.getWallet(ctx.from.id);
    if (!wallet) return ctx.reply('Avval /start buyrug‘ini yuboring.', mainKeyboard());
    return ctx.reply(`Balansingiz: ${formatMoney(wallet.balanceMinor, wallet.currency)}\nBalansni to‘ldirish va pul yechish hali yoqilmagan.`, backKeyboard());
  });
  bot.hears(MENU.referral, (ctx) => ctx.reply('Referal dasturi keyingi bosqichda ishga tushadi. Hozircha bonus hisoblanmaydi.', backKeyboard()));
  bot.hears(MENU.info, (ctx) => ctx.reply('AI Subs — Telegram orqali raqamli mahsulotlar do‘koni.\nKatalog, narxlar va sinov buyurtmalarini ko‘rish mumkin. Haqiqiy xarid va to‘lovlar o‘chirilgan.', backKeyboard()));
  bot.on('text', (ctx) => ctx.reply('Quyidagi menyudan bo‘lim tanlang yoki /start buyrug‘ini yuboring.', mainKeyboard()));
}
