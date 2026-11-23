import { CatalogService } from './services/catalog.service.js';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { createBot } from './bot/index.js';
import { ConfigurationError, loadConfig } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { LightStoreService } from './services/lightstore.service.js';
import { logFailure } from './utils/errors.js';

let catalogTimer;
let server;
let bot;
let botReady = false;
let stopping = false;
let startupStage = 'configuration';
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(catalogTimer);
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
  const supplier = new LightStoreService(config.supplier);
  const catalog = new CatalogService(supplier, config.pricing);
  if (config.pricing.errors.length) console.warn(JSON.stringify({ event: 'catalog_pricing_disabled', fields: config.pricing.errors }));
  const syncCatalog = () => catalog.sync().catch(error => logFailure('catalog_sync_failed', error));
  void syncCatalog();
  catalogTimer = setInterval(() => void syncCatalog(), 5 * 60 * 1000);
  catalogTimer.unref();
  startupStage = 'telegram';
  bot = createBot({ token: config.telegramBotToken, adminTelegramId: config.adminTelegramId, supplier, catalog });
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
