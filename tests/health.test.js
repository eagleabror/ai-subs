import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

test('/health readiness, no secret data and no purchase endpoint', async (t) => {
  let readiness = { database: false, bot: false };
  const server = createApp({ getReadiness: () => readiness }).listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const state of [{ database: false, bot: false }, { database: true, bot: false }, { database: false, bot: true }, { database: true, bot: true }]) {
    readiness = state;
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, state.database && state.bot ? 200 : 503);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(await res.json()), ['status', 'database', 'bot', 'autoPurchaseEnabled']);
  }
  assert.equal((await fetch(`${base}/purchase`, { method: 'POST' })).status, 404);
});
