import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { ClientError } from '../../src/hermes/protocol.js';
import { DiagnosticsRing } from '../../src/hermes/diagnostics.js';
import { WS_PROTOCOL } from '../../src/hermes/dashboard-client.js';
class FakeSocket extends EventTarget {
  protocol = WS_PROTOCOL; readyState = 0; sent: Record<string, unknown>[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  frame(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  raw(data: string) { this.dispatchEvent(new MessageEvent('message', { data })); }
  ready() { this.open(); this.frame({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: { heartbeat: true } } }); }
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function harness() {
  const sockets: FakeSocket[] = []; let tickets = 0;
  const diagnostics = new DiagnosticsRing();
  const client = new GatewayClient({ credential: async () => ({ url: 'ws://localhost/__hermes/api/ws', protocols: [WS_PROTOCOL, `ticket-${++tickets}`] }) }, {
    heartbeatMs: 0, connectTimeoutMs: 2000, requestTimeoutMs: 1000, maxRetries: 0, diagnostics,
    socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket; },
  });
  return { client, sockets, diagnostics, tickets: () => tickets };
}
test('simultaneous lifecycle checks share one ping and never publish a second ready transition', async (t) => {
  const h = harness(); t.after(() => h.client.close());
  const ready = h.client.connect(); await tick(); h.sockets[0]!.ready(); await ready;
  let readyTransitions = 0;
  h.client.onState((state) => { if (state.phase === 'ready') readyTransitions++; });
  const first = h.client.ensureLive(); const second = h.client.ensureLive();
  // The connection also sends its one-time capability advertisement on ready, so count pings, not frames.
  const pings = () => h.sockets[0]!.sent.filter((frame) => frame.method === 'gateway.ping');
  assert.equal(first, second); assert.equal(pings().length, 1);
  const request = pings()[0]!;
  h.sockets[0]!.frame({ jsonrpc: '2.0', id: request.id, result: { ok: true } }); await first;
  assert.equal(h.tickets(), 1); assert.equal(readyTransitions, 1);
  assert.equal(h.client.advertised().heartbeat, true);
  assert.equal(typeof h.client.telemetry().latencyMs, 'number');
});
test('REST auth expiry cancels admission and pending RPCs even during a lifecycle ping', async (t) => {
  const h = harness(); t.after(() => h.client.close());
  const ready = h.client.connect(); await tick(); h.sockets[0]!.ready(); await ready;
  const resume = h.client.ensureLive(); h.client.suspend(new ClientError('auth-required', 'Sign in again'));
  await resume; await h.client.ensureLive();
  assert.equal(h.client.state.phase, 'auth-required'); assert.deepEqual(h.client.advertised(), {});
  assert.equal(h.tickets(), 1); assert.equal(h.sockets[0]!.readyState, 3);
});

test('a reply above the frame cap fails its own RPC and leaves the connection usable', async (t) => {
  const h = harness(); t.after(() => h.client.close());
  const ready = h.client.connect(); await tick(); h.sockets[0]!.ready(); await ready;
  const oversized = h.client.call('session.history', { session_id: 'durable' });
  const request = h.sockets[0]!.sent.at(-1)!;
  h.sockets[0]!.raw(`{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},"result":{"messages":"${'x'.repeat(4_200_000)}"}}`);
  await assert.rejects(oversized, (err: unknown) => err instanceof ClientError && err.kind === 'protocol');
  // The whole-tab consequence was the defect: one refused reply must not read as "the Gateway is gone".
  assert.equal(h.client.state.phase, 'ready'); assert.equal(h.sockets[0]!.readyState, 1);
  const following = h.client.call('session.activate', { session_id: 'durable' });
  const next = h.sockets[0]!.sent.at(-1)!;
  h.sockets[0]!.frame({ jsonrpc: '2.0', id: next.id, result: { running: false } });
  assert.deepEqual(await following, { running: false });
});

test('the connection advertises that it answers server→client requests', async (t) => {
  // Without this handshake the backend treats the tab as a build that cannot answer and never sends an
  // approval or clarify, so those prompts silently stop reaching the UI. It is per transport, so a
  // reconnect must repeat it.
  const h = harness(); t.after(() => h.client.close());
  const ready = h.client.connect(); await tick(); h.sockets[0]!.ready(); await ready;
  const advertised = () => h.sockets[0]!.sent.find((frame) => frame.method === 'client.capabilities');
  assert.ok(advertised(), 'ready must send the capability handshake');
  assert.deepEqual(advertised()!.params, { server_requests: true });
  h.sockets[0]!.frame({ jsonrpc: '2.0', id: advertised()!.id, result: { server_requests: ['approval'] } });
  await tick();
  assert.ok(h.diagnostics.snapshot().some((entry) => entry.method === 'client.capabilities'),
    'the handshake must reach diagnostics, or a later investigation cannot tell whether it was sent');
  const again = h.client.reconnect(); await tick(); h.sockets[1]!.ready(); await again;
  assert.ok(h.sockets[1]!.sent.some((frame) => frame.method === 'client.capabilities'),
    'a new transport must advertise again, or approvals stop after any reconnect');
});

test('a rejected capability handshake leaves the connection usable', async (t) => {
  const h = harness(); t.after(() => h.client.close());
  const ready = h.client.connect(); await tick(); h.sockets[0]!.ready(); await ready;
  const advertised = h.sockets[0]!.sent.find((frame) => frame.method === 'client.capabilities')!;
  h.sockets[0]!.frame({ jsonrpc: '2.0', id: advertised.id, error: { code: -32601 } });
  await tick();
  assert.equal(h.client.state.phase, 'ready');
  const following = h.client.call('session.activate', { session_id: 'durable' });
  const request = (method: string) => h.sockets[0]!.sent.find((frame) => frame.method === method)!;
  h.sockets[0]!.frame({ jsonrpc: '2.0', id: request('session.activate').id, result: { running: false } });
  assert.deepEqual(await following, { running: false });
});

test('a frame the client cannot attribute still fails the connection', async (t) => {
  const h = harness(); t.after(() => h.client.close());
  const ready = h.client.connect(); await tick(); h.sockets[0]!.ready(); await ready;
  h.sockets[0]!.raw('x'.repeat(4_200_000));
  assert.equal(h.client.state.phase, 'error');
  assert.equal(h.client.state.error?.kind, 'protocol');
});
