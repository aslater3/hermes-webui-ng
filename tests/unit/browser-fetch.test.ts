import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';

test('native fetch receives the global receiver, not the Dashboard client instance', async () => {
  const fetcher: typeof fetch = async function (this: unknown, _input, _init) {
    assert.equal(this, globalThis, 'Browser fetch rejects an incompatible receiver');
    return Response.json({ auth_required: true });
  };
  const client = new DashboardClient('https://chat.example', fetcher);
  assert.equal((await client.status()).auth_required, true);
});
