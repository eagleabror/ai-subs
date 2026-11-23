import { loadSupplierConfig, ConfigurationError } from '../src/config/env.js';
import { LightStoreService } from '../src/services/lightstore.service.js';
import { supplierErrorMessage } from '../src/utils/errors.js';
try {
  const supplier = new LightStoreService(loadSupplierConfig());
  let failed = false;
  for (const [source, read] of [['catalog', () => supplier.getCatalogSnapshot()], ['games', () => supplier.getGamesCatalog()]]) {
    try {
      const snapshot = await read();
      console.log(JSON.stringify({ source, status: 'ok',
        categories: snapshot.categories.map(c => ({ supplierId: c.supplierCategoryId, title: c.title, kind: c.kind })),
        productCount: snapshot.products.length, variantCount: snapshot.variants.length,
        variantsComplete: source === 'catalog', unsupportedTypes: snapshot.unsupportedTypes || [],
      }, null, 2));
    } catch (error) { failed = true; console.error(`${source}: ${supplierErrorMessage(error)}`); }
  }
  if (failed) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof ConfigurationError ? error.message : supplierErrorMessage(error));
  process.exitCode = 1;
}
