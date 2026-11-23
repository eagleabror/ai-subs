import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, loadSupplierConfig } from '../src/config/env.js';
const valid = { TELEGRAM_BOT_TOKEN: '123:test', MONGODB_URI: 'mongodb://localhost/test', LIGHTSTORE_API_KEY: 'mock', LIGHTSTORE_API_BASE_URL: 'https://supplier.invalid/api/v1/', ADMIN_TELEGRAM_ID: '123' };
test('valid config defaults to read-only and normalizes base URL', () => {
  assert.equal(loadConfig(valid).autoPurchaseEnabled, false);
  assert.equal(loadConfig(valid).supplier.baseUrl, 'https://supplier.invalid/api/v1');
  assert.equal(loadSupplierConfig(valid).timeoutMs, 10000);
});
test('each required environment variable is validated without leaking values', () => {
  for (const key of Object.keys(valid)) {
    assert.throws(() => loadConfig({ ...valid, [key]: '' }), (e) => e.message.includes(key) && !e.message.includes('123:test'));
  }
});
test('unsafe flags, URLs, ports, IDs and timeouts are rejected', () => {
  for (const [key, value] of [
    ['AUTO_PURCHASE_ENABLED', 'true'], ['AUTO_PURCHASE_ENABLED', '0'],
    ['LIGHTSTORE_API_BASE_URL', 'http://supplier.invalid'], ['LIGHTSTORE_API_BASE_URL', 'https://user:password@supplier.invalid'],
    ['LIGHTSTORE_API_BASE_URL', 'https://supplier.invalid/?secret=x'],
    ['PORT', '0'], ['PORT', '70000'], ['ADMIN_TELEGRAM_ID', '-123'], ['ADMIN_TELEGRAM_ID', '9007199254740992'],
    ['LIGHTSTORE_TIMEOUT_MS', 'NaN'], ['LIGHTSTORE_TIMEOUT_MS', '0'],
  ]) assert.throws(() => loadConfig({ ...valid, [key]: value }));
});
