import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentActivity, inputRpc } from '../../src/hermes/agent-activity.js';
const event = (type: string, payload: unknown = {}) => ({ type, session_id: 'live', payload });

test('earlier tool/reasoning turns are bounded and exclude request descriptors and submitted answers', () => {
  const activity = new AgentActivity();
  for (let turn = 0; turn < 10; turn++) {
    activity.receive(event('message.start'));
    activity.receive(event('reasoning.delta', { text: 'r'.repeat(12000) }));
    activity.receive(event('secret.request', { request_id: `secret-${turn}`, prompt: 'PRIVATE_REQUEST', env_var: 'TEST_KEY' }));
    for (let tool = 0; tool < 50; tool++) activity.receive(event('tool.complete', { tool_id: `t${tool}`, name: 'read_file', args: { password: 'NEVER_ARCHIVE' }, result: 'x'.repeat(20000) }));
  }
  assert.equal(activity.archive.length, 6);
  assert.ok(activity.archive.every(turn => turn.tools.length <= 10 && turn.reasoning.length <= 8192 && turn.truncated));
  assert.ok(activity.archive.every(turn => turn.tools.every(tool => tool.output.length <= 8192)));
  assert.ok(!JSON.stringify(activity.archive).includes('PRIVATE_REQUEST'));
  assert.ok(!JSON.stringify(activity.archive).includes('NEVER_ARCHIVE'));
  activity.reset(); assert.equal(activity.archive.length, 0);
});
test('identical credential events never resurrect an unknown request after disconnect', () => {
  const activity = new AgentActivity();
  const request = event('sudo.request', { request_id: 'sudo-1' });
  activity.receive(request); activity.disconnect(); activity.receive(request);
  assert.equal(activity.state.inputs[0]?.status, 'unknown');
  assert.throws(() => inputRpc(activity.state.inputs[0]!, { value: 'secret' }, 'live'));
  activity.receive(event('sudo.request', { request_id: 'sudo-2' }));
  assert.equal(activity.state.inputs.at(-1)?.status, 'pending');
});
test('changed operation under an existing request ID is blocked, not silently substituted', () => {
  const activity = new AgentActivity();
  activity.receive(event('approval.request', { request_id: 'same-id', command: 'safe first operation' }));
  activity.receive(event('approval.request', { request_id: 'same-id', command: 'different operation' }));
  assert.equal(activity.state.inputs[0]?.blocked, true); assert.equal(activity.state.malformed, true);
  assert.equal(activity.state.inputs[0]?.command, 'safe first operation');
  assert.throws(() => inputRpc(activity.state.inputs[0]!, { value: 'once' }, 'live'));
});
test('terminal request IDs stay tombstoned after bounded card eviction and a new turn', () => {
  const activity = new AgentActivity();
  for (let n = 0; n < 30; n++) {
    activity.receive(event('approval.request', { request_id: `id${n}`, command: 'fixture only' }));
    activity.status(`approval:id${n}`, 'answered');
  }
  activity.receive(event('message.start'));
  activity.receive(event('approval.request', { request_id: 'id0', command: 'fixture only' }));
  assert.equal(activity.state.inputs.length, 0);
});
test('clarify confirmations cannot be replayed and malformed partial acknowledgements remain unknown', () => {
  const activity = new AgentActivity();
  activity.receive(event('clarify.request', { request_id: 'batch', questions: [{ qid: 'a', question: 'A?' }, { qid: 'b', question: 'B?' }] }));
  activity.status('clarify:batch', 'sending'); activity.result('clarify:batch', { status: 'ok', remaining: ['b'] }, 'a');
  assert.throws(() => inputRpc(activity.state.inputs[0]!, { value: 'again', questionId: 'a' }, 'live'));
  activity.status('clarify:batch', 'sending');
  assert.throws(() => activity.result('clarify:batch', { status: 'ok', remaining: ['b', 'b'] }, 'b'));
  assert.equal(activity.state.inputs[0]?.status, 'unknown');
});
test('native JSON-string tool failures are errors and late progress never erases a terminal result', () => {
  const activity = new AgentActivity();
  activity.receive(event('tool.complete', { tool_id: 'tool', name: 'terminal', result: '{"output":"denied","exit_code":1}' }));
  assert.equal(activity.state.tools[0]?.state, 'error');
  activity.receive(event('tool.progress', { tool_id: 'tool', text: 'old progress' }));
  assert.equal(activity.state.tools[0]?.state, 'error');
  assert.ok(activity.state.tools[0]?.output.includes('denied'));
});
