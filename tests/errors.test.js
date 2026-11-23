import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure, logFailure } from '../src/utils/errors.js';

test('startup failures identify nested database causes without exposing secrets', (t) => {
  const logs = [];
  t.mock.method(console, 'error', (line) => logs.push(line));
  const sensitive = 'mongodb+srv://private-user:private-password@private-host/db';
  const error = Object.assign(new Error(sensitive), {
    name: 'MongooseServerSelectionError',
    reason: { servers: new Map([['private-host', { error: { cause: { code: 'ECONNREFUSED', message: sensitive } } }]]) },
  });
  logFailure('database_startup_failed', error);
  assert.deepEqual(logs, ['{"event":"database_startup_failed","code":"CONNECTION_REFUSED"}']);
  assert.doesNotMatch(logs.join(), /private|mongodb/);
});

test('diagnostic codes cover common failures and never echo unknown fields', () => {
  for (const [error, expected] of [
    [{ code: 18 }, 'DATABASE_AUTH_FAILED'],
    [{ code: 13 }, 'DATABASE_PERMISSION_DENIED'],
    [{ code: 'ENOTFOUND' }, 'DNS_LOOKUP_FAILED'],
    [{ code: 'ETIMEDOUT' }, 'CONNECTION_TIMEOUT'],
    [{ message: 'tlsv1 alert internal error at private-host' }, 'TLS_CONNECTION_FAILED'],
    [{ name: 'MongoParseError' }, 'DATABASE_URI_INVALID'],
    [{ name: 'MongooseServerSelectionError' }, 'DATABASE_SERVER_UNREACHABLE'],
    [{ code: 'private-secret', message: 'private-secret' }, 'INTERNAL_ERROR'],
  ]) assert.equal(classifyFailure(error), expected);
  const cycle = {}; cycle.cause = cycle;
  assert.equal(classifyFailure(cycle), 'INTERNAL_ERROR');
});
