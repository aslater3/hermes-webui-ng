import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeCommandRoute, COMPRESS_TIMEOUT_MS } from '../../src/hermes/command-native-routes.js';
import { dispatchCommand } from '../../src/hermes/command-dispatch.js';
import { recoveredAlias } from '../../src/hermes/native-commands.js';
import { CommandTasks } from '../../src/hermes/command-tasks.js';

const owner = { runtimeId: 'live-a', profile: 'work' };
const route = (name: string, argument = '', category = 'Session') => nativeCommandRoute({ name, argument, category });
async function run(name: string, argument: string, results: Record<string, unknown>) {
  const calls: { method: string; params: Record<string, unknown>; timeout?: number }[] = [];
  let issued = 0;
  const result = await route(name, argument)!.run({ call: async (method, params = {}, timeout) => {
    calls.push({ method, params, timeout });
    if (!(method in results)) throw new Error(`Unexpected RPC ${method}`);
    return results[method];
  } }, owner, () => {}, () => { issued++; });
  return { result, calls, issued };
}

test('compression uses the live session RPC and long native timeout with exact arguments', async () => {
  const h = await run('/compress', 'here 3 --preview', { 'session.compress': { status: 'compressed', removed: 0, summary: { headline: 'Preview', token_line: '0 removed', note: null } } });
  assert.deepEqual(h.calls, [{ method: 'session.compress', params: { session_id: 'live-a', profile: 'work', focus_topic: 'here 3 --preview' }, timeout: COMPRESS_TIMEOUT_MS }]);
  assert.equal(h.issued, 1); assert.deepEqual(h.result, { kind: 'output', output: 'Preview\n0 removed', truncated: false, pending: false });
});

test('compression pending, aborted and lock-held outcomes never claim completed compression', async () => {
  const pending = await run('/compress', '', { 'session.compress': { status: 'pending', message: 'Still running' } });
  assert.equal(pending.result.kind === 'output' && pending.result.pending, true);
  const aborted = await run('/compress', '', { 'session.compress': { status: 'aborted', summary: { headline: 'Aborted: would grow' } } });
  assert.equal(aborted.result.kind === 'output' && aborted.result.output, 'Aborted: would grow');
  const held = await run('/compress', '', { 'session.compress': { lock_held: true, message: 'Not started' } });
  assert.equal(held.result.kind === 'output' && held.result.output, 'Not started');
  for (const raw of [{}, { status: 'compressed' }, { status: 'failed', output: 'ok' }])
    await assert.rejects(run('/compress', '', { 'session.compress': raw }));
});

test('stop interrupts the selected session before explicitly global process cleanup, once only', async () => {
  const h = await run('/stop', '', { 'session.interrupt': { status: 'interrupted' }, 'process.stop': { killed: 2 } });
  assert.deepEqual(h.calls.map(call => [call.method, call.params]), [['session.interrupt', { session_id: 'live-a' }], ['process.stop', {}]]);
  assert.match(h.result.kind === 'output' ? h.result.output : '', /across the Hermes process registry/);
  const legacy = await run('/stop', '', { 'session.interrupt': { interrupted: true }, 'process.stop': { killed: 1 } });
  assert.match(legacy.result.kind === 'output' ? legacy.result.output : '', /Interrupt requested/);
  const legacyIdle = await run('/stop', '', { 'session.interrupt': { interrupted: false }, 'process.stop': { killed: 0 } });
  assert.match(legacyIdle.result.kind === 'output' ? legacyIdle.result.output : '', /No active turn was interrupted/);
  let calls = 0;
  await assert.rejects(route('/stop')!.run({ call: async () => { calls++; throw new Error('network'); } }, owner, () => {}, () => {}));
  assert.equal(calls, 1, 'no cleanup or executor fallback after uncertain interruption');
  assert.throws(() => route('/stop', '--all'));
});

test('scoped direct commands bypass the unsafe generic profile fallback but still verify live ownership', async () => {
  const calls: string[] = [];
  const result = await dispatchCommand({ call: async method => {
    calls.push(method);
    if (method === 'session.activate') return { running: false, info: { profile_name: 'work' } };
    if (method === 'session.title') return { title: 'Real title', pending: false };
    throw new Error('Should not inspect the launch profile or invoke a slash worker');
  } }, { name: '/title', argument: 'Real title', category: 'Session' }, owner, () => {}, () => {});
  assert.deepEqual(calls, ['session.activate', 'session.title']);
  assert.match(result.kind === 'output' ? result.output : '', /updated: Real title/);
  assert.equal(route('/title', '', 'User commands'), undefined, 'custom commands retain native ownership');
});

test('title acknowledgement is validated; lazy pending title is described without claiming persistence', async () => {
  const h = await run('/title', 'Next turn', { 'session.title': { title: 'Next turn', pending: true } });
  assert.match(h.result.kind === 'output' ? h.result.output : '', /queued for the first persisted turn/);
  await assert.rejects(run('/title', 'Wanted', { 'session.title': { title: 'Other' } }));
  assert.throws(() => route('/title', 'x'.repeat(513)));
});

test('tools route changes the actual profile tool configuration, not detached worker tool state', async () => {
  const h = await run('/tools', 'disable browser terminal', { 'tools.configure': { changed: ['browser', 'terminal'], unknown: [], reset: true, api_key: 'PRIVATE' } });
  assert.deepEqual(h.calls[0]?.params, { session_id: 'live-a', profile: 'work', action: 'disable', names: ['browser', 'terminal'] });
  assert.ok(!JSON.stringify(h.result).includes('PRIVATE'));
  assert.throws(() => route('/tools', 'disable')); assert.throws(() => route('/tools', 'list ignored'));
});

test('native background and side questions return task IDs, not false completed text', async () => {
  for (const [command, method, event] of [['/bg', 'prompt.background', 'background.complete'], ['/btw', 'prompt.btw', 'btw.complete']]) {
    const h = await run(command!, 'question', { [method!]: { task_id: 'task_1' } });
    assert.deepEqual(h.result, { kind: 'task', id: 'task_1', event }); assert.throws(() => route(command!));
  }
});

test('side-task results correlate event type/id and preserve event-before-ack without duplicate completion', () => {
  let changes = 0; const tasks = new CommandTasks(() => { changes++; });
  tasks.prepare('/btw', 'Session');
  tasks.receive({ type: 'background.complete', payload: { task_id: 'one', text: 'wrong type' } });
  tasks.receive({ type: 'btw.complete', payload: { task_id: 'one', text: 'Early answer' } });
  tasks.finish({ kind: 'task', id: 'one', event: 'btw.complete' });
  assert.equal(tasks.state[0]?.output, 'Early answer'); assert.equal(tasks.state[0]?.status, 'complete');
  const before = changes;
  tasks.receive({ type: 'btw.complete', payload: { task_id: 'one', text: 'Duplicate' } });
  assert.equal(changes, before); assert.equal(tasks.state[0]?.output, 'Early answer');
  tasks.clear(); tasks.receive({ type: 'btw.complete', payload: { task_id: 'one', text: 'Old owner' } });
  assert.equal(tasks.state.length, 0);
});

test('task result storage is bounded and running tasks are not dismissed as if stopped', () => {
  const tasks = new CommandTasks(() => {});
  for (let i = 0; i < 8; i++) { tasks.prepare('/bg', 'Session'); tasks.finish({ kind: 'task', id: `task_${i}`, event: 'background.complete' }); }
  tasks.dismiss('task_0'); assert.equal(tasks.state.length, 8); assert.throws(() => tasks.prepare('/bg', 'Session'));
  tasks.receive({ type: 'background.complete', payload: { task_id: 'task_0', text: 'x'.repeat(40000) } });
  assert.equal(tasks.state[0]?.output.length, 32768); assert.equal(tasks.state[0]?.truncated, true);
  tasks.dismiss('task_0'); assert.equal(tasks.state.length, 7);
});

test('native aliases retain the original argument tail and always remain slash commands', () => {
  assert.equal(recoveredAlias('plan', 'exact task'), '/plan exact task');
  assert.equal(recoveredAlias('/plan own-arg', 'tail'), '/plan own-arg tail');
  for (const target of ['//not-a-command', 'plan\n/unsafe', 'x'.repeat(33000), '/bad;name']) assert.throws(() => recoveredAlias(target, ''));
});
