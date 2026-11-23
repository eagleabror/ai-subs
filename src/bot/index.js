import { Telegraf } from 'telegraf';
import { userService } from '../services/user.service.js';
import { logFailure } from '../utils/errors.js';
import { adminOnly } from './middleware/admin.js';
import { startCommand } from './commands/start.js';
import { supplierStatusCommand } from './commands/supplier-status.js';
import { registerMenu } from './handlers/menu.js';

export function createBot({ token, adminTelegramId, supplier, users = userService }) {
  const bot = new Telegraf(token);
  bot.use((ctx, next) => {
    if (ctx.chat?.type !== 'private' || !ctx.from || ctx.from.is_bot) return;
    return next();
  });
  bot.start(startCommand(users));
  bot.command('supplier_status', adminOnly(adminTelegramId), supplierStatusCommand(supplier));
  registerMenu(bot, { supplier, users });
  bot.catch(async (error, ctx) => {
    logFailure('bot_update_failed', error);
    try { await ctx.reply('Xatolik yuz berdi. Birozdan keyin qayta urinib ko‘ring.'); }
    catch { logFailure('bot_reply_failed'); }
  });
  return bot;
}
