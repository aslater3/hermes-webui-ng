import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchCommand, nativeCommandMethod, readOnlyInvocation, verifyCommandProfile } from '../../src/hermes/command-dispatch.js';
import { ClientError } from '../../src/hermes/protocol.js';

function harness(profile = 'default') {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const owner = { runtimeId: 'live-1', profile }; let alive = true, issued = 0;
  const rpc = { call: async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ method, params });
    if (method === 'config.get') return { home: '/native-home' };
    if (method === 'profiles.list') return { profiles: [{ name: 'default', path: '/native-home' }, { name: 'work', path: '/work' }] };
    if (method === 'session.activate') return { running: false, info: { profile_name: profile } };
    return { type: 'exec', output: 'Native result' };
  } };
  const current = () => { if (!alive) throw new ClientError('disconnected', 'Owner changed'); };
  return { calls, owner, rpc, current, issued: () => issued++, count: () => issued, invalidate: () => { alive = false; } };
}
test('read commands bypass the worker-profile gate but never accept a generated prompt', async () => {
  const h = harness('work'); await dispatchCommand(h.rpc, { name: '/usage', argument: '', category: 'Session' }, h.owner, h.current, h.issued);
  assert.deepEqual(h.calls, [{ method: 'slash.exec', params: { session_id: 'live-1', command: '/usage' } }]);
  h.rpc.call = async () => ({ type: 'send', message: 'NOT A READ' });
  await assert.rejects(dispatchCommand(h.rpc, { name: '/usage', argument: '', category: 'Session' }, h.owner, h.current, h.issued));
});
test('generic commands forward exact arguments using the native worker, after owner preflight', async () => {
  const h = harness(); await dispatchCommand(h.rpc, { name: '/cron', argument: 'list --all', category: 'Tools & Skills' }, h.owner, h.current, h.issued);
  assert.equal(h.count(), 1); assert.deepEqual(h.calls.map(call => call.method), ['config.get', 'profiles.list', 'session.activate', 'slash.exec']);
  assert.equal(h.calls.at(-1)?.params.command, '/cron list --all');
});
test('skills, plugins and quick commands use dispatch with name and arg, not guessed command parameters', async () => {
  for (const category of ['Skills', 'Plugin commands', 'User commands']) {
    const h = harness(); await dispatchCommand(h.rpc, { name: '/local-task', argument: 'work on this', category }, h.owner, h.current, h.issued);
    assert.deepEqual(h.calls.at(-1), { method: 'command.dispatch', params: { session_id: 'live-1', name: 'local-task', arg: 'work on this' } });
  }
});
test('mutating forms and overridden read names never inherit read-only admission', () => {
  assert.equal(readOnlyInvocation({ name: '/usage', argument: 'reset', category: 'Info' }), false);
  assert.equal(readOnlyInvocation({ name: '/usage', argument: '', category: 'User commands' }), false);
  assert.equal(nativeCommandMethod({ name: '/plan', argument: '', category: 'Session' }), 'command.dispatch');
});
test('wrong-profile commands fail closed, before mutation, with no host path in the error', async () => {
  const h = harness('work');
  await assert.rejects(dispatchCommand(h.rpc, { name: '/local-task', argument: '', category: 'Skills' }, h.owner, h.current, h.issued),
    e => e instanceof Error && e.message.includes('selected profile') && !e.message.includes('/native-home'));
  assert.equal(h.count(), 0); assert.ok(h.calls.every(call => !['slash.exec', 'command.dispatch'].includes(call.method)));
});
test('profile resolution never guesses default, accepts duplicate paths or requires state-file access', async () => {
  for (const raw of [{}, { profiles: [] }, { profiles: [{ name: 'default', path: '/native-home' }, { name: 'work', path: '/native-home' }] }]) {
    const h = harness(); h.rpc.call = async method => method === 'config.get' ? { home: '/native-home' } : raw;
    await assert.rejects(verifyCommandProfile(h.rpc, h.owner, h.current));
  }
});
test('a changed selection during preflight cannot reach execution', async () => {
  const h = harness(), call = h.rpc.call;
  h.rpc.call = async (method, params) => { const out = await call(method, params); if (method === 'session.activate') h.invalidate(); return out; };
  await assert.rejects(dispatchCommand(h.rpc, { name: '/cron', argument: 'list', category: 'Session' }, h.owner, h.current, h.issued));
  assert.equal(h.count(), 0);
});
test('transport or native failure never causes a second executor or prompt fallback', async () => {
  const h = harness(), call = h.rpc.call;
  h.rpc.call = async (method, params) => { if (method === 'slash.exec') { h.calls.push({ method, params: params ?? {} }); throw new ClientError('rpc', 'failure', 4018); } return call(method, params); };
  await assert.rejects(dispatchCommand(h.rpc, { name: '/cron', argument: 'list', category: 'Session' }, h.owner, h.current, h.issued));
  assert.equal(h.count(), 1); assert.equal(h.calls.filter(call => call.method === 'slash.exec').length, 1);
  assert.equal(h.calls.some(call => ['command.dispatch', 'prompt.submit', 'shell.exec'].includes(call.method)), false);
});


test('fresh lazy runtimes wait for authoritative profile metadata before one native dispatch', async () => {
  const h = harness(), call = h.rpc.call; let snapshots = 0;
  h.rpc.call = async (method, params) => {
    if (method === 'session.activate' && snapshots++ < 2) {
      h.calls.push({ method, params: params ?? {} }); return { running: false, status: 'starting', info: { lazy: true } };
    }
    return call(method, params);
  };
  await dispatchCommand(h.rpc, { name: '/plan', argument: 'a task', category: 'Session' }, h.owner, h.current, h.issued);
  assert.equal(h.count(), 1); assert.equal(h.calls.filter(call => call.method === 'session.activate').length, 3);
  assert.equal(h.calls.at(-1)?.method, 'command.dispatch');
});

test('lazy readiness never guesses an absent profile on a settled snapshot or accepts a different profile', async () => {
  for (const info of [{}, { profile_name: 'work', lazy: true }]) {
    const h = harness(), call = h.rpc.call;
    h.rpc.call = async (method, params) => method === 'session.activate' ? { running: false, info } : call(method, params);
    await assert.rejects(dispatchCommand(h.rpc, { name: '/plan', argument: 'task', category: 'Session' }, h.owner, h.current, h.issued));
    assert.equal(h.count(), 0);
  }
});

test('selection change during a lazy-start wait cancels before any native effect', async () => {
  const h = harness(), call = h.rpc.call;
  h.rpc.call = async (method, params) => {
    if (method === 'session.activate') {
      setTimeout(h.invalidate, 1); return { running: false, info: { lazy: true } };
    }
    return call(method, params);
  };
  await assert.rejects(dispatchCommand(h.rpc, { name: '/plan', argument: 'task', category: 'Session' }, h.owner, h.current, h.issued));
  assert.equal(h.count(), 0);
});
