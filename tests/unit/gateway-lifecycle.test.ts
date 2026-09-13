import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { ClientError } from '../../src/hermes/protocol.js';
import { WS_PROTOCOL } from '../../src/hermes/dashboard-client.js';
class FakeSocket extends EventTarget {
  protocol = WS_PROTOCOL; readyState = 0; sent: Record<string, unknown>[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  frame(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  ready() { this.open(); this.frame({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: { heartbeat: true } } }); }
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function harness() {
  const sockets: FakeSocket[] = []; let tickets = 0;
  const client = new GatewayClient({ credential: async () => ({ url: 'ws://localhost/__hermes/api/ws', protocols: [WS_PROTOCOL, `ticket-${++tickets}`] }) }, {
    heartbeatMs: 0, connectTimeoutMs: 2000, requestTimeoutMs: 1000, maxRetries: 0,
    socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket; },
  });
  return { client, sockets, tickets: () => tickets };
}
test('simultaneous lifecycle checks share one ping and never publish a second ready transition', async (t) => {
  const h = harness(); t.after(() => h.client.close());
  const ready = h.client.connect(); await tick(); h.sockets[0]!.ready(); await ready;
  let readyTransitions = 0;
  h.client.onState((state) => { if (state.phase === 'ready') readyTransitions++; });
  const first = h.client.ensureLive(); const second = h.client.ensureLive();
  assert.equal(first, second); assert.equal(h.sockets[0]!.sent.length, 1);
  const request = h.sockets[0]!.sent[0]!;
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
