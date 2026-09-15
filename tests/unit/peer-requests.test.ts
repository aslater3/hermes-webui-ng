import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PeerRequests } from '../../src/hermes/peer-requests.js';
import { parseFrames } from '../../src/hermes/protocol.js';
const frame = (method = 'approval', id = 'srq-1', session_id = 'live-a', params: Record<string, unknown> = {}) => ({ id, method, params: { session_id, choices: ['once', 'session', 'always', 'deny'], ...params } });
function harness() {
  const sent: Record<string, unknown>[] = [];
  const store = new PeerRequests(value => sent.push(JSON.parse(JSON.stringify(value))));
  return { store, sent };
}
test('native peer frames cannot be mistaken for client replies with the same id', () => {
  assert.equal(parseFrames(JSON.stringify({ jsonrpc: '2.0', ...frame() }))[0]?.kind, 'request');
  assert.equal(parseFrames(JSON.stringify({ jsonrpc: '2.0', id: 'srq-1', result: {} }))[0]?.kind, 'reply');
  for (const raw of [{ ...frame(), result: {} }, { method: 'approval' }, { id: 'a', method: 12 }])
    assert.throws(() => parseFrames(JSON.stringify({ jsonrpc: '2.0', ...raw })));
});
test('approval only permits advertised choices and responds exactly once with the server id', () => {
  const { store, sent } = harness(); store.receive(frame('approval', 'srq-1', 'live-a', { allow_permanent: false, private_key: 'PRIVATE' }));
  const request = store.getSnapshot()[0]!;
  assert.ok(!JSON.stringify(request).includes('PRIVATE')); assert.ok(!request.choices.includes('always'));
  assert.throws(() => store.respond(request, { choice: 'always' })); assert.equal(sent.length, 0);
  store.respond(request, { choice: 'session' });
  assert.deepEqual(sent, [{ jsonrpc: '2.0', id: 'srq-1', result: { choice: 'session' } }]);
  assert.throws(() => store.respond(request, { choice: 'once' }));
  store.receive(frame()); assert.equal(store.getSnapshot().length, 0);
});
test('cancellation is owner and method scoped; stale snapshots cannot revive a cancelled question', () => {
  const { store } = harness(); store.receive(frame());
  store.cancel({ type: 'request.cancel', session_id: 'other', payload: { id: 'srq-1', method: 'approval' } });
  assert.equal(store.getSnapshot().length, 1);
  store.cancel({ type: 'request.cancel', session_id: 'live-a', payload: { id: 'srq-1', method: 'approval' } });
  store.hydrate([frame()], 'live-a'); assert.equal(store.getSnapshot().length, 0);
  store.clear(); store.hydrate([frame()], 'live-a'); assert.equal(store.getSnapshot().length, 1);
});
test('unknown methods and malformed known questions fail fast without storing payloads or executing them', () => {
  const { store, sent } = harness(); store.receive(frame('preview.act', 'srq-x', 'live-a', { action: 'execute', code: 'PRIVATE()' }));
  store.receive(frame('secret', 'srq-s', 'live-a', { prompt: {}, env_var: 'KEY' }));
  assert.deepEqual(sent.map(row => (row.error as Record<string, unknown>).code), [-32601, -32602]);
  assert.equal(store.getSnapshot().length, 0); assert.ok(!JSON.stringify(sent).includes('PRIVATE'));
});
test('batch answers retain native locks; decline cancels without inventing answers', () => {
  const { store, sent } = harness();
  store.receive(frame('clarify', 'srq-batch', 'live-a', { questions: [
    { qid: 'one', question: 'First' }, { qid: 'two', question: 'Second', multi_select: true, choices: ['A', 'B'] },
  ], answers: { one: 'Locked answer' } }));
  store.respond(store.getSnapshot()[0]!, { answers: { one: 'Changed', two: 'A\nB' } });
  assert.deepEqual(sent[0]?.result, { answers: { one: 'Locked answer', two: 'A\nB' } });
  store.receive(frame('clarify', 'srq-next', 'live-a', { questions: [{ qid: 'one', question: 'Question' }] }));
  store.respond(store.getSnapshot()[0]!, {}, true); assert.deepEqual(sent[1]?.result, {});
});
test('secret values are sent without retained answers; visibility clears values and requires native rehydration', () => {
  const { store, sent } = harness(); store.receive(frame('sudo'));
  const old = store.getSnapshot()[0]!; store.setVisible(false);
  assert.throws(() => store.respond(old, { value: 'PRIVATE' })); store.receive(frame('sudo')); assert.equal(store.getSnapshot().length, 0);
  store.setVisible(true); store.hydrate([frame('sudo')], 'other'); assert.equal(store.getSnapshot().length, 0);
  store.hydrate([frame('sudo')], 'live-a'); store.respond(store.getSnapshot()[0]!, { value: 'PRIVATE' });
  assert.equal(sent.length, 1); assert.equal((sent[0]?.result as Record<string, unknown>).value, 'PRIVATE');
  assert.equal(store.getSnapshot().length, 0);
});
test('uncertain socket send retires the question and never enables automatic replay', () => {
  let attempts = 0; const store = new PeerRequests(() => { attempts++; throw new Error('socket failure'); }); store.receive(frame());
  const question = store.getSnapshot()[0]!;
  assert.throws(() => store.respond(question, { choice: 'once' }));
  assert.throws(() => store.respond(question, { choice: 'once' })); assert.equal(attempts, 1);
});
