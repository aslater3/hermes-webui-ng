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
