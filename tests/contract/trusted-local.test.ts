import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { startFixture } from '../fixtures/dashboard.js';
const TOKEN = 'LOCAL_FIXTURE_SERVER_SIDE_TOKEN';
async function setup(t: TestContext, wrongToken = false) {
  const upstream = await startFixture(0, { sessionToken: TOKEN });
  const config = loadConfig({ HERMES_AUTH_MODE: 'trusted-local', HERMES_DASHBOARD_SESSION_TOKEN: wrongToken ? 'WRONG_LOCAL_FIXTURE_TOKEN' : TOKEN, HERMES_DASHBOARD_URL: upstream.origin, PUBLIC_ORIGIN: 'http://127.0.0.1:1' });
  const logs: unknown[] = [];
  const app = createApp(config, event => logs.push(event));
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`; config.publicOrigin = new URL(origin);
  t.after(async () => { await app.close(); await upstream.close(); });
  return { origin, logs, upstream };
}
test('local wire: server-only token, JSON-only routes and explicitly unauthenticated readiness', async t => {
  const h = await setup(t);
  for (const path of ['/readyz', '/api/webui/access', '/api/webui/capabilities', '/__hermes/api/status', '/__hermes/api/sessions?limit=1']) {
    const response = await fetch(h.origin + path); assert.equal(response.status, 200, path);
    const data = await response.text(); assert.ok(!data.includes(TOKEN));
    if (path === '/readyz') assert.equal(JSON.parse(data).hermes.authenticatedMode, false);
    if (path.endsWith('/access')) assert.deepEqual(JSON.parse(data), { mode: 'trusted-local', authenticated: false, ready: true });
  }
  for (const path of ['/__hermes/', '/__hermes/login', '/__hermes/api/config', '/__hermes/api/status?token=leak'])
    assert.equal((await fetch(h.origin + path)).status, 403);
  assert.equal((await fetch(h.origin + '/__hermes/api/auth/ws-ticket', { method: 'POST', headers: { Origin: h.origin } })).status, 403);
  assert.equal((await fetch(h.origin + '/__hermes/api/status', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.ok(!JSON.stringify(h.logs).includes(TOKEN));
});
test('local wire: a browser-style stable protocol receives gateway.ready without a ticket or cookie', async t => {
  const h = await setup(t);
  const socket = new WebSocket(h.origin.replace('http:', 'ws:') + '/__hermes/api/ws', ['hermes-gateway-v1'], { origin: h.origin });
  t.after(() => socket.terminate());
  const frame = await new Promise<string>((resolve, reject) => { socket.once('message', raw => resolve(raw.toString())); socket.once('error', reject); });
  assert.equal(socket.protocol, 'hermes-gateway-v1'); assert.equal(JSON.parse(frame).params.type, 'gateway.ready');
  assert.equal(h.upstream.metrics.tickets, 0); assert.ok(!JSON.stringify(h.logs).includes(TOKEN));
});
test('local wire: a wrong operator token fails readiness and admission', async t => {
  const h = await setup(t, true);
  assert.equal((await fetch(h.origin + '/api/webui/access')).status, 503);
  assert.equal((await fetch(h.origin + '/readyz')).status, 503);
  assert.equal((await fetch(h.origin + '/__hermes/api/sessions?limit=1')).status, 401);
});

test('local wire: native conversations, reconnect and invalidated access use no fake account', async t => {
  const { DashboardClient } = await import('../../src/hermes/dashboard-client.js');
  const { WsAuthClient } = await import('../../src/hermes/ws-auth.js');
  const { GatewayClient } = await import('../../src/hermes/gateway-client.js');
  const { ConnectionStore } = await import('../../src/hermes/connection-store.js');
  const { NativeSession } = await import('../../src/hermes/native-session.js');
  const h = await setup(t);
  let failed = false;
  const dashboard = new DashboardClient(h.origin, async (input, init) => {
    if (failed && String(input).endsWith('/api/webui/access')) return Response.json({}, { status: 503 });
    return fetch(input, init);
  });
  const gateway = new GatewayClient(new WsAuthClient(dashboard, (signal): Promise<void> => store.verifyAdmission(signal)), {
    heartbeatMs: 0, socketFactory: (url, protocols) => new WebSocket(url, protocols, { origin: h.origin }) as unknown as globalThis.WebSocket,
  });
  const store = new ConnectionStore(dashboard, gateway); const native = new NativeSession(gateway);
  t.after(() => { native.dispose(); store.dispose(); });
  await store.start(); assert.equal(store.state.auth, 'local-access'); assert.equal(store.hasAccess, true); assert.equal(gateway.state.phase, 'ready');
  await native.create(); const key = native.state.storedId; await native.submit('Controlled local prompt');
  for (let i = 0; i < 100 && native.state.phase !== 'idle'; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(native.state.messages.at(-1)?.text, 'SYNTHETIC_RESPONSE');
  store.disconnect(); await store.resume(); assert.equal(gateway.state.phase, 'disconnected');
  await store.start();
  for (let i = 0; i < 100 && native.state.phase !== 'idle'; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(native.state.storedId, key); assert.equal(h.upstream.metrics.submits, 1); assert.equal(h.upstream.metrics.tickets, 0);
  await assert.rejects(store.logout()); assert.equal(store.state.auth, 'local-access');
  const report = JSON.stringify(store.report()); assert.ok(!report.includes(TOKEN)); assert.ok(!report.includes('user_id')); assert.ok(!report.includes('Controlled local prompt'));
  let cleared = false; store.onIdentityBoundary(() => { cleared = true; }); failed = true; await store.resume();
  assert.equal(cleared, true); assert.equal(store.hasAccess, false); assert.equal(gateway.state.phase, 'disconnected');
});
