import { registerAdminPricing } from './handlers/admin-pricing.js';
import { registerCheckout } from './handlers/checkout.js';
import { registerWallet } from './handlers/wallet.js';
import { registerSupplierOrders } from './handlers/supplier-orders.js';
import { MENU } from './keyboards/main.js';
import { CatalogService } from '../services/catalog.service.js';
import { registerCatalog } from './handlers/catalog.js';
import { registerCatalogAdmin } from './commands/catalog-admin.js';
import { Telegraf } from 'telegraf';
import { userService } from '../services/user.service.js';
import { logFailure } from '../utils/errors.js';
import { adminOnly } from './middleware/admin.js';
import { startCommand } from './commands/start.js';
import { supplierStatusCommand } from './commands/supplier-status.js';
import { registerMenu } from './handlers/menu.js';

export function createBot({ token, adminTelegramId, supplier, catalog = new CatalogService(supplier), users = userService, adminPricing, checkout, wallets, payments, supplierOrders, delivery }) {
  const bot = new Telegraf(token);
  let supplierPanel;
  bot.use((ctx, next) => {
    if (ctx.chat?.type !== 'private' || !ctx.from || ctx.from.is_bot) return;
    const text = ctx.message?.text;
    if (ctx.callbackQuery || text?.startsWith('/') || Object.values(MENU).includes(text)) supplierPanel?.reset(ctx.from.id);
    return next();
  });
  const walletPanel = wallets && payments ? registerWallet(bot, { wallets, payments, checkout, users, adminIds: adminTelegramId }) : null;
  // The admin panel uses a deferred proxy because its input middleware must precede supplier inputs.
  const supplierProxy = supplierOrders && delivery ? { adminButtons: ctx => supplierPanel.adminButtons(ctx) } : null;
  const pricingPanel = adminPricing ? registerAdminPricing(bot, adminPricing, adminTelegramId, walletPanel, supplierProxy) : null;
  supplierPanel = supplierOrders && delivery ? registerSupplierOrders(bot, supplierOrders, delivery) : null;
  const checkoutPanel = checkout ? registerCheckout(bot, checkout) : null;
  registerCatalog(bot, catalog, checkoutPanel, supplierPanel);
  bot.start(startCommand(users));
  bot.command('supplier_status', adminOnly(adminTelegramId), supplierStatusCommand(supplier));
  registerCatalogAdmin(bot, catalog, adminTelegramId, pricingPanel);
  registerMenu(bot, { users });
  bot.catch(async (error, ctx) => {
    logFailure('bot_update_failed', error);
    try { await ctx.reply('Xatolik yuz berdi. Birozdan keyin qayta urinib ko‘ring.'); }
    catch { logFailure('bot_reply_failed'); }
  });
  return bot;
}
