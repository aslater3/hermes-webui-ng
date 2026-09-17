import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionAttention } from '../../src/hermes/session-attention.js';
import { ClientError, type GatewayEvent } from '../../src/hermes/protocol.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';

class Wire {
  state: ConnectionState = { phase: 'ready', generation: 1, attempt: 0 };
  events = new Set<(e: GatewayEvent) => void>(); states = new Set<(s: ConnectionState) => void>();
  rows: unknown[] = []; calls: { method: string; params: Record<string, unknown> }[] = [];
  subagents: Record<string, unknown> = { subagents: [] };
  subagentError?: ClientError;
  call = async (method: string, params: Record<string, unknown> = {}) => {
    this.calls.push({ method, params });
    if (method === 'session.active_list') return { sessions: this.rows };
    if (method === 'subagent.list') { if (this.subagentError) throw this.subagentError; return this.subagents; }
    if (method === 'approval.pending') return { approvals: [] };
    return {};
  };
  onEvent(fn: (e: GatewayEvent) => void) { this.events.add(fn); return () => { this.events.delete(fn); }; }
  onState(fn: (s: ConnectionState) => void) { this.states.add(fn); fn(this.state); return () => { this.states.delete(fn); }; }
  emit(type: string, session_id = 'live', payload: unknown = {}) { this.events.forEach(fn => fn({ type, session_id, payload })); }
  row(status: string, id = 'live', session_key = 'saved') { return { id, session_key, status, title: 'A chat' }; }
  subagentCalls() { return this.calls.filter(entry => entry.method === 'subagent.list'); }
}


test('live subagent events nest under their parent and never under another parent', async t => {
  const wire = new Wire(), store = new SessionAttention(wire);
  t.after(() => store.dispose()); store.setEnabled(true);
  wire.rows = [wire.row('working', 'live'), wire.row('working', 'other', 'saved2')]; await store.refresh();
  wire.emit('subagent.start', 'live', { subagent_id: 'sa-0-1054fd14', goal: 'AFE IRQ fix', status: 'running', model: 'deepseek-v4.1-flash' });
  wire.emit('subagent.tool', 'live', { subagent_id: 'sa-0-1054fd14', tool_name: 'terminal', tool_count: 3 });
  wire.emit('subagent.start', 'other', { subagent_id: 'sa-1-8e55f98e', goal: 'UI cue rate limit', status: 'running' });
  assert.deepEqual(store.subagents('live').map(item => item.subagentId), ['sa-0-1054fd14']);
  assert.deepEqual(store.subagents('other').map(item => item.subagentId), ['sa-1-8e55f98e']);
  const child = store.subagents('live')[0];
  assert.equal(child?.goal, 'AFE IRQ fix'); assert.equal(child?.model, 'deepseek-v4.1-flash');
  assert.equal(child?.lastTool, 'terminal'); assert.equal(child?.toolCount, 3);
});

test('subagent events for a session this client does not track are ignored', async t => {
  const wire = new Wire(), store = new SessionAttention(wire);
  t.after(() => store.dispose()); store.setEnabled(true);
  wire.rows = [wire.row('working', 'live')]; await store.refresh();
  wire.emit('subagent.start', 'stranger', { subagent_id: 'sa-9', goal: 'Someone else', status: 'running' });
  assert.deepEqual(store.subagents('stranger'), []);
  assert.deepEqual(store.subagents('live'), []);
});

test('a completed child is pruned after the retention window without disturbing the parent', async t => {
  const wire = new Wire(), store = new SessionAttention(wire, 5000, 20);
  t.after(() => store.dispose()); store.setEnabled(true);
  wire.rows = [wire.row('working', 'live')]; await store.refresh();
  wire.emit('subagent.start', 'live', { subagent_id: 'sa-0', goal: 'Work', status: 'running' });
  wire.emit('subagent.complete', 'live', { subagent_id: 'sa-0', status: 'completed', duration_seconds: 12 });
  assert.equal(store.subagents('live')[0]?.status, 'completed');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual(store.subagents('live'), []);
  assert.equal(store.items.length, 1);
  assert.equal(store.items[0]?.runtimeId, 'live');
});

test('hydration reads the roster only for owned parents and stays silent when Hermes refuses', async t => {
  const wire = new Wire(), store = new SessionAttention(wire);
  t.after(() => store.dispose()); store.setEnabled(true);
  wire.rows = [wire.row('working', 'owned'), wire.row('working', 'unowned', 'saved2')];
  store.bind('owned', { id: 'saved', profile: 'default' });
  wire.subagents = { subagents: [{ subagent_id: 'sa-7', goal: 'Hydrated', status: 'working', last_tool: 'read_file' }], delegations: [] };
  await store.refresh();
  assert.deepEqual(wire.subagentCalls().map(entry => entry.params.session_id), ['owned']);
  assert.deepEqual(store.subagents('owned').map(item => item.subagentId), ['sa-7']);
  wire.subagentError = new ClientError('rpc', 'Hermes RPC rejected (4001)', 4001);
  await store.refresh();
  assert.deepEqual(store.subagents('owned').map(item => item.subagentId), ['sa-7']);
});

test('hydration never erases a child the live stream reported as running', async t => {
  const wire = new Wire(), store = new SessionAttention(wire);
  t.after(() => store.dispose()); store.setEnabled(true);
  wire.rows = [wire.row('working', 'owned')]; store.bind('owned', { id: 'saved', profile: 'default' });
  await store.refresh();
  wire.emit('subagent.start', 'owned', { subagent_id: 'sa-live', goal: 'Still running', status: 'running' });
  wire.subagents = { subagents: [] };
  await store.refresh();
  assert.deepEqual(store.subagents('owned').map(item => item.subagentId), ['sa-live']);
});

test('a child event for a parent that is not listed yet triggers one discovery refresh', async t => {
  const wire = new Wire(), store = new SessionAttention(wire);
  t.after(() => store.dispose()); store.setEnabled(true);
  wire.rows = []; await store.refresh();
  wire.subagents = { subagents: [{ subagent_id: 'sa-late', goal: 'Late child', status: 'working' }], delegations: [] };
  wire.emit('subagent.start', 'late', { subagent_id: 'sa-late', status: 'running' });
  // The parent row only becomes visible on the discovery refresh the child frame scheduled.
  assert.equal(store.items.length, 0);
  wire.rows = [wire.row('working', 'late')]; store.bind('late', { id: 'saved', profile: 'default' });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.deepEqual(store.items.map(item => item.runtimeId), ['late']);
  assert.deepEqual(store.subagents('late').map(item => item.subagentId), ['sa-late']);
});

test('a late roster read cannot reopen a completed child, and an empty one does not retire live work at once', async t => {
  const wire = new Wire(), store = new SessionAttention(wire);
  t.after(() => store.dispose()); store.setEnabled(true);
  wire.rows = [wire.row('working', 'owned')]; store.bind('owned', { id: 'saved', profile: 'default' });
  await store.refresh();
  wire.emit('subagent.start', 'owned', { subagent_id: 'sa-0', goal: 'Work', status: 'running' });
  wire.emit('subagent.complete', 'owned', { subagent_id: 'sa-0', status: 'completed', duration_seconds: 12 });
  assert.equal(store.subagents('owned')[0]?.status, 'completed');
  // A host that still lists the child as running must not move a finished child back to running.
  wire.subagents = { subagents: [{ subagent_id: 'sa-0', goal: 'Work', status: 'running', tool_count: 2 }] };
  await store.refresh();
  assert.equal(store.subagents('owned')[0]?.status, 'completed');
  assert.equal(store.subagents('owned')[0]?.toolCount, 2);
  // A second child with no roster entry survives a bounded run of omissions, then leaves.
  wire.emit('subagent.start', 'owned', { subagent_id: 'sa-1', goal: 'Silent child', status: 'running' });
  wire.subagents = { subagents: [] };
  await store.refresh(); await store.refresh();
  assert.deepEqual(store.subagents('owned').map(item => item.subagentId), ['sa-0', 'sa-1']);
  await store.refresh();
  assert.deepEqual(store.subagents('owned').map(item => item.subagentId), ['sa-0']);
});

test('account clearing and session removal drop nested children', async t => {
  const wire = new Wire(), store = new SessionAttention(wire, 5000, 20_000);
  t.after(() => store.dispose()); store.setEnabled(true);
  wire.rows = [wire.row('working', 'live')]; await store.refresh();
  wire.emit('subagent.start', 'live', { subagent_id: 'sa-0', goal: 'Work', status: 'running' });
  wire.rows = [];
  await store.refresh();
  assert.deepEqual(store.subagents('live'), []);
  assert.deepEqual(store.items, []);
  wire.rows = [wire.row('working', 'live')]; await store.refresh();
  wire.emit('subagent.start', 'live', { subagent_id: 'sa-0', goal: 'Work', status: 'running' });
  store.clear();
  assert.deepEqual(store.subagents('live'), []);
});
