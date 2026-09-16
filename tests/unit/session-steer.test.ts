import { test } from 'node:test';
import assert from 'node:assert/strict';
import { steerSession } from '../../src/hermes/session-steer.js';

test('natural steering uses session.steer exactly once and accepts the pinned queued acknowledgement', async () => {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const text = await steerSession({ call: async (method, params) => {
    calls.push({ method, params }); return { status: 'queued', text: 'Change direction now' };
  } }, 'live-1', '  Change direction now  ');
  assert.equal(text, 'Change direction now');
  assert.deepEqual(calls, [{ method: 'session.steer', params: { session_id: 'live-1', text: 'Change direction now' } }]);
});

test('literal slash escape is preserved as steer text rather than interpreted as a slash command', async () => {
  let sent = '';
  await steerSession({ call: async (_method, params) => {
    sent = String(params?.text); return { status: 'queued', text: sent };
  } }, 'live-1', '//keep-this-literal');
  assert.equal(sent, '/keep-this-literal');
});

test('rejected or malformed steer acknowledgements fail without claiming success', async () => {
  await assert.rejects(steerSession({ call: async () => ({ status: 'rejected', text: 'nope' }) }, 'live-1', 'nope'), /draft was kept/);
  for (const result of [{}, { status: 'queued' }, { status: 'queued', text: 'different' }, { status: 'steered', text: 'x' }])
    await assert.rejects(steerSession({ call: async () => result }, 'live-1', 'x'), /unsupported steer acknowledgement/);
});

test('empty, oversized and unattached steering never call Hermes', async () => {
  let calls = 0;
  const rpc = { call: async () => { calls++; return { status: 'queued', text: 'x' }; } };
  await assert.rejects(steerSession(rpc, '', 'x'));
  await assert.rejects(steerSession(rpc, 'live-1', '   '));
  await assert.rejects(steerSession(rpc, 'live-1', 'x'.repeat(32769)));
  assert.equal(calls, 0);
});
