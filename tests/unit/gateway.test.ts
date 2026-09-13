import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { ClientError } from '../../src/hermes/protocol.js';
import { WS_PROTOCOL, type WsCredential } from '../../src/hermes/dashboard-client.js';

class FakeSocket extends EventTarget {
  protocol = WS_PROTOCOL;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  frame(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
  ready() {
    this.open();
    this.frame({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'gateway.ready', payload: { heartbeat: true } },
    });
  }
  drop(code = 1006) {
    this.readyState = 3;
    const event = new Event('close');
    Object.defineProperty(event, 'code', { value: code });
    this.dispatchEvent(event);
  }
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function harness(maxRetries = 0) {
  const sockets: FakeSocket[] = [];
  let tickets = 0;
  const client = new GatewayClient(
    {
      credential: async () => ({
        url: 'ws://localhost/__hermes/api/ws',
        protocols: [WS_PROTOCOL, `ticket-${++tickets}`],
      }),
    },
    {
      heartbeatMs: 0,
      connectTimeoutMs: 2000,
      requestTimeoutMs: 1000,
      maxRetries,
      retryBaseMs: 2,
      random: () => 0,
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    },
  );
  return { client, sockets, tickets: () => tickets };
}

test('open is not ready; RPC calls correlate independently of response order', async (t) => {
  const h = harness();
  t.after(() => h.client.close());
  const connect = h.client.connect();
  await tick();
  const socket = h.sockets[0]!;
  socket.open();
  assert.equal(h.client.state.phase, 'connecting');
  socket.ready();
  await connect;
  assert.equal(h.client.state.phase, 'ready');
  const first = h.client.call('session.create');
  const second = h.client.call('session.list');
  socket.frame({ jsonrpc: '2.0', id: socket.sent[1]!.id, result: { second: true } });
  socket.frame({ jsonrpc: '2.0', id: socket.sent[0]!.id, result: { first: true } });
  assert.deepEqual(await first, { first: true });
  assert.deepEqual(await second, { second: true });
});

test('superseding credential mint rejects the old attempt and ignores its late result', async (t) => {
  const mints: ((credential: WsCredential) => void)[] = [];
  const sockets: FakeSocket[] = [];
  const client = new GatewayClient(
    { credential: () => new Promise((resolve) => mints.push(resolve)) },
    {
      heartbeatMs: 0,
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    },
  );
  t.after(() => client.close());
  const old = client.connect();
  const rejected = assert.rejects(
    old,
    (err: unknown) => err instanceof ClientError && err.kind === 'disconnected',
  );
  const fresh = client.reconnect();
  const credential = { url: 'ws://localhost/__hermes/api/ws', protocols: [WS_PROTOCOL] };
  mints[0]!(credential);
  await tick();
  assert.equal(sockets.length, 0);
  mints[1]!(credential);
  await tick();
  sockets[0]!.ready();
  await fresh;
  await rejected;
  assert.equal(sockets.length, 1);
});

test('network reconnect mints again and never replays an unacknowledged prompt', async (t) => {
  const h = harness(2);
  t.after(() => h.client.close());
  const connected = h.client.connect();
  await tick();
  h.sockets[0]!.ready();
  await connected;
  const pending = h.client.call('prompt.submit', { session_id: 'runtime', text: 'test' });
  const rejected = assert.rejects(
    pending,
    (err: unknown) => err instanceof ClientError && err.kind === 'network',
  );
  h.sockets[0]!.drop();
  await rejected;
  for (let i = 0; h.sockets.length < 2 && i < 100; i++) await tick();
  assert.equal(h.tickets(), 2);
  h.sockets[1]!.ready();
  h.sockets[0]!.frame({
    jsonrpc: '2.0',
    method: 'event',
    params: { type: 'message.delta', payload: { text: 'stale' } },
  });
  assert.equal(h.sockets[1]!.sent.length, 0);
  assert.equal(h.client.state.phase, 'ready');
});

test('auth and malformed protocol failures are terminal rather than infinite reconnects', async (t) => {
  for (const code of [4401, 4403, 1002]) {
    const h = harness(5);
    t.after(() => h.client.close());
    const connect = h.client.connect();
    const rejected = assert.rejects(connect);
    await tick();
    h.sockets[0]!.drop(code);
    await rejected;
    assert.equal(h.client.state.phase, code === 4401 ? 'auth-required' : 'error');
    await h.client.ensureLive();
    assert.equal(h.tickets(), 1);
  }
  const h = harness(5);
  t.after(() => h.client.close());
  const connect = h.client.connect();
  const rejected = assert.rejects(connect);
  await tick();
  h.sockets[0]!.frame({ private: 'do-not-log' });
  await rejected;
  assert.equal(h.client.state.error?.kind, 'protocol');
  assert.equal(h.tickets(), 1);
});

test('RPC acknowledgement timeout rejects without sending a second request', async (t) => {
  const h = harness();
  t.after(() => h.client.close());
  const connect = h.client.connect();
  await tick();
  h.sockets[0]!.ready();
  await connect;
  await assert.rejects(
    h.client.call('prompt.submit', {}, 5),
    (err: unknown) => err instanceof ClientError && err.kind === 'timeout',
  );
  assert.equal(h.sockets[0]!.sent.length, 1);
  assert.equal(h.client.state.phase, 'ready');
});

test('network retry count is bounded and close cancels all future attempts', async (t) => {
  const h = harness(2);
  t.after(() => h.client.close());
  const connect = h.client.connect();
  const rejected = assert.rejects(connect);
  await tick();
  h.sockets[0]!.drop();
  await rejected;
  for (let n = 1; n <= 2; n++) {
    for (let i = 0; h.sockets.length <= n && i < 100; i++) await tick();
    h.sockets[n]!.drop();
  }
  assert.equal(h.tickets(), 3);
  assert.equal(h.client.state.phase, 'error');
  h.client.close();
  await tick();
  assert.equal(h.tickets(), 3);
});
