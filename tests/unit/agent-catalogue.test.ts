import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentCatalogue } from '../../src/hermes/agent-catalogue.js';
import { ClientError } from '../../src/hermes/protocol.js';
const models = { model: 'a', provider: 'custom', providers: [{ slug: 'custom', models: ['a'], capabilities: { a: { reasoning: true } } }] };
test('native inventory reads carry session/profile and never request full config or expanded histories', async () => {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const catalogue = new AgentCatalogue({ call: async (method, params) => {
    calls.push({ method, params }); return method === 'model.options' ? models : method === 'profiles.list' ? { profiles: [{ name: 'work' }] } : { value: 'high' };
  } });
  await catalogue.load({ runtimeId: 'live', profile: 'work' });
  assert.deepEqual(calls[0], { method: 'model.options', params: { session_id: 'live', profile: 'work', refresh: false } });
  assert.deepEqual(calls[1]?.params, { include_sessions: false });
  assert.deepEqual(calls[2]?.params, { session_id: 'live', profile: 'work', key: 'reasoning' });
  assert.equal(catalogue.state.effort, 'high'); assert.equal(catalogue.state.loading, false);
  catalogue.dispose();
});
test('late catalogue results are discarded after selection or account invalidation', async () => {
  let finish!: (value: unknown) => void;
  const catalogue = new AgentCatalogue({ call: method => method === 'model.options' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(method === 'profiles.list' ? { profiles: [] } : { value: 'medium' }) });
  const work = catalogue.load({ profile: 'work' }); catalogue.clear(); finish(models); await work;
  assert.equal(catalogue.state.models, undefined); assert.equal(catalogue.state.effort, undefined);
  catalogue.dispose();
});
test('unsupported model RPC does not turn working profile discovery into success for models', async () => {
  const evidence: Record<string, string> = {};
  const catalogue = new AgentCatalogue({ call: async method => {
    if (method === 'model.options') throw new ClientError('rpc', 'redacted', -32601);
    return method === 'profiles.list' ? { profiles: [{ name: 'default' }] } : { value: 'not-supported' };
  } }, (name, state) => { evidence[name] = state; });
  await catalogue.load(); assert.equal(evidence.models, 'unavailable'); assert.equal(evidence.profiles, 'available');
  assert.equal(catalogue.state.effort, undefined); assert.equal(catalogue.state.profiles.length, 1);
  catalogue.dispose();
});
