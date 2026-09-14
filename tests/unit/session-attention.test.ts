import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionAttention } from '../../src/hermes/session-attention.js';
import { ClientError, type GatewayEvent } from '../../src/hermes/protocol.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';
class Wire {
  state: ConnectionState = { phase: 'ready', generation: 1, attempt: 0 };
  events = new Set<(e: GatewayEvent) => void>(); states = new Set<(s: ConnectionState) => void>();
  rows: unknown[] = []; count = 0; hook?: () => Promise<unknown>;
  call = async (method: string) => { assert.equal(method, 'session.active_list'); this.count++; return this.hook ? this.hook() : { sessions: this.rows }; };
  onEvent(fn: (e: GatewayEvent) => void) { this.events.add(fn); return () => { this.events.delete(fn); }; }
  onState(fn: (s: ConnectionState) => void) { this.states.add(fn); fn(this.state); return () => { this.states.delete(fn); }; }
  emit(type: string, session_id = 'live') { this.events.forEach(fn => fn({ type, session_id, payload: { password: 'NEVER_RETAIN' } })); }
  row(status: string, id = 'live', session_key = 'saved') { return { id, session_key, status, title: 'A chat', preview: 'PRIVATE_BODY', model: 'PRIVATE_MODEL' }; }
}
test('attention uses native statuses but never guesses profile ownership from stored IDs', async t => {
  const wire = new Wire(), store = new SessionAttention(wire); t.after(() => store.dispose()); store.setEnabled(true);
  wire.rows = [wire.row('waiting')]; await store.refresh();
  assert.equal(store.forSession({ id: 'saved', profile: 'work' }), undefined);
  store.bind('live', { id: 'saved', profile: 'default' });
  assert.equal(store.forSession({ id: 'saved', profile: 'work' }), undefined);
  assert.equal(store.forSession({ id: 'saved' })?.status, 'waiting');
  assert.ok(!JSON.stringify(store.items).includes('PRIVATE'));
});
test('completion event does not invent idle; settled background session gets a review badge', async t => {
  const wire = new Wire(), store = new SessionAttention(wire); t.after(() => store.dispose()); store.setEnabled(true);
  wire.rows = [wire.row('working')]; await store.refresh(); wire.emit('message.complete');
  assert.equal(store.items[0]?.status, 'working');
  wire.rows = [wire.row('idle')]; await store.refresh(); assert.equal(store.items[0]?.review, true);
  store.select('live'); assert.equal(store.items[0]?.review, false);
});
test('in-flight snapshots cannot erase a newer request or survive account clearing', async t => {
  const wire = new Wire(), store = new SessionAttention(wire); t.after(() => store.dispose()); store.setEnabled(true);
  wire.rows = [wire.row('working')]; await store.refresh();
  let resolve!: (v: unknown) => void; wire.hook = () => new Promise(r => { resolve = r; });
  const pending = store.refresh(); wire.emit('sudo.request'); resolve({ sessions: [wire.row('idle')] }); await pending;
  assert.equal(store.items[0]?.status, 'waiting'); assert.ok(!JSON.stringify(store.items).includes('NEVER_RETAIN'));
  const old = store.refresh(); store.clear(); resolve({ sessions: [wire.row('waiting')] }); await old;
  assert.deepEqual(store.items, []);
});
test('polling coalesces, bounds inventory and degrades unsupported/error state without affecting chat', async t => {
  const wire = new Wire(), store = new SessionAttention(wire); t.after(() => store.dispose()); store.setEnabled(true);
  wire.rows = Array.from({ length: 110 }, (_, i) => wire.row('waiting', `live${i}`, `saved${i}`));
  await Promise.all([store.refresh(), store.refresh()]); assert.equal(wire.count, 1); assert.equal(store.items.length, 100);
  wire.hook = async () => { throw new ClientError('rpc', 'Unsupported', -32601); };
  await store.refresh(); assert.equal(store.phase, 'unsupported'); assert.equal(store.items[0]?.status, 'unknown');
  store.setVisible(false); await store.refresh(); assert.equal(wire.count, 2);
});

test('working sessions with a confirmed pending approval are reported as waiting without retaining commands', async t => {
  const wire = new Wire(), original = wire.call;
  wire.call = async method => method === 'approval.pending' ? { approvals: [{ command: 'PRIVATE_OPERATION' }] } : original(method);
  const store = new SessionAttention(wire); t.after(() => store.dispose()); store.setEnabled(true);
  wire.rows = [wire.row('working')]; await store.refresh();
  assert.equal(store.items[0]?.status, 'waiting'); assert.ok(!JSON.stringify(store.items).includes('PRIVATE_OPERATION'));
});
