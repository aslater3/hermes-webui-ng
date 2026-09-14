import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatController } from '../../src/hermes/chat-controller.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';
import type { GatewayEvent } from '../../src/hermes/protocol.js';
import type { SessionRef } from '../../src/hermes/session-rest.js';
class Wire {
  state: ConnectionState = { phase: 'ready', generation: 1, attempt: 0 };
  events = new Set<(e: GatewayEvent) => void>(); states = new Set<(s: ConnectionState) => void>();
  sessions = new Map<string, { key: string; profile: string; waiting: boolean }>(); responds = 0; reads = 0;
  onEvent(fn: (e: GatewayEvent) => void) { this.events.add(fn); return () => { this.events.delete(fn); }; }
  onState(fn: (s: ConnectionState) => void) { this.states.add(fn); fn(this.state); return () => { this.states.delete(fn); }; }
  call = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    if (method === 'session.create') {
      const id = `live-${this.sessions.size}`; this.sessions.set(id, { key: `saved-${id}`, profile: String(params.profile || 'default'), waiting: false });
      return { session_id: id, stored_session_id: `saved-${id}`, info: { profile_name: params.profile || 'default' } };
    }
    if (method === 'session.resume') {
      const pair = [...this.sessions].find(([id, row]) => id === params.session_id || row.key === params.session_id)!;
      return { session_id: pair[0], session_key: pair[1].key, info: { profile_name: pair[1].profile } };
    }
    const row = this.sessions.get(String(params.session_id))!;
    if (method === 'session.history') { this.reads++; return { messages: [{ role: 'user', text: 'Saved upstream only' }] }; }
    if (method === 'session.activate') return { running: row.waiting, status: row.waiting ? 'waiting' : 'idle' };
    if (method === 'sudo.respond') { assert.equal(params.password, 'SYNTHETIC_PASSWORD'); this.responds++; row.waiting = false; return { status: 'ok' }; }
    throw new Error('Unexpected test method');
  };
  request(id: string) { this.sessions.get(id)!.waiting = true; this.events.forEach(fn => fn({ type: 'sudo.request', session_id: id, payload: { request_id: `request-${id}` } })); }
}
const reader = {
  sessions: async () => ({ rows: [], total: 0, offset: 0, limit: 20 }), searchSessions: async () => [],
  sessionMessages: async (ref: SessionRef) => ({ ...ref, messages: [], offset: 0, limit: 100, returned: 0 }),
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('switching conversations keeps live request descriptors, clears hidden history, and blocks stale form dispatch', async t => {
  const wire = new Wire(), chat = new ChatController(reader, wire); t.after(() => chat.dispose()); chat.setEnabled(true);
  await chat.create('work'); const first = chat.native, ref = { ...chat.selected! }, sid = first.state.runtimeId!;
  wire.request(sid); await tick(); assert.equal(first.activity.state.inputs[0]?.status, 'pending');
  await chat.create('default'); assert.deepEqual(first.state.messages, []);
  await assert.rejects(first.respond(`sudo:request-${sid}`, 'SYNTHETIC_PASSWORD')); assert.equal(wire.responds, 0);
  await chat.open(ref); assert.equal(chat.native, first); assert.equal(first.activity.state.inputs[0]?.status, 'pending');
  await first.respond(`sudo:request-${sid}`, 'SYNTHETIC_PASSWORD'); assert.equal(wire.responds, 1);
  assert.ok(!JSON.stringify(first.state).includes('SYNTHETIC_PASSWORD')); assert.ok(!JSON.stringify(first.activity.state).includes('SYNTHETIC_PASSWORD'));
  await assert.rejects(first.respond(`sudo:request-${sid}`, 'SYNTHETIC_PASSWORD')); assert.equal(wire.responds, 1);
});
test('a request arriving while another conversation is selected is available on return without another runtime', async t => {
  const wire = new Wire(), chat = new ChatController(reader, wire); t.after(() => chat.dispose()); chat.setEnabled(true);
  await chat.create(); const first = chat.native, ref = { ...chat.selected! };
  await chat.create(); wire.request(first.state.runtimeId!); await tick();
  assert.equal(chat.viewFor(ref)?.activity.state.inputs[0]?.status, 'pending');
  await chat.open(ref); assert.equal(wire.sessions.size, 2); assert.equal(chat.native, first);
  chat.clear(); assert.equal(chat.viewFor(ref), undefined);
  assert.equal(wire.events.size, 1, 'all inactive projections unsubscribed on the account boundary');
});
test('attention opening a runtime resolves its real profile and bounded active views are not silently evicted', async t => {
  const wire = new Wire(), chat = new ChatController(reader, wire); t.after(() => chat.dispose()); chat.setEnabled(true);
  wire.sessions.set('foreign-live', { key: 'foreign-saved', profile: 'work', waiting: false });
  await chat.openLive('foreign-live'); assert.deepEqual(chat.selected, { id: 'foreign-saved', profile: 'work' });
  for (let i = 0; i < 4; i++) { wire.request(chat.native.state.runtimeId!); await tick(); await chat.create(); }
  wire.request(chat.native.state.runtimeId!); await tick();
  await assert.rejects(chat.create()); assert.equal(wire.sessions.size, 5);
});
test('opening the selected conversation reuses its projection and never duplicates request listeners', async t => {
  const wire = new Wire(), chat = new ChatController(reader, wire); t.after(() => chat.dispose()); chat.setEnabled(true);
  await chat.create(); const first = chat.native;
  for (let n = 0; n < 6; n++) await chat.open(chat.selected!);
  assert.equal(chat.native, first); assert.equal(wire.events.size, 1); assert.equal(wire.sessions.size, 1);
});

test('clearing an account never publishes the disposed account view during replacement construction', async t => {
  const wire = new Wire(), chat = new ChatController(reader, wire); t.after(() => chat.dispose()); chat.setEnabled(true);
  await chat.create(); let clearing = false; const observed: (string | undefined)[] = [];
  chat.subscribe(() => { if (clearing) observed.push(chat.native.state.runtimeId); });
  clearing = true; chat.clear();
  assert.ok(observed.length > 0); assert.ok(observed.every(id => id === undefined));
});
