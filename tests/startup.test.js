import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('missing configuration exits before listening or contacting external services', () => {
  const result = spawnSync(process.execPath, ['src/server.js'], { env: {}, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  for (const key of ['TELEGRAM_BOT_TOKEN', 'MONGODB_URI', 'LIGHTSTORE_API_KEY', 'ADMIN_TELEGRAM_ID']) assert.match(result.stderr, new RegExp(key));
});

test('purchase-enabled startup is refused without exposing credentials', () => {
  const result = spawnSync(process.execPath, ['src/server.js'], {
    env: { TELEGRAM_BOT_TOKEN: '123:secret-test', MONGODB_URI: 'mongodb://secret:password@localhost/test', LIGHTSTORE_API_KEY: 'secret-key', LIGHTSTORE_API_BASE_URL: 'https://supplier.invalid', ADMIN_TELEGRAM_ID: '42', AUTO_PURCHASE_ENABLED: 'true' },
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AUTO_PURCHASE_ENABLED/);
  assert.doesNotMatch(result.stderr, /secret|password/);
});
