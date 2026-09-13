import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardClient, HttpError, boundedJson } from '../../src/hermes/dashboard-client.js';
import { WsAuthClient } from '../../src/hermes/ws-auth.js';
import { DiagnosticsRing } from '../../src/hermes/diagnostics.js';

test('logout never follows redirects and succeeds only after Hermes rejects the old identity', async () => {
  const client = new DashboardClient('https://chat.example', async (input, init) => {
    if (String(input).endsWith('/auth/logout')) {
      assert.equal(init?.redirect, 'manual'); assert.equal(init?.method, 'POST');
      return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example' } });
    }
    return Response.json({ error: 'session_expired' }, { status: 401 });
  });
  await client.logout();
  const stillSignedIn = new DashboardClient('https://chat.example', async (input) =>
    String(input).endsWith('/auth/logout') ? new Response(null, { status: 302 }) :
      Response.json({ user_id: 'same-user', provider: 'basic' }));
  await assert.rejects(stillSignedIn.logout(), /could not be verified/);
});

test('an expired identity has a typed error, while service failures do not claim logout', async () => {
  const client = new DashboardClient('https://chat.example', async () => Response.json({ error: 'session_expired', detail: 'private' }, { status: 401 }));
  await assert.rejects(client.me(), (error: unknown) => error instanceof HttpError && error.expired && error.status === 401 && !error.message.includes('private'));
  const down = new DashboardClient('https://chat.example', async () => new Response(null, { status: 503 }));
  await assert.rejects(down.logout());
});

test('aborted ticket mint cannot admit a stale generation; credentials never enter diagnostics', async () => {
  const abort = new AbortController();
  const source = { origin: 'https://chat.example', ticket: async () => {
    abort.abort(); return { ticket: 'private_ticket_value', ttl_seconds: 30 };
  } };
  await assert.rejects(new WsAuthClient(source).credential(abort.signal), /superseded/);
  const ring = new DiagnosticsRing();
  const client = new DashboardClient('https://chat.example', async () => Response.json({ ticket: 'private_ticket_value', ttl_seconds: 30 }), 1000, ring);
  const value = await new WsAuthClient(client).credential();
  assert.equal(value.url.includes('private'), false);
  assert.equal(JSON.stringify(ring.snapshot()).includes('private'), false);
});

test('bounded JSON rejects oversized/malformed responses and status drops private fields', async () => {
  await assert.rejects(boundedJson(Response.json({ text: 'x'.repeat(256) }), 32));
  await assert.rejects(boundedJson(new Response('private not json')));
  const client = new DashboardClient('https://chat.example', async () => Response.json({ auth_required: true, version: '0.21.2', config_path: '/private', error: 'private' }));
  assert.deepEqual(await client.status(), { auth_required: true, version: '0.21.2' });
});
