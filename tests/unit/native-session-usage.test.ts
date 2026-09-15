import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeSession } from '../../src/hermes/native-session.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';
import type { GatewayEvent } from '../../src/hermes/protocol.js';

class UsageRpc {
  state: ConnectionState = { phase: 'ready', generation: 1, attempt: 0 };
  events = new Set<(event: GatewayEvent) => void>();
  states = new Set<(state: ConnectionState) => void>();
  calls: string[] = [];
  runtime = 'live-default';
  info: unknown = { profile_name: 'default', usage: { input: 20, output: 8, total: 28, calls: 1 } };
  activateHook?: () => Promise<unknown>;
  call = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    this.calls.push(method);
    if (method === 'session.create' || method === 'session.resume') return {
      session_id: this.runtime, stored_session_id: params.session_id || 'durable-default', info: this.info,
    };
    if (method === 'session.history') return { messages: [] };
    if (method === 'session.activate') return this.activateHook ? this.activateHook() : { running: false, info: this.info };
    throw new Error(`Unexpected mutation or polling: ${method}`);
  };
  onEvent(fn: (event: GatewayEvent) => void) { this.events.add(fn); return () => { this.events.delete(fn); }; }
  onState(fn: (state: ConnectionState) => void) { this.states.add(fn); fn(this.state); return () => { this.states.delete(fn); }; }
  emit(type: string, usage: unknown, session_id = this.runtime) {
    this.events.forEach(fn => fn({ type, session_id, payload: { usage } }));
  }
  phase(phase: ConnectionState['phase']) {
    this.state = { phase, generation: this.state.generation + 1, attempt: 0 };
    this.states.forEach(fn => fn(this.state));
  }
}
const usageOf = (session: NativeSession) => session.state.usage;
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test('usage hydrates from native info, live ticker does not fetch history or alter run state', async t => {
  const rpc = new UsageRpc(), session = new NativeSession(rpc); t.after(() => session.dispose());
  await session.create(); assert.equal(usageOf(session)?.total, 28);
  const calls = rpc.calls.length;
  for (let i = 0; i < 25; i++) rpc.emit('session.usage', { total: i, context_used: i, context_max: 100 });
  assert.equal(usageOf(session)?.total, 28, 'cumulative totals do not move backwards within one runtime');
  assert.equal(usageOf(session)?.contextUsed, 24); assert.equal(session.state.phase, 'idle');
  assert.equal(rpc.calls.length, calls, 'usage notifications never poll or refetch full transcripts');
  rpc.emit('session.usage', { total: 9000 }, 'another-session');
  assert.equal(usageOf(session)?.total, 28);
});

test('a live usage event wins over an older in-flight native snapshot without recovery starvation', async t => {
  const rpc = new UsageRpc(), session = new NativeSession(rpc); t.after(() => session.dispose()); await session.create();
  let finish!: (value: unknown) => void;
  rpc.activateHook = () => new Promise(resolve => { finish = resolve; });
  const refresh = session.refresh(), calls = rpc.calls.length;
  rpc.emit('session.usage', { total: 99 });
  finish({ running: false, info: { usage: { total: 28 } } }); await refresh;
  assert.equal(usageOf(session)?.total, 99); assert.equal(rpc.calls.length, calls);
  rpc.activateHook = undefined; rpc.info = { usage: { total: 100 } }; await session.refresh();
  assert.equal(usageOf(session)?.total, 100, 'subsequent authoritative reads can advance the event');
});

test('completed-turn counters survive the zeroed idle cleanup snapshot', async t => {
  const rpc = new UsageRpc(), session = new NativeSession(rpc); t.after(() => session.dispose()); await session.create();
  const completed = { input: 300, output: 50, reasoning: 10, total: 350, calls: 2,
    context_used: 6400, context_max: 128000, context_percent: 5, compressions: 0 };
  rpc.info = { usage: { input: 0, output: 0, reasoning: 0, total: 0, calls: 0,
    context_used: 0, context_max: 128000, context_percent: 0, compressions: 0 } };
  rpc.emit('message.complete', completed); await session.refresh();
  assert.deepEqual(usageOf(session), {
    input: 300, output: 50, reasoning: 10, total: 350, calls: 2,
    contextUsed: 6400, contextMax: 128000, contextPercent: 5, compressions: 0,
  });
});

test('switching profile rejects late snapshots and old-session usage events', async t => {
  const rpc = new UsageRpc(), session = new NativeSession(rpc); t.after(() => session.dispose()); await session.create();
  let finish!: (value: unknown) => void;
  rpc.activateHook = () => new Promise(resolve => { finish = resolve; });
  const old = assert.rejects(session.refresh());
  rpc.activateHook = undefined; rpc.runtime = 'live-work'; rpc.info = { profile_name: 'work', usage: { total: 7 } };
  await session.resume('durable-work', 'work');
  finish({ running: false, info: { profile_name: 'default', usage: { total: 999 } } }); await old;
  rpc.emit('session.usage', { total: 888 }, 'live-default');
  assert.equal(session.state.profile, 'work'); assert.equal(usageOf(session)?.total, 7);
});

test('background projections clear usage and ignore events/snapshots until explicitly selected again', async t => {
  const rpc = new UsageRpc(), session = new NativeSession(rpc); t.after(() => session.dispose()); await session.create();
  session.setForeground(false); assert.equal(usageOf(session), undefined);
  rpc.emit('session.usage', { total: 99 }); await session.refresh(); assert.equal(usageOf(session), undefined);
  session.setForeground(true); assert.equal(usageOf(session), undefined);
  await session.refresh(); assert.equal(usageOf(session)?.total, 28);
});

test('disconnect clears usage; reconnect rehydrates from Hermes with no settings or prompt replay', async t => {
  const rpc = new UsageRpc(), session = new NativeSession(rpc); t.after(() => session.dispose()); await session.create();
  rpc.phase('reconnecting'); assert.equal(usageOf(session), undefined);
  rpc.emit('session.usage', { total: 999 }); assert.equal(usageOf(session), undefined);
  rpc.runtime = 'live-new-connection'; rpc.info = { usage: { total: 44 } }; rpc.phase('ready'); await tick();
  assert.equal(usageOf(session)?.total, 44);
  assert.equal(rpc.calls.filter(method => method === 'session.create').length, 1);
  assert.equal(rpc.calls.filter(method => method === 'session.resume').length, 1);
});

test('missing/invalid native usage clears previous counters without breaking chat', async t => {
  const rpc = new UsageRpc(), session = new NativeSession(rpc); t.after(() => session.dispose()); await session.create();
  rpc.info = {}; await session.refresh(); assert.equal(usageOf(session), undefined); assert.equal(session.state.phase, 'idle');
  rpc.emit('session.usage', { total: 42 }); assert.equal(usageOf(session)?.total, 42);
  rpc.emit('session.usage', { total: 'private-not-a-number' }); assert.equal(usageOf(session), undefined);
  rpc.info = { usage: { calls: 0 } }; await session.refresh(); assert.equal(usageOf(session)?.calls, 0);
});

test('completion/info usage are reconciled, and failed recovery never displays stale counters as current', async t => {
  const rpc = new UsageRpc(), session = new NativeSession(rpc); t.after(() => session.dispose()); await session.create();
  rpc.info = { usage: { total: 56 } }; rpc.emit('message.complete', { total: 56 }); await session.refresh();
  assert.equal(usageOf(session)?.total, 56);
  rpc.info = { usage: {} }; rpc.emit('session.info', {}); await session.refresh(); assert.equal(usageOf(session), undefined);
  rpc.emit('session.usage', { total: 28 });
  rpc.activateHook = async () => { throw new Error('Unavailable'); };
  await assert.rejects(session.refresh()); assert.equal(usageOf(session), undefined);
});

test('dispose clears the usage projection and removes all callbacks', async () => {
  const rpc = new UsageRpc(), session = new NativeSession(rpc); await session.create(); session.dispose();
  rpc.emit('session.usage', { total: 999 }); assert.equal(usageOf(session), undefined);
  assert.equal(rpc.events.size, 0); assert.equal(rpc.states.size, 0);
});


test('native snapshots adopt a rotated durable key after compression without guessing a different runtime', async t => {
  const rpc = new UsageRpc(), session = new NativeSession(rpc); t.after(() => session.dispose()); await session.create();
  const runtimeId = session.state.runtimeId;
  rpc.info = { stored_session_id: 'durable-compressed', profile_name: 'default', usage: { total: 56 } };
  await session.refresh();
  assert.equal(session.state.storedId, 'durable-compressed'); assert.equal(session.state.runtimeId, runtimeId);
  rpc.phase('reconnecting'); rpc.phase('ready'); await tick();
  assert.equal(session.state.storedId, 'durable-compressed');
});

test('invalid rotated durable identifiers fail closed before changing navigation ownership', async t => {
  const rpc = new UsageRpc(), session = new NativeSession(rpc); t.after(() => session.dispose()); await session.create();
  rpc.info = { stored_session_id: '../../private' };
  await assert.rejects(session.refresh()); assert.equal(session.state.storedId, 'durable-default');
  assert.equal(session.state.phase, 'error');
});
