import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatController } from '../../src/hermes/chat-controller.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';
import type { GatewayEvent } from '../../src/hermes/protocol.js';
import { commandFixture } from '../fixtures/commands.js';
function fixture() {
  let sequence = 0;
  const state: ConnectionState = { phase: 'ready', generation: 1, attempt: 0 };
  const events = new Set<(event: GatewayEvent) => void>(), states = new Set<(state: ConnectionState) => void>();
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let commandHook: (() => Promise<unknown>) | undefined;
  const gateway = { state, onState: (cb: (state: ConnectionState) => void) => { states.add(cb); cb(state); return () => { states.delete(cb); }; },
    onEvent: (cb: (event: GatewayEvent) => void) => { events.add(cb); return () => { events.delete(cb); }; },
    call: async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      calls.push({ method, params });
      if (['session.create', 'session.resume'].includes(method)) return { session_id: `live-${++sequence}`, stored_session_id: params.session_id ?? `stored-${sequence}`, info: { profile_name: params.profile ?? 'default' } };
      if (method === 'session.history') return { messages: [] };
      if (method === 'session.activate') return { running: false };
      if (method === 'commands.catalog') return commandFixture(String(params.profile));
      if (method === 'slash.exec') return commandHook ? commandHook() : { output: `Native ${String(params.profile)}` };
      if (method === 'prompt.submit') return {};
      throw new Error(`Unexpected: ${method}`);
    } };
  const reader = { sessions: async () => ({ rows: [], total: 0, limit: 20, offset: 0 }), searchSessions: async () => [],
    sessionMessages: async (ref: { id: string; profile?: string }) => ({ ...ref, messages: [], returned: 0, offset: 0, limit: 100 }) };
  const chat = new ChatController(reader, gateway); chat.setEnabled(true);
  return { chat, calls, hook: (fn: typeof commandHook) => { commandHook = fn; },
    disconnect: () => { state.phase = 'reconnecting'; ++state.generation; states.forEach(cb => cb(state)); } };
}

test('composer sends native reads separately, while literal slash text uses only normal submit fields', async t => {
  const h = fixture(); t.after(() => h.chat.dispose()); await h.chat.create();
  h.chat.setDraft('/usage'); await h.chat.send(); assert.equal(h.chat.draft, '');
  assert.equal(h.chat.native.commands.state.result?.output, 'Native default');
  assert.equal(h.calls.filter(c => c.method === 'prompt.submit').length, 0);
  h.chat.setDraft('//usage'); await h.chat.send();
  assert.deepEqual(h.calls.filter(c => c.method === 'prompt.submit').map(c => c.params), [{ session_id: h.chat.native.state.runtimeId, text: '/usage' }]);
});

test('unknown commands and arguments leave drafts intact and cannot invoke tools or settings', async t => {
  const h = fixture(); t.after(() => h.chat.dispose()); await h.chat.create();
  for (const text of ['/unknown', '/usage reset', '/model other --global', '/undo', '/']) {
    h.chat.setDraft(text); await h.chat.send(); assert.equal(h.chat.draft, text); assert.ok(h.chat.error);
  }
  assert.ok(h.calls.every(c => !['prompt.submit', 'slash.exec', 'command.dispatch', 'config.set'].includes(c.method)));
});

test('late command completion cannot clear another profile draft or populate its result/error', async t => {
  const h = fixture(); t.after(() => h.chat.dispose()); await h.chat.create();
  let finish!: (value: unknown) => void;
  h.hook(() => new Promise(resolve => { finish = resolve; })); h.chat.setDraft('/history'); const pending = h.chat.send();
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  const old = h.chat.native; await h.chat.create('work'); h.chat.setDraft('Work draft');
  finish({ output: 'PRIVATE OLD HISTORY' }); await pending;
  assert.equal(h.chat.native.state.profile, 'work'); assert.equal(h.chat.draft, 'Work draft'); assert.equal(h.chat.error, undefined);
  assert.equal(old.commands.state.result, undefined); assert.equal(h.chat.native.commands.state.result, undefined);
});

test('a pending command blocks settings, YOLO and prompts; no command is replayed after disconnect', async t => {
  const h = fixture(); t.after(() => h.chat.dispose()); await h.chat.create();
  let finish!: (value: unknown) => void;
  h.hook(() => new Promise(resolve => { finish = resolve; })); const pending = assert.rejects(h.chat.native.commands.execute('/usage'));
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(h.chat.reloadBlocker()); await assert.rejects(h.chat.native.submit('blocked'));
  await assert.rejects(h.chat.native.setYolo(true));
  await assert.rejects(h.chat.native.settings.changeReasoning('high'));
  h.disconnect(); finish({ output: 'Old result' }); await pending;
  assert.equal(h.chat.native.commands.state.result, undefined); assert.equal(h.chat.native.commands.state.catalogue, undefined);
  assert.equal(h.calls.filter(c => c.method === 'slash.exec').length, 1);
  assert.equal(h.calls.filter(c => ['prompt.submit', 'config.set'].includes(c.method)).length, 0);
});

test('historical views and account clearing discard command output and discovery', async t => {
  const h = fixture(); t.after(() => h.chat.dispose()); await h.chat.create();
  await h.chat.native.commands.execute('/status'); await h.chat.historyPage(100);
  assert.equal(h.chat.native.commands.state.result, undefined); assert.equal(h.chat.native.commands.state.catalogue, undefined);
  h.chat.setDraft('/usage'); const count = h.calls.length; await h.chat.send(); assert.equal(h.calls.length, count);
  await h.chat.latest(); await h.chat.native.commands.load(); h.chat.clear();
  assert.equal(h.chat.native.commands.state.catalogue, undefined); assert.equal(h.chat.native.commands.state.result, undefined);
});
