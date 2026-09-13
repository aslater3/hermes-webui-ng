import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { NativeSession } from '../../src/hermes/native-session.js';
import { startFixture } from '../fixtures/dashboard.js';
import { browserAuth } from '../helpers/browser-auth.js';

async function harness(t: TestContext) {
  const fixture = await startFixture();
  const config = loadConfig({ HERMES_DASHBOARD_URL: fixture.origin, PUBLIC_ORIGIN: 'http://127.0.0.1:1' });
  config.requestTimeoutMs = 500;
  const logs: unknown[] = [];
  const app = createApp(config, (event) => logs.push(event));
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  config.publicOrigin = new URL(origin);
  const auth = browserAuth(origin);
  const dashboard = new DashboardClient(origin, auth.fetcher);
  const gateway = new GatewayClient(dashboard, {
    socketFactory: auth.socketFactory,
    heartbeatMs: 0,
    retryBaseMs: 10,
  });
  t.after(async () => {
    gateway.close();
    await app.close();
    await fixture.close();
  });
  return { fixture, app, origin, auth, dashboard, gateway, logs, config };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Condition did not become true');
}

test('synthetic wire: proxied login, fresh ticket, Upgrade, native prompt and stateless reconnect', async (t) => {
  const h = await harness(t);
  await h.dashboard.status();
  await assert.rejects(h.dashboard.me());
  await h.dashboard.login('basic', 'fixture', 'fixture-password');
  await h.gateway.connect();
  const session = new NativeSession(h.gateway);
  t.after(() => session.dispose());
  await session.create();
  const key = session.state.storedId;
  await session.submit('wire-test prompt');
  await until(() => session.state.phase === 'idle' && session.state.messages.length === 2);
  assert.equal(session.state.messages.at(-1)?.text, 'SYNTHETIC_RESPONSE');
  h.fixture.disconnect();
  await until(() => h.fixture.metrics.upgrades === 2 && session.state.phase === 'idle');
  assert.equal(session.state.storedId, key);
  assert.deepEqual(h.fixture.metrics, { creates: 1, submits: 1, tickets: 2, upgrades: 2 });
  const log = JSON.stringify(h.logs);
  for (const secret of [h.fixture.cookie, 'wire-test prompt', 'fixture-password', 'hermes-gateway-ticket.'])
    assert.equal(log.includes(secret), false);
});

test('synthetic wire: a consumed WebSocket ticket cannot be reused', async (t) => {
  const h = await harness(t);
  await h.dashboard.login('basic', 'fixture', 'fixture-password');
  const credential = await h.dashboard.credential();
  const first = new WebSocket(credential.url, credential.protocols, { origin: h.origin });
  first.on('error', () => {});
  t.after(() => first.terminate());
  await new Promise<void>((resolve) => first.once('open', resolve));
  const second = new WebSocket(credential.url, credential.protocols, { origin: h.origin });
  second.on('error', () => {});
  t.after(() => second.terminate());
  const status = await new Promise<number>((resolve) =>
    second.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode!);
      res.resume();
      second.terminate();
    }),
  );
  assert.equal(status, 401);
});

test('synthetic wire: cross-origin requests are rejected and forged forwarding values replaced', async (t) => {
  const h = await harness(t);
  const bad = await fetch(`${h.origin}/__hermes/auth/password-login`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(bad.status, 403);
  await h.dashboard.login('basic', 'fixture', 'fixture-password');
  const response = await h.auth.fetcher(`${h.origin}/__hermes/echo-headers`, {
    headers: { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'ftp', Forwarded: 'for=evil' },
  });
  const headers = await response.json();
  assert.equal(headers.host, new URL(h.origin).host);
  assert.equal(headers['x-forwarded-host'], new URL(h.origin).host);
  assert.equal(headers['x-forwarded-proto'], 'http');
  assert.equal(headers['x-forwarded-prefix'], '/__hermes');
  assert.equal(headers.forwarded, undefined);
});

test('synthetic wire: scoped cookies, internal redirects, deadline and health semantics', async (t) => {
  const h = await harness(t);
  const login = await h.auth.fetcher(`${h.origin}/__hermes/auth/password-login`, {
    method: 'POST',
    body: JSON.stringify({ username: 'fixture', password: 'fixture-password' }),
  });
  assert.match(login.headers.getSetCookie()[0]!, /Path=\/__hermes\/; HttpOnly; SameSite=Lax/);
  const redirect = await h.auth.fetcher(`${h.origin}/__hermes/redirect`, { redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), `${h.origin}/__hermes/login`);
  assert.equal((await h.auth.fetcher(`${h.origin}/__hermes/slow`)).status, 504);
  assert.equal((await fetch(`${h.origin}/healthz`)).status, 200);
  assert.equal((await fetch(`${h.origin}/readyz`)).status, 200);
  assert.equal((await fetch(`${h.origin}/api/workspace`)).status, 404);
});

test('synthetic wire: declared and chunked oversized request bodies are rejected', async (t) => {
  const h = await harness(t);
  h.config.maxBodyBytes = 32;
  const send = (headers: Record<string, string>, chunks: string[]) =>
    new Promise<number>((resolve, reject) => {
      const req = request(
        `${h.origin}/__hermes/consume`,
        { method: 'POST', headers: { Origin: h.origin, Cookie: h.fixture.cookie, ...headers } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on('error', reject);
      chunks.forEach((chunk) => req.write(chunk));
      req.end();
    });
  assert.equal(await send({ 'Content-Length': '64' }, ['a'.repeat(64)]), 413);
  assert.equal(await send({ 'Transfer-Encoding': 'chunked' }, ['a'.repeat(24), 'b'.repeat(24)]), 413);
});

test('synthetic REST: paginated sessions and older history remain upstream-owned', async (t) => {
  const h = await harness(t); h.fixture.seed(25, 110);
  await h.dashboard.login('basic', 'fixture', 'fixture-password');
  const first = await h.dashboard.sessions(), second = await h.dashboard.sessions({offset:20});
  assert.equal(first.rows.length, 20); assert.equal(second.rows.length, 5); assert.equal(first.total, 25);
  assert.equal(first.rows[0]?.id, 'seed-24'); assert.equal(first.rows[0]?.profile, 'default');
  const latest = await h.dashboard.sessionMessages({id:'seed-24',profile:'default'});
  const older = await h.dashboard.sessionMessages({id:'seed-24',profile:'default'}, 100);
  assert.equal(latest.messages[0]?.text, 'Seed 24 entry 10'); assert.equal(older.messages.length, 10);
  assert.equal(older.messages[0]?.text, 'Seed 24 entry 0');
  assert.equal((await h.dashboard.searchSessions('Seed 24'))[0]?.id, 'seed-24');
  await assert.rejects(h.dashboard.sessionMessages({id:'seed-24',profile:'wrong'}));
  assert.equal(h.fixture.metrics.creates, 0); assert.equal(h.fixture.metrics.submits, 0);
});

test('synthetic native: interrupt cancels a running turn and a second turn completes', async (t) => {
  const h = await harness(t); await h.dashboard.login('basic', 'fixture', 'fixture-password'); await h.gateway.connect();
  const session = new NativeSession(h.gateway); t.after(() => session.dispose()); await session.create();
  await session.submit('[slow-test] interrupt this');
  assert.equal(session.state.phase, 'running'); await Promise.all([session.interrupt(), session.interrupt()]);
  await until(() => session.state.phase === 'idle');
  assert.equal(session.state.messages.filter((message) => message.role === 'assistant').length, 0);
  await session.submit('second turn'); await until(() => session.state.phase === 'idle');
  const history = await h.dashboard.sessionMessages({id:session.state.storedId!,profile:session.state.profile});
  assert.equal(history.messages.filter((message) => message.role === 'assistant').length, 1);
  assert.equal(h.fixture.metrics.submits, 2); assert.equal(h.fixture.metrics.creates, 1);
});
