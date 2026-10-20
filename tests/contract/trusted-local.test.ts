import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { startFixture } from '../fixtures/dashboard.js';
const TOKEN = 'LOCAL_FIXTURE_SERVER_SIDE_TOKEN';
async function setup(t: TestContext, wrongToken = false, uninitializedSessionStore = false) {
  const upstream = await startFixture(0, { sessionToken: TOKEN, uninitializedSessionStore });
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

test('local wire: a fresh Hermes with no session store yet is ready and admitted', async t => {
  const h = await setup(t, false, true);
  assert.equal((await fetch(h.origin + '/readyz')).status, 200);
  assert.deepEqual(await (await fetch(h.origin + '/api/webui/access')).json(), { mode: 'trusted-local', authenticated: false, ready: true });
  assert.equal((await fetch(h.origin + '/__hermes/api/sessions?limit=1')).status, 503);
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

test('local wire: skill reads are allowed only as exact GET routes; writes and hub/cron routes stay 403', async t => {
  const h = await setup(t);
  const { DashboardClient } = await import('../../src/hermes/dashboard-client.js');
  const dashboard = new DashboardClient(h.origin);
  await dashboard.status();
  const rows = await dashboard.skills('default');
  assert.deepEqual(rows.map(row => row.name), ['arxiv', 'axolotl', 'local-notes']);
  const doc = await dashboard.skillContent('arxiv', 'default');
  assert.equal(doc.name, 'arxiv'); assert.match(doc.content, /# arxiv/);
  assert.ok(!JSON.stringify({ rows, doc }).includes('/srv/hermes'));
  assert.deepEqual((await dashboard.skills('work')).map(row => row.name), ['arxiv']);
  assert.deepEqual(await dashboard.skills('empty-profile'), []);
  for (const [method, path] of [
    ['POST', '/__hermes/api/skills'], ['PUT', '/__hermes/api/skills/content'], ['PUT', '/__hermes/api/skills/toggle'],
    ['POST', '/__hermes/api/skills/hub/install'], ['GET', '/__hermes/api/skills/hub/search?q=x'], ['GET', '/__hermes/api/skills/content/extra'],
    ['GET', '/__hermes/api/skills?token=leak'], ['POST', '/__hermes/api/cron/jobs'],
  ] as const) assert.equal((await fetch(h.origin + path, { method, headers: { Origin: h.origin } })).status, 403, `${method} ${path}`);
  assert.ok(!JSON.stringify(h.logs).includes(TOKEN));
});

test('local wire: memory and cron reads are proxied and redacted; actions, memory writes, provider config and fire stay 403', async t => {
  const h = await setup(t);
  const { DashboardClient } = await import('../../src/hermes/dashboard-client.js');
  const dashboard = new DashboardClient(h.origin);
  await dashboard.status();
  const memory = await dashboard.memory('default');
  assert.equal(memory.active, 'honcho'); assert.equal(memory.providers.length, 2);
  const jobs = await dashboard.cronJobs('default');
  assert.deepEqual(jobs.map(job => job.name), ['morning-digest', 'backup-check', 'weekly-report']);
  assert.equal(jobs[2]!.state, 'paused');
  const failing = await dashboard.cronJob('0f1e2d3c4b5a', 'default');
  assert.equal(failing.lastError, 'Delivery failed: api_key=[redacted]');
  const runs = await dashboard.cronRuns('0f1e2d3c4b5a', 'default', 5);
  assert.equal(runs[0]!.title, 'FAILED · Delivery failed');
  const rendered = JSON.stringify({ memory, jobs, failing, runs });
  for (const secret of ['FIXTURE_PROVIDER_SECRET_VALUE', 'HONCHO_API_KEY', 'FIXTURE_URL_PASSWORD', 'Summarise overnight mail', '/srv/hermes', 'FIXTURE_JOB_KEY_VALUE', 'FIXTURE_BEARER_VALUE'])
    assert.equal(rendered.includes(secret), false, secret);
  // The client offers no action in local mode, so no write request leaves the browser.
  await assert.rejects(dashboard.cronAction('pause', 'a1b2c3d4e5f6', 'default'), /Dashboard/);
  for (const [method, path] of [
    ['POST', '/__hermes/api/cron/jobs/a1b2c3d4e5f6/pause?profile=default'], ['POST', '/__hermes/api/cron/jobs/a1b2c3d4e5f6/resume?profile=default'],
    ['POST', '/__hermes/api/cron/jobs/a1b2c3d4e5f6/trigger?profile=default'], ['DELETE', '/__hermes/api/cron/jobs/a1b2c3d4e5f6?profile=default'],
    ['POST', '/__hermes/api/cron/fire'], ['GET', '/__hermes/api/cron/blueprints'], ['POST', '/__hermes/api/memory/reset?profile=default'],
    ['GET', '/__hermes/api/memory/providers/honcho/config?profile=default'], ['PUT', '/__hermes/api/memory/providers/honcho/config'],
  ] as const) assert.equal((await fetch(h.origin + path, { method, headers: { Origin: h.origin } })).status, 403, `${method} ${path}`);
  assert.equal(h.upstream.metrics.cronActions, 0);
  assert.ok(!JSON.stringify(h.logs).includes(TOKEN));
});

test('local wire: MCP list, health and system stats are proxied and projected; MCP writes, probes, auth, catalog and secret routes stay 403', async t => {
  const h = await setup(t);
  const { DashboardClient } = await import('../../src/hermes/dashboard-client.js');
  const dashboard = new DashboardClient(h.origin);
  await dashboard.status();
  const servers = await dashboard.mcpServers('default');
  assert.deepEqual(servers.map(server => server.name), ['github', 'filesystem', 'oauth-calendar']);
  assert.equal(servers[0]!.toolCount, 2);
  const status = await dashboard.hermesStatus('default');
  const health = await dashboard.hermesHealth();
  const stats = await dashboard.systemStats();
  assert.equal(status.version, '0.13.2'); assert.equal(health.ok, true); assert.equal(stats.os, 'Linux');
  const rendered = JSON.stringify({ servers, status, health, stats });
  for (const secret of ['FIXTURE_MCP_URL_PASSWORD', 'FIXTURE_MCP_QUERY_TOKEN', 'FIXTURE_MCP_HEADER_SECRET', 'FIXTURE_MCP_ENV_SECRET',
    'FIXTURE_MCP_ARG_SECRET', 'FIXTURE_MCP_OAUTH_TOKEN', '/home/fixture/private', '/srv/hermes', 'fixture-host.internal', 'FIXTURE_INSTALL_ID', '48211', '9119', 'deadbeefcafe'])
    assert.equal(rendered.includes(secret), false, secret);
  for (const [method, path] of [
    ['POST', '/__hermes/api/mcp/servers'], ['PUT', '/__hermes/api/mcp/servers'], ['DELETE', '/__hermes/api/mcp/servers/github'],
    ['PUT', '/__hermes/api/mcp/servers/github/enabled'], ['POST', '/__hermes/api/mcp/servers/github/test?profile=default'],
    ['POST', '/__hermes/api/mcp/servers/github/auth'], ['GET', '/__hermes/api/mcp/oauth/flows/abc'], ['GET', '/__hermes/api/mcp/catalog'],
    ['POST', '/__hermes/api/mcp/catalog/install'], ['GET', '/__hermes/api/mcp/servers?token=leak'], ['GET', '/__hermes/api/mcp/servers/github'],
    ['POST', '/__hermes/api/gateway/start'], ['POST', '/__hermes/api/gateway/stop'], ['POST', '/__hermes/api/ops/dump'],
    ['GET', '/__hermes/api/config/raw'], ['GET', '/__hermes/api/credentials/pool'], ['POST', '/__hermes/api/webhooks'],
    ['POST', '/__hermes/api/health/retirement'], ['GET', '/__hermes/api/health/idle'], ['POST', '/__hermes/api/system/stats'],
  ] as const) assert.equal((await fetch(h.origin + path, { method, headers: { Origin: h.origin } })).status, 403, `${method} ${path}`);
  assert.ok(!JSON.stringify(h.logs).includes(TOKEN));
});
