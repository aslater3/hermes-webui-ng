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
    if (method === 'session.history') return this.historyHook ? this.historyHook() : { messages: this.messages };
    if (method === 'session.activate') return { running: this.running, status: this.running ? 'working' : 'idle' };
    if (method === 'prompt.submit') { this.running = true; return { status: 'streaming' }; }
    if (method === 'session.interrupt') { this.running = false; return { ok: true }; }
    throw new Error('unsupported test method');
  };
  onEvent(fn: (event: GatewayEvent) => void) {
    this.events.add(fn); return () => { this.events.delete(fn); };
  }
  onState(fn: (state: ConnectionState) => void) {
    this.states.add(fn); fn(this.state); return () => { this.states.delete(fn); };
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

test('unacknowledged send remains marked uncertain through automatic reconnect', async () => {
  const rpc = new Rpc(), original = rpc.call;
  let reject!: (error: Error) => void;
  rpc.call = (method, params) => method === 'prompt.submit' ? new Promise((_resolve, r) => { reject = r; }) : original(method, params);
  const session = new NativeSession(rpc); await session.create();
  const sent = session.submit('uncertain'), failed = assert.rejects(sent);
  rpc.phase('reconnecting'); reject(new Error('lost acknowledgement')); await failed;
  rpc.phase('ready'); await tick();
  assert.equal(session.state.deliveryUnknown, true); assert.equal(session.state.submitting, false);
  session.dispose();
});

test('an idle snapshot cannot reopen submission while the first acknowledgement is pending', async () => {
  const rpc = new Rpc(), original = rpc.call;
  let finish!: (value: unknown) => void, submits = 0;
  rpc.call = (method, params) => {
    if (method !== 'prompt.submit') return original(method, params);
    submits++; return new Promise((resolve) => { finish = resolve; });
  };
  const session = new NativeSession(rpc); await session.create();
  const sent = session.submit('first'); await session.refresh();
  assert.equal(session.state.phase, 'running'); await assert.rejects(session.submit('duplicate'));
  finish({ status: 'streaming' }); await sent; assert.equal(submits, 1); session.dispose();
});

test('repeated interrupt clicks share one RPC and preserve running until upstream settles', async () => {
  const rpc = new Rpc(), original = rpc.call;
  let finish!: (value: unknown) => void, stops = 0;
  rpc.call = (method, params) => {
    if (method !== 'session.interrupt') return original(method, params);
    stops++; return new Promise((resolve) => { finish = resolve; });
  };
  const session = new NativeSession(rpc); await session.create(); await session.submit('running');
  const a = session.interrupt(), b = session.interrupt();
  assert.equal(stops, 1); assert.equal(session.state.interrupting, true);
  finish({ ok: true }); await Promise.all([a,b]); assert.equal(session.state.phase, 'running');
  rpc.running = false; rpc.emit('session.info'); await tick();
  assert.equal(session.state.phase, 'idle'); session.dispose();
});

test('native transcript window is bounded and long entries are explicitly marked', async () => {
  const rpc = new Rpc();
  rpc.messages = Array.from({length: 120}, (_, i) => ({ role:'assistant', text: i === 119 ? 'x'.repeat(140000) : String(i) }));
  const session = new NativeSession(rpc); await session.create();
  assert.equal(session.state.messages.length, 100); assert.equal(session.state.totalMessages, 120);
  assert.equal(session.state.messages[0]?.text, '20'); assert.equal(session.state.messages.at(-1)?.truncated, true);
  session.dispose();
});
