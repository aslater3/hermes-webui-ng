import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_BUILD } from '../../server/routes/foundation.js';
import { ConnectionStore } from '../../src/hermes/connection-store.js';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { DiagnosticsRing } from '../../src/hermes/diagnostics.js';

test('browser and BFF reports identify the same current milestone without operator state', t => {
  const gateway = new GatewayClient({ credential: async () => { throw new Error('No admission needed'); } });
  const store = new ConnectionStore(new DashboardClient('http://localhost:8787'), gateway);
  t.after(() => store.dispose());
  assert.deepEqual(store.report().webui, PUBLIC_BUILD);
  assert.equal(PUBLIC_BUILD.phase, 5); assert.equal(PUBLIC_BUILD.milestone, '5');
});

test('settings diagnostics retain method labels, never models, values or command arguments', () => {
  const ring = new DiagnosticsRing();
  for (const method of ['model.options', 'profiles.list', 'config.get', 'config.set']) {
    ring.add({ event: 'rpc.sent', method, params: { model: 'PRIVATE_MODEL', value: 'SECRET_EFFORT' } });
  }
  ring.add({ event: 'rest.request', route: 'access', token: 'PRIVATE_TOKEN' });
  assert.deepEqual(ring.snapshot().slice(0, 4).map(entry => entry.method), ['model.options', 'profiles.list', 'config.get', 'config.set']);
  assert.equal(ring.snapshot().at(-1)?.route, 'access');
  assert.ok(!JSON.stringify(ring.snapshot()).includes('PRIVATE'));
  assert.ok(!JSON.stringify(ring.snapshot()).includes('SECRET'));
});
