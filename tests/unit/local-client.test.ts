import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { ClientError } from '../../src/hermes/protocol.js';
import { WsAuthClient } from '../../src/hermes/ws-auth.js';

test('ungated upstream cannot opt the client into local mode without explicit BFF approval', async () => {
  const client = new DashboardClient('http://localhost:8788', async input => Response.json(String(input).endsWith('/api/status') ? { auth_required: false } : { mode: 'dashboard', authenticated: false, ready: false }));
  await assert.rejects(client.status(), error => error instanceof ClientError && error.kind === 'protocol');
  assert.equal(client.admissionMode, 'dashboard');
});
test('local client has no synthetic identity, provider or ticket and no browser credential in admission', async () => {
  const paths: string[] = [];
  const client = new DashboardClient('http://localhost:8788', async (input, init) => {
    paths.push(new URL(String(input)).pathname);
    if (String(input).endsWith('/api/status')) return Response.json({ auth_required: false });
    assert.equal(init?.credentials, 'omit');
    assert.equal(String(input), 'http://localhost:8788/api/webui/access');
    return Response.json({ mode: 'trusted-local', authenticated: false, ready: true });
  });
  await client.status(); assert.equal(client.admissionMode, 'trusted-local');
  assert.deepEqual(await client.providers(), []);
  await assert.rejects(client.me()); await assert.rejects(client.login('local', '', '')); await assert.rejects(client.ticket()); await assert.rejects(client.logout());
  const auth = new WsAuthClient(client);
  for (let i = 0; i < 2; i++) assert.deepEqual(await auth.credential(), { url: 'ws://localhost:8788/__hermes/api/ws', protocols: ['hermes-gateway-v1'] });
  assert.equal(paths.filter(path => path === '/api/webui/access').length, 3);
  assert.ok(!paths.some(path => path.includes('/auth/')));
});
test('malformed authentication status and unconfirmed local access fail closed', async () => {
  for (const flag of [undefined, 'false', 0, null]) {
    const client = new DashboardClient('http://localhost', async () => Response.json({ auth_required: flag }));
    await assert.rejects(client.status());
  }
  const client = new DashboardClient('http://localhost', async input => Response.json(String(input).endsWith('/api/status') ? { auth_required: false } : { mode: 'trusted-local', authenticated: false, ready: false }));
  await assert.rejects(client.status()); assert.equal(client.admissionMode, 'dashboard');
});
test('cancelled local verification cannot return a usable admission', async () => {
  const abort = new AbortController();
  const source = { origin: 'http://localhost', admissionMode: 'trusted-local' as const,
    verifyLocalAccess: async () => { abort.abort(); }, ticket: async () => { throw new Error('Must not mint'); } };
  await assert.rejects(new WsAuthClient(source).credential(abort.signal), error => error instanceof ClientError && error.kind === 'disconnected');
});
