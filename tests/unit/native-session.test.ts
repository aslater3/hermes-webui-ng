import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeSession } from '../../src/hermes/native-session.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';
import type { GatewayEvent } from '../../src/hermes/protocol.js';

class Rpc {
  state: ConnectionState = { phase: 'ready', generation: 1, attempt: 0 };
  events = new Set<(event: GatewayEvent) => void>();
  states = new Set<(state: ConnectionState) => void>();
  calls: { method: string; params: Record<string, unknown> }[] = [];
  runtime = 'live-1';
  messages = [{ role: 'user', text: 'initial' }];
  running = false;
  historyHook?: () => Promise<unknown>;
  call = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    this.calls.push({ method, params });
    if (method === 'session.create') return { session_id: this.runtime, stored_session_id: 'durable' };
    if (method === 'session.resume') return { session_id: this.runtime, session_key: params.session_id };
    if (method === 'session.history')
      return this.historyHook ? this.historyHook() : { messages: this.messages };
    if (method === 'session.activate')
      return { running: this.running, status: this.running ? 'working' : 'idle' };
    if (method === 'prompt.submit') {
      this.running = true;
      return { status: 'streaming' };
    }
    if (method === 'session.interrupt') {
      this.running = false;
      return { ok: true };
    }
    throw new Error('unsupported test method');
  };
  onEvent(fn: (event: GatewayEvent) => void) {
    this.events.add(fn);
    return () => {
      this.events.delete(fn);
    };
  }
  onState(fn: (state: ConnectionState) => void) {
    this.states.add(fn);
    fn(this.state);
    return () => {
      this.states.delete(fn);
    };
  }
  emit(type: string, session_id = this.runtime) {
    this.events.forEach((fn) => fn({ type, session_id, payload: {} }));
  }
  phase(phase: ConnectionState['phase']) {
    this.state = { phase, generation: this.state.generation + 1, attempt: 0 };
    this.states.forEach((fn) => fn(this.state));
  }
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('native durable and runtime IDs remain distinct; a fresh client resumes without local history', async () => {
  const rpc = new Rpc();
  const first = new NativeSession(rpc);
  await first.create();
  assert.equal(first.state.storedId, 'durable');
  assert.equal(first.state.runtimeId, 'live-1');
  first.dispose();
  rpc.runtime = 'live-2';
  const next = new NativeSession(rpc);
  await next.resume('durable');
  assert.equal(next.state.runtimeId, 'live-2');
  assert.deepEqual(next.state.messages, rpc.messages);
  assert.equal(rpc.calls.filter((call) => call.method === 'session.create').length, 1);
  next.dispose();
});

test('completion racing with history rehydration forces a fresh authoritative snapshot', async () => {
  const rpc = new Rpc();
  const session = new NativeSession(rpc);
  await session.create();
  let finish!: (value: unknown) => void;
  rpc.historyHook = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const recovering = session.refresh();
  await tick();
  rpc.messages = [...rpc.messages, { role: 'assistant', text: 'completed during fetch' }];
  rpc.historyHook = undefined;
  rpc.emit('message.complete');
  finish({ messages: [{ role: 'user', text: 'stale snapshot' }] });
  await recovering;
  assert.equal(session.state.messages.at(-1)?.text, 'completed during fetch');
  assert.equal(session.state.phase, 'idle');
  assert.equal(rpc.calls.filter((call) => call.method === 'session.history').length, 3);
  session.dispose();
});

test('late history from an old selection cannot contaminate a newly resumed session', async () => {
  const rpc = new Rpc();
  const session = new NativeSession(rpc);
  await session.create();
  let finish!: (value: unknown) => void;
  rpc.historyHook = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const old = session.refresh();
  const rejected = assert.rejects(old);
  await tick();
  rpc.historyHook = undefined;
  rpc.messages = [{ role: 'user', text: 'new selection' }];
  await session.resume('other-durable');
  finish({ messages: [{ role: 'user', text: 'private old selection' }] });
  await rejected;
  assert.equal(session.state.storedId, 'other-durable');
  assert.equal(session.state.messages[0]?.text, 'new selection');
  session.dispose();
});

test('reconnect resumes the durable key and never submits or creates again', async () => {
  const rpc = new Rpc();
  const session = new NativeSession(rpc);
  await session.create();
  await session.submit('test prompt');
  await assert.rejects(session.submit('double click'));
  rpc.phase('reconnecting');
  rpc.runtime = 'live-after-restart';
  rpc.running = false;
  rpc.messages.push({ role: 'assistant', text: 'finished while disconnected' });
  rpc.phase('ready');
  await tick();
  assert.equal(session.state.runtimeId, 'live-after-restart');
  assert.equal(session.state.messages.at(-1)?.text, 'finished while disconnected');
  const resume = rpc.calls.find((call) => call.method === 'session.resume');
  assert.equal(resume?.params.session_id, 'durable');
  assert.equal(rpc.calls.filter((call) => call.method === 'prompt.submit').length, 1);
  assert.equal(rpc.calls.filter((call) => call.method === 'session.create').length, 1);
  session.dispose();
});
