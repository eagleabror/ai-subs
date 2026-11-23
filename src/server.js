import { ExchangeRateService } from './services/exchange-rate.service.js';
import { PricingService } from './services/pricing/pricing.service.js';
import { AdminPricingService } from './services/pricing/admin-pricing.service.js';
import { CheckoutService } from './services/checkout.service.js';
import { SandboxWalletService } from './services/sandbox-wallet.service.js';
import { PaymentService } from './services/payment.service.js';
import { SupplierOrderService } from './services/supplier-order.service.js';
import { DeliveryService } from './services/delivery.service.js';
import { FulfillmentCipher } from './services/supplier/crypto.js';
import { SupplierLimiter } from './services/supplier/limiter.js';
import { CatalogService } from './services/catalog.service.js';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { createBot } from './bot/index.js';
import { ConfigurationError, loadConfig } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { LightStoreService } from './services/lightstore.service.js';
import { logFailure } from './utils/errors.js';

let catalogTimer;
let sandboxTimer;
let supplierTimer;
let exchangeRates;
let server;
let bot;
let botReady = false;
let stopping = false;
let startupStage = 'configuration';
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(catalogTimer);
  clearInterval(sandboxTimer);
  clearInterval(supplierTimer);
  exchangeRates?.stop();
  botReady = false;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  try {
    try { bot?.stop('shutdown'); } catch { /* Bot may still be starting. */ }
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  } finally { process.exit(code); }
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

try {
  const config = loadConfig();
  startupStage = 'http';
  const app = createApp({ getReadiness: () => ({ database: mongoose.connection.readyState === 1, bot: botReady && !stopping }) });
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(config.port, '0.0.0.0', () => resolve(listener));
    listener.once('error', reject);
  });
  console.info(JSON.stringify({ event: 'http_listening', port: config.port }));
  startupStage = 'database';
  await connectDatabase(config.mongodbUri);
  const limiter = new SupplierLimiter(config.supplier.apiKey); await limiter.init();
  const supplier = new LightStoreService(config.supplier, { limiter });
  exchangeRates = new ExchangeRateService(config.fx);
  await exchangeRates.init();
  const pricing = new PricingService(config.pricing, exchangeRates);
  await pricing.init();
  exchangeRates.start();
  const adminPricing = new AdminPricingService(pricing, config.adminTelegramId);
  const wallets = new SandboxWalletService(), payments = new PaymentService(wallets, config.adminTelegramId);
  await payments.init();
  const checkout = new CheckoutService(pricing, supplier, { wallets });
  const cipher = new FulfillmentCipher(config.fulfillmentEncryptionKey), delivery = new DeliveryService(cipher);
  const supplierOrders = new SupplierOrderService({ supplier, pricing, wallets, checkout, cipher, adminIds: config.adminTelegramId });
  await supplierOrders.init();
  let maintaining = false;
  const maintainSandbox = async () => {
    if (maintaining || stopping) return;
    maintaining = true;
    try { await payments.expirePending(); await checkout.releaseExpired(); }
    catch (error) { logFailure('sandbox_maintenance_failed', error); }
    finally { maintaining = false; }
  };
  void maintainSandbox();
  sandboxTimer = setInterval(() => void maintainSandbox(), 60000);
  sandboxTimer.unref();
  const catalog = new CatalogService(supplier, config.pricing, pricing);
  if (config.fx.errors.length) console.warn(JSON.stringify({ event: 'fx_config_invalid', fields: config.fx.errors }));
  if (config.pricing.errors.filter(e => e !== 'RUB_TO_UZS_RATE').length) console.warn(JSON.stringify({ event: 'catalog_pricing_disabled', fields: config.pricing.errors }));
  const syncCatalog = () => catalog.sync().catch(error => logFailure('catalog_sync_failed', error));
  void syncCatalog();
  catalogTimer = setInterval(() => void syncCatalog(), 5 * 60 * 1000);
  catalogTimer.unref();
  startupStage = 'telegram';
  bot = createBot({ token: config.telegramBotToken, adminTelegramId: config.adminTelegramId, supplier, catalog, adminPricing, checkout, wallets, payments, supplierOrders, delivery });
  let supplierWorking = false;
  const maintainSupplier = async () => {
    if (supplierWorking || stopping || !cipher.ready) return;
    supplierWorking = true;
    try { await supplierOrders.tick(); await delivery.tick((owner, text, options) => bot.telegram.sendMessage(owner, text, options)); }
    catch (error) { logFailure('supplier_maintenance_failed', error); }
    finally { supplierWorking = false; }
  };
  void maintainSupplier();
  supplierTimer = setInterval(() => void maintainSupplier(), 10000); supplierTimer.unref();
  // Callback means getMe succeeded, not that every future poll will succeed.
  // launch() remains pending during polling; never await it before serving health.
  void bot.launch({ allowedUpdates: ['message', 'callback_query'] }, () => {
    botReady = true;
    console.info(JSON.stringify({ event: 'telegram_initialized' }));
  }).catch((error) => {
    logFailure('bot_polling_failed', error);
    void shutdown(1);
  });
} catch (error) {
  if (error instanceof ConfigurationError) console.error(error.message);
  else logFailure(`${startupStage}_startup_failed`, error);
  await shutdown(1);
}
