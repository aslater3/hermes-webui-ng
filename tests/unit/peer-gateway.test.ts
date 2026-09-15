import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { WS_PROTOCOL } from '../../src/hermes/ws-auth.js';
import { DiagnosticsRing } from '../../src/hermes/diagnostics.js';
class Socket extends EventTarget {
  protocol = WS_PROTOCOL; readyState = 1; sent: Record<string, unknown>[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
  frame(frame: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) })); }
}
test('modern questions coexist with in-flight RPCs, answer by peer id, and never log secret answers', async t => {
  const socket = new Socket(), diagnostics = new DiagnosticsRing();
  const client = new GatewayClient({ credential: async () => ({ url: 'ws://localhost', protocols: [WS_PROTOCOL] }) },
    { socketFactory: () => socket as unknown as WebSocket, diagnostics, heartbeatMs: 0 });
  t.after(() => client.close());
  const ready = client.connect(); await new Promise(resolve => setTimeout(resolve, 0));
  socket.frame({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: {} } }); await ready;
  const read = client.call('session.status', { session_id: 'live-a' }), id = socket.sent[0]!.id;
  socket.frame({ jsonrpc: '2.0', id: 'srq-secret', method: 'secret', params: { session_id: 'live-a', env_var: 'API_KEY', prompt: 'Enter key' } });
  assert.equal(client.state.phase, 'ready'); assert.equal(client.requests.getSnapshot().length, 1);
  client.requests.respond(client.requests.getSnapshot()[0]!, { value: 'PRIVATE-ANSWER-123' });
  assert.deepEqual(socket.sent[1], { jsonrpc: '2.0', id: 'srq-secret', result: { value: 'PRIVATE-ANSWER-123' } });
  socket.frame({ jsonrpc: '2.0', id, result: { output: 'Native state' } }); assert.deepEqual(await read, { output: 'Native state' });
  socket.frame({ jsonrpc: '2.0', id: 'unknown-peer', method: 'unavailable.bridge', params: { session_id: 'live-a' } });
  assert.equal((socket.sent[2]!.error as Record<string, unknown>).code, -32601); assert.equal(client.state.phase, 'ready');
  assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE-ANSWER'));
  client.close(); assert.equal(client.requests.getSnapshot().length, 0);
});
