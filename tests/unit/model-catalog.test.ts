import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentMetadata, effortValue, modelCatalogue, modelChangeResult, modelSetParams,
  profileCatalogue, reasoningSetParams, yoloSetParams } from '../../src/hermes/model-catalog.js';
const inventory = { model: 'lab/model-a', provider: 'custom:lab', secret: 'do-not-copy',
  providers: [{ slug: 'custom:lab', name: 'Lab', authenticated: true, base_url: 'private-address',
    models: ['lab/model-a', 'lab/model-a', 'model-b', 'bad --global'],
    capabilities: { 'lab/model-a': { reasoning: true, can_disable_reasoning: false }, 'model-b': { reasoning: false } } }] };
test('model catalogue bounds and projects supported public choice fields only', () => {
  const data = modelCatalogue(inventory);
  assert.equal(data.choices.length, 2); assert.equal(data.choices[0]?.reasoning, true);
  assert.equal(data.choices[0]?.canDisableReasoning, false); assert.equal(data.choices[1]?.reasoning, false);
  assert.ok(!JSON.stringify(data).includes('private-address')); assert.ok(!JSON.stringify(data).includes('do-not-copy'));
  assert.throws(() => modelCatalogue({ providers: Array(129).fill({}) }));
  assert.throws(() => modelCatalogue({ providers: [{}] }));
});
test('profile inventory never retains paths or per-profile session payloads', () => {
  assert.deepEqual(profileCatalogue({ profiles: [{ name: 'work', path: '/private', display_name: 'Work', description: 'Work agent', sessions: ['private'] }] }),
    [{ name: 'work', label: 'Work', description: 'Work agent' }]);
  assert.deepEqual(profileCatalogue({ profiles: [{ name: '../work' }] }), []);
});
test('model setter always has explicit session scope and cannot inject options', () => {
  const choice = modelCatalogue(inventory).choices[0]!;
  assert.deepEqual(modelSetParams('live', 'work', choice), {
    session_id: 'live', profile: 'work', key: 'model', value: 'lab/model-a --provider custom:lab --session', confirm_expensive_model: false,
  });
  for (const model of ['--global', 'a --global', 'a\n--global', 'a;rm', 'a"'])
    assert.throws(() => modelSetParams('live', 'work', { ...choice, model }));
  assert.throws(() => modelSetParams('', 'work', choice));
});
test('reasoning is effort, never a persisted display setting or implicit sessionless write', () => {
  assert.deepEqual(reasoningSetParams('live', 'work', 'high'), {
    session_id: 'live', profile: 'work', key: 'reasoning', value: 'high', scope: 'session',
  });
  for (const value of ['show', 'hide', 'on', 'off', 'full', 'global', '', true]) assert.throws(() => effortValue(value));
  assert.throws(() => reasoningSetParams('', 'work', 'high'));
});
test('YOLO setter is explicit, boolean and session scoped', () => {
  assert.deepEqual(yoloSetParams('live', 'work', true), {
    session_id: 'live', profile: 'work', key: 'yolo', value: '1', scope: 'session',
  });
  assert.deepEqual(yoloSetParams('live', undefined, false), {
    session_id: 'live', key: 'yolo', value: '0', scope: 'session',
  });
  assert.throws(() => yoloSetParams('', 'work', true));
});
test('session info is a small authoritative metadata projection', () => {
  assert.deepEqual(agentMetadata({ model: 'a', provider: 'custom', reasoning_effort: '', yolo: true, cwd: '/private' }),
    { model: 'a', provider: 'custom', reasoningEffort: 'provider-default', yolo: true });
  assert.deepEqual(agentMetadata({ reasoning_effort: 'none', yolo: false }), { reasoningEffort: 'none', yolo: false });
  assert.deepEqual(agentMetadata({ model: 'secret\nvalue', reasoning_effort: 'unknown', yolo: 'yes' }), {});
});
test('model confirmation and deferred outcomes are not reported as applied changes', () => {
  assert.deepEqual(modelChangeResult({ key: 'model', value: 'x', scope: 'session', confirm_required: true }),
    { confirmation: 'Hermes requires confirmation before using this model. It may have additional cost.', deferred: false });
  assert.equal(modelChangeResult({ key: 'model', value: 'x', deferred: true }).deferred, true);
  assert.throws(() => modelChangeResult({ key: 'model', value: 'x', scope: 'global' }));
});
