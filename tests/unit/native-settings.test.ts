import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeSettings } from '../../src/hermes/native-settings.js';
import { ClientError } from '../../src/hermes/protocol.js';
const choice = { model: 'model-b', provider: 'custom', providerName: 'Lab', reasoning: true };
function fixture() {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const target = { runtimeId: 'live-a', profile: 'work', idle: true, starting: false, agent: { model: 'model-a', provider: 'custom', reasoningEffort: 'medium' } };
  let refreshes = 0;
  const f = { target, calls, confirmation: false, deferred: false, fail: false, hook: undefined as (() => Promise<void>) | undefined,
    refreshHook: undefined as (() => void) | undefined,
    rpc: { call: async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      calls.push({ method, params });
      if (method === 'model.options') return { model: 'model-a', provider: 'custom', providers: [{ slug: 'custom', models: ['model-a', 'model-b'], capabilities: { 'model-a': { reasoning: true, can_disable_reasoning: false } } }] };
      if (method === 'config.set') {
        await f.hook?.();
        if (f.fail) throw new ClientError('timeout', 'unknown');
        if (f.confirmation && !params?.confirm_expensive_model)
          return { key: 'model', value: 'model-b', scope: 'session', confirm_required: true, confirm_message: 'Additional cost' };
        if (params?.key === 'model') target.agent.model = 'model-b';
        if (params?.key === 'reasoning') target.agent.reasoningEffort = String(params.value);
        return { key: params?.key, value: params?.key === 'model' ? 'model-b' : params?.value, deferred: f.deferred };
      }
      throw new Error('unsupported');
    } },
    refresh: async () => { refreshes++; f.refreshHook?.(); },
    refreshes: () => refreshes,
  };
  return { ...f, f, settings: new NativeSettings(f.rpc, { read: () => target, refresh: f.refresh, notify: () => {} }) };
}
test('settings preflight the idle runtime and send explicit per-conversation scope', async () => {
  const h = fixture(); await h.settings.changeModel(choice);
  assert.equal(h.settings.state.outcome, 'applied'); assert.equal(h.f.refreshes(), 2);
  assert.equal(h.calls[1]?.params?.value, 'model-b --provider custom --session');
  assert.equal(h.calls[1]?.params?.profile, 'work');
  await h.settings.changeReasoning('high');
  assert.equal(h.calls.at(-1)?.params?.scope, 'session');
});
test('missing runtime, running agent and a preflight race cannot dispatch settings', async () => {
  for (const scenario of ['missing', 'running', 'race']) {
    const h = fixture();
    if (scenario === 'missing') h.target.runtimeId = '';
    if (scenario === 'running') h.target.idle = false;
    if (scenario === 'race') h.f.refreshHook = () => { h.target.idle = false; };
    await assert.rejects(h.settings.changeReasoning('high'));
    assert.equal(h.calls.filter(c => c.method === 'config.set').length, 0);
  }
});
test('a lost settings acknowledgement is never replayed, including read-only recovery', async () => {
  const h = fixture(); h.f.fail = true;
  await assert.rejects(h.settings.changeModel(choice)); assert.equal(h.settings.state.outcome, 'unknown');
  await assert.rejects(h.settings.changeModel(choice));
  await h.settings.recover(); assert.equal(h.settings.state.outcome, 'idle');
  assert.equal(h.calls.filter(c => c.method === 'config.set').length, 1);
});
test('cost confirmation is separate, deliberate and expires across a runtime reset', async () => {
  const h = fixture(); h.f.confirmation = true;
  await h.settings.changeModel(choice); assert.equal(h.settings.state.confirmation?.message, 'Additional cost');
  assert.equal(h.calls.filter(c => c.method === 'config.set').length, 1);
  await h.settings.confirmModel(); assert.equal(h.calls.at(-1)?.params?.confirm_expensive_model, true);
  assert.equal(h.settings.state.confirmation, undefined);
  await h.settings.changeModel(choice); h.settings.reset(); await assert.rejects(h.settings.confirmModel());
});
test('a late mutation reply from a prior selection cannot alter the new settings state', async () => {
  const h = fixture(); let finish!: () => void;
  h.f.hook = () => new Promise<void>(resolve => { finish = resolve; });
  const changing = h.settings.changeModel(choice); const rejection = assert.rejects(changing);
  for (let i = 0; !finish && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.settings.state.busy, true); await assert.rejects(h.settings.changeReasoning('high'));
  h.settings.reset(); h.target.runtimeId = 'other'; finish(); await rejection;
  assert.deepEqual(h.settings.state, { busy: false, outcome: 'idle' });
});
test('mandatory reasoning cannot be disabled; backend deferred model changes stay labelled queued', async () => {
  const h = fixture(); await assert.rejects(h.settings.changeReasoning('none'));
  assert.equal(h.calls.filter(c => c.method === 'config.set').length, 0);
  h.f.deferred = true; await h.settings.changeModel(choice);
  assert.equal(h.settings.state.outcome, 'deferred');
});

test('malformed mutation acknowledgements require readback rather than being called rejected', async () => {
  const h = fixture();
  const original = h.f.rpc.call;
  h.f.rpc.call = async (method, params) => {
    const result = await original(method, params);
    return method === 'config.set' ? { malformed: true } : result;
  };
  await assert.rejects(h.settings.changeModel(choice));
  assert.equal(h.settings.state.outcome, 'unknown');
  await assert.rejects(h.settings.changeModel(choice));
  assert.equal(h.calls.filter(call => call.method === 'config.set').length, 1);
  await h.settings.recover(); assert.equal(h.settings.state.outcome, 'idle');
});

test('explicit RPC rejection remains rejected and never gets relabelled applied', async () => {
  const h = fixture(); h.f.hook = async () => { throw new ClientError('rpc', 'Rejected', 4002); };
  await assert.rejects(h.settings.changeModel(choice));
  assert.equal(h.settings.state.outcome, 'rejected');
  assert.equal(h.target.agent.model, 'model-a');
});

test('a model changed by another client during the capability check blocks reasoning dispatch', async () => {
  const h = fixture();
  h.f.refreshHook = () => { if (h.f.refreshes() === 2) h.target.agent.model = 'other-model'; };
  await assert.rejects(h.settings.changeReasoning('high'));
  assert.equal(h.calls.filter(call => call.method === 'config.set').length, 0);
});


test('settings wait for lazy native construction using reads before dispatching once', async () => {
  const h = fixture(); h.target.starting = true;
  const changing = h.settings.changeModel(choice);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.settings.state.busy, true);
  assert.equal(h.calls.filter(call => call.method === 'config.set').length, 0);
  h.target.starting = false;
  await changing;
  assert.equal(h.settings.state.outcome, 'applied');
  assert.equal(h.calls.filter(call => call.method === 'config.set').length, 1);
  assert.equal(h.f.refreshes(), 3);
});

test('selection changes while waiting for agent construction cancel without a setter', async () => {
  const h = fixture(); h.target.starting = true;
  const changing = h.settings.changeModel(choice); const rejected = assert.rejects(changing);
  await new Promise(resolve => setTimeout(resolve, 10));
  h.settings.reset(); h.target.runtimeId = 'other';
  await rejected;
  assert.equal(h.calls.filter(call => call.method === 'config.set').length, 0);
  assert.deepEqual(h.settings.state, { busy: false, outcome: 'idle' });
});
