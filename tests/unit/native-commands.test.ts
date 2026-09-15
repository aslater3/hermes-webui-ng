import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeCommands } from '../../src/hermes/native-commands.js';
import { ClientError } from '../../src/hermes/protocol.js';
import { commandFixture } from '../fixtures/commands.js';

function harness() {
  const target = { ready: true, idle: true, runtimeId: 'live-default', profile: 'default' };
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let hook: ((method: string) => Promise<unknown>) | undefined;
  const commands = new NativeCommands({ call: async (method, params = {}) => {
    calls.push({ method, params });
    if (hook) return hook(method);
    if (method === 'commands.catalog') return commandFixture(target.profile);
    if (method === 'slash.exec') return { output: `Native ${target.profile} counters` };
    throw new Error('Unexpected method');
  } }, { read: () => target, notify: () => {} });
  return { target, commands, calls, setHook: (value: typeof hook) => { hook = value; } };
}

test('catalogue requests include selection hints, cache in memory and refresh deliberately (not proof of server scoping)', async () => {
  const h = harness(); await h.commands.load(); await h.commands.load();
  assert.deepEqual(h.calls, [{ method: 'commands.catalog', params: { session_id: 'live-default', profile: 'default' } }]);
  await h.commands.load(true); assert.equal(h.calls.length, 2);
});

test('native command uses one verified read-only slash.exec with no prompt/config/dispatch fallback', async () => {
  const h = harness(); await h.commands.execute('/usage');
  assert.deepEqual(h.calls.map(call => call.method), ['commands.catalog', 'slash.exec']);
  assert.deepEqual(h.calls[1]?.params, { session_id: 'live-default', profile: 'default', command: '/usage' });
  assert.equal(h.commands.state.result?.output, 'Native default counters'); assert.equal(h.commands.state.busy, false);
});

test('picker/help/context commands return UI intents without invoking remote mutations', async () => {
  for (const [text, kind] of [['/model', 'models'], ['/profile', 'profiles'], ['/reasoning', 'reasoning'], ['/context', 'context'], ['/h find', 'catalogue']]) {
    const h = harness(); await h.commands.execute(text!);
    assert.equal(h.commands.state.action?.kind, kind); assert.equal(h.calls.length, 1);
    h.commands.dismissAction(); assert.equal(h.commands.state.action, undefined);
  }
});

test('unknown names and unsupported read arguments never reach a dispatch or prompt method', async () => {
  for (const text of ['/usage reset', '/status reset', '/unknown']) {
    const h = harness(); await assert.rejects(h.commands.execute(text));
    assert.ok(h.calls.every(call => call.method === 'commands.catalog'));
    assert.equal(h.commands.state.busy, false); assert.equal(h.commands.state.result, undefined);
  }
});

test('one command is admitted at a time, and a run starting during discovery prevents dispatch', async () => {
  const h = harness(); let finish!: (value: unknown) => void;
  h.setHook(() => new Promise(resolve => { finish = resolve; }));
  const first = assert.rejects(h.commands.execute('/usage'));
  await assert.rejects(h.commands.execute('/history'));
  h.target.idle = false; finish(commandFixture()); await first;
  assert.equal(h.calls.length, 1); assert.equal(h.commands.state.result, undefined);
});

test('late catalogue responses cannot populate a different profile after reset', async () => {
  const h = harness(); let finish!: (value: unknown) => void;
  h.setHook(() => new Promise(resolve => { finish = resolve; })); const old = h.commands.load();
  h.commands.reset(); h.target.profile = 'work'; h.target.runtimeId = 'live-work'; h.setHook(undefined);
  await h.commands.load(); finish(commandFixture('default')); await old;
  assert.ok(h.commands.state.catalogue?.choices.some(row => row.name === '/work-skill'));
  assert.ok(!h.commands.state.catalogue?.choices.some(row => row.name === '/default-skill'));
});

test('late native results are discarded on session/profile/connection boundary, with no replay', async () => {
  const h = harness(); let finish!: (value: unknown) => void;
  h.setHook(async method => method === 'commands.catalog' ? commandFixture() : new Promise(resolve => { finish = resolve; }));
  const old = assert.rejects(h.commands.execute('/history'));
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  h.commands.reset(); h.target.runtimeId = 'live-work'; h.target.profile = 'work';
  finish({ output: 'PRIVATE OLD HISTORY' }); await old;
  assert.equal(h.commands.state.result, undefined); assert.ok(!JSON.stringify(h.commands.state).includes('PRIVATE'));
  assert.equal(h.calls.filter(call => call.method === 'slash.exec').length, 1);
});

test('missing catalogue or native method is explicit and never a weaker transport fallback', async () => {
  const h = harness(); h.setHook(async () => { throw new ClientError('rpc', 'PRIVATE upstream error', -32601); });
  await h.commands.load(); assert.equal(h.commands.state.unavailable, true); await h.commands.load(); assert.equal(h.calls.length, 1);
  assert.ok(!JSON.stringify(h.commands.state).includes('PRIVATE'));
  await assert.rejects(h.commands.execute('/usage')); assert.ok(h.calls.every(call => call.method === 'commands.catalog'));
  h.commands.reset(); h.setHook(async method => { if (method === 'commands.catalog') return commandFixture(); throw new ClientError('rpc', 'PRIVATE', -32601); });
  await assert.rejects(h.commands.execute('/usage')); assert.equal(h.commands.state.executionUnavailable, true);
  await assert.rejects(h.commands.execute('/usage')); assert.equal(h.calls.filter(call => call.method === 'slash.exec').length, 1);
});

test('malformed or directive-shaped native results are never interpreted, forwarded or retained', async () => {
  for (const result of [{ type: 'send', message: 'PRIVATE' }, { output: 'PRIVATE', type: 'exec', message: 'ambiguous' }, { output: [], key: 'PRIVATE' }, { output: 'PRIVATE', target: '/shell' }]) {
    const h = harness(); h.setHook(async method => method === 'commands.catalog' ? commandFixture() : result);
    await assert.rejects(h.commands.execute('/usage')); assert.equal(h.commands.state.result, undefined);
    assert.ok(!JSON.stringify(h.commands.state).includes('PRIVATE')); assert.equal(h.calls.length, 2);
  }
});

test('native output is bounded plain text; closing or hiding clears private readouts and cancels late loads', async () => {
  const h = harness(); h.setHook(async method => method === 'commands.catalog' ? commandFixture() : { output: '<script>unsafe()</script>' + 'x'.repeat(50000) });
  await h.commands.execute('/history'); assert.equal(h.commands.state.result?.output.length, 32768); assert.equal(h.commands.state.result?.truncated, true);
  h.commands.dismissResult(); assert.equal(h.commands.state.result, undefined);
  h.commands.setVisible(false); assert.equal(h.commands.state.catalogue, undefined);
  const count = h.calls.length; await h.commands.load(); await assert.rejects(h.commands.execute('/usage')); assert.equal(h.calls.length, count);
  h.commands.setVisible(true); h.setHook(undefined); await h.commands.load(); assert.ok(h.commands.state.catalogue);
});


test('pinned busy-safe reads execute while a turn is running, while reject-policy commands stay blocked', async () => {
  const h = harness(); h.target.idle = false; Object.assign(h.target, { running: true });
  await h.commands.execute('/status');
  assert.equal(h.commands.state.result?.output, 'Native default counters');
  assert.equal(h.calls.filter(call => call.method === 'slash.exec').length, 1);
  h.commands.dismissResult();
  await assert.rejects(h.commands.execute('/usage'), /not available while Hermes is working/);
  assert.equal(h.calls.filter(call => call.method === 'slash.exec').length, 1);
});

test('offline, busy and sessionless views cannot execute native commands', async () => {
  for (const patch of [{ ready: false }, { idle: false }, { runtimeId: '' }]) {
    const h = harness(); Object.assign(h.target, patch); await assert.rejects(h.commands.execute('/usage')); assert.equal(h.calls.length, 0);
  }
});
