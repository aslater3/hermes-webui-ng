import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { NativeSession } from '../../src/hermes/native-session.js';
import { startFixture } from '../fixtures/dashboard.js';
import { browserAuth } from '../helpers/browser-auth.js';

async function until(predicate: () => boolean, label: string) {
  for (let i = 0; i < 500; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(`Condition did not become true: ${label}`);
}

test('synthetic wire: reasoning streamed during a socket drop is replayed once, in order, after reconnect', async t => {
  const fixture = await startFixture();
  const config = loadConfig({ HERMES_DASHBOARD_URL: fixture.origin, PUBLIC_ORIGIN: 'http://127.0.0.1:1' });
  const app = createApp(config, () => {});
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`; config.publicOrigin = new URL(origin);
  const auth = browserAuth(origin), dashboard = new DashboardClient(origin, auth.fetcher);
  const gateway = new GatewayClient(dashboard, { socketFactory: auth.socketFactory, heartbeatMs: 0, retryBaseMs: 10 });
  const session = new NativeSession(gateway);
  t.after(async () => { session.dispose(); gateway.close(); await app.close(); await fixture.close(); });

  await dashboard.status(); await dashboard.login('basic', 'fixture', 'fixture-password');
  await gateway.connect(); await session.create();
  const reasoning = () => session.activity.state.timeline.flatMap(entry => entry.kind === 'reasoning' ? [entry.text] : []).join('');

  await session.submit('[replay-test] stream reasoning across a disconnect');
  await until(() => reasoning().includes('Part one.'), 'first part live');
  // Server drops the socket and refuses reconnects briefly: parts streamed meanwhile exist only in Hermes' ring.
  fixture.dropClients(200);
  await until(() => gateway.state.phase !== 'ready', 'disconnect observed');
  await until(() => session.state.phase === 'idle' && reasoning().endsWith('Part five.'), 'turn settled with full reasoning');

  assert.equal(reasoning(), 'Part one. Part two. Part three. Part four. Part five.');
  assert.ok(!session.activity.state.missedLive, 'a complete replay is not reported as a gap');
  assert.ok(session.state.messages.some(message => message.role === 'assistant' && message.text.includes('Replay done.')));
});
