import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientError, parseFrames } from '../../src/hermes/protocol.js';
import { DashboardClient, WS_PROTOCOL } from '../../src/hermes/dashboard-client.js';

test('parses newline-separated JSON-RPC replies and forward-compatible events', () => {
  const frames = parseFrames(
    '{"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{"heartbeat":true}}}\n{"jsonrpc":"2.0","id":"1","result":{"session_id":"runtime"}}',
  );
  assert.equal(frames.length, 2);
  assert.equal(frames[0]?.kind, 'event');
  assert.equal(frames[1]?.kind, 'reply');
  assert.equal(
    parseFrames('{"jsonrpc":"2.0","method":"event","params":{"type":"future.feature","payload":42}}').length,
    1,
  );
});

test('malformed frames fail without including content or upstream error messages', () => {
  for (const raw of [
    'private-secret',
    '{}',
    '[]',
    '{"jsonrpc":"2.0","id":1}',
    '{"jsonrpc":"2.0","id":1,"result":null,"error":{}}',
  ]) {
    assert.throws(
      () => parseFrames(raw),
      (err: unknown) =>
        err instanceof ClientError && err.kind === 'protocol' && !err.message.includes('private-secret'),
    );
  }
  assert.deepEqual(parseFrames('{"jsonrpc":"2.0","id":1,"error":{"code":4001,"message":"private-secret"}}'), [
    { kind: 'reply', id: 1, error: { code: 4001 } },
  ]);
});

test('each admission mints a fresh one-use ticket; no credential is placed in the URL', async () => {
  let count = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), 'https://chat.example/__hermes/api/auth/ws-ticket');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'include');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    return Response.json({ ticket: `public_test_ticket_${++count}`, ttl_seconds: 30 });
  };
  const client = new DashboardClient('https://chat.example', fetcher);
  const first = await client.credential();
  const second = await client.credential();
  assert.equal(first.url, 'wss://chat.example/__hermes/api/ws');
  assert.equal(first.protocols[0], WS_PROTOCOL);
  assert.notEqual(first.protocols[1], second.protocols[1]);
  assert.equal(count, 2);
});

test('password login uses the official endpoint then verifies cookie identity', async () => {
  const paths: string[] = [];
  const client = new DashboardClient('http://localhost:8787', async (input, init) => {
    paths.push(new URL(String(input)).pathname);
    if (paths.length === 1) {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        provider: 'basic',
        username: 'fixture',
        password: 'test-only',
      });
      return Response.json({ ok: true, next: 'https://untrusted.example' });
    }
    return Response.json({ user_id: 'fixture', provider: 'basic' });
  });
  assert.deepEqual(await client.login('basic', 'fixture', 'test-only'), {
    user_id: 'fixture',
    provider: 'basic',
  });
  assert.deepEqual(paths, ['/__hermes/auth/password-login', '/__hermes/api/auth/me']);
});

test('auth rejection is terminal, responses stay redacted and ungated mode fails closed', async () => {
  for (const status of [401, 403]) {
    const client = new DashboardClient(
      'https://chat.example',
      async () => new Response('private-cookie', { status }),
    );
    await assert.rejects(
      client.credential(),
      (err: unknown) =>
        err instanceof ClientError && !err.retryable && !err.message.includes('private-cookie'),
    );
  }
  const client = new DashboardClient('https://chat.example', async () =>
    Response.json({ auth_required: false }),
  );
  await assert.rejects(
    client.status(),
    (err: unknown) => err instanceof ClientError && err.kind === 'protocol',
  );
});
