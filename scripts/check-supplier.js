import { loadSupplierConfig, ConfigurationError } from '../src/config/env.js';
import { LightStoreService } from '../src/services/lightstore.service.js';
import { supplierErrorMessage } from '../src/utils/errors.js';
try {
  const supplier = new LightStoreService(loadSupplierConfig());
  const products = await supplier.getCatalog();
  const offers = await supplier.findGeminiSixMonthOffers();
  console.log(JSON.stringify({ status: 'ok', productCount: products.length, geminiSixMonthOffers: offers }, null, 2));
} catch (error) {
  console.error(error instanceof ConfigurationError ? error.message : supplierErrorMessage(error));
  process.exitCode = 1;
}
