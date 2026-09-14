import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeCommands } from '../../src/hermes/native-commands.js';
import { ClientError } from '../../src/hermes/protocol.js';
import { commandFixture } from '../fixtures/commands.js';

function harness() {
  const target = { ready: true, idle: true, runtimeId: 'live-1', profile: 'default' };
  const calls: { method: string; params: Record<string, unknown> }[] = [], prompts: string[] = [];
  let result: unknown = { type: 'exec', output: 'Done by Hermes' }, refreshes = 0;
  let effect: (() => Promise<unknown>) | undefined;
  const rpc = { call: async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ method, params });
    if (method === 'commands.catalog') return commandFixture();
    if (method === 'config.get') return { home: '/home-private' };
    if (method === 'profiles.list') return { profiles: [{ name: 'default', path: '/home-private' }] };
    if (method === 'session.activate') return { running: false, info: { profile_name: target.profile } };
    if (['slash.exec', 'command.dispatch'].includes(method)) return effect ? effect() : result;
    throw new Error('Unexpected method');
  } };
  const commands = new NativeCommands(rpc, { read: () => target, notify() {},
    refresh: async () => { refreshes++; }, submitGenerated: async message => { prompts.push(message); } });
  return { commands, calls, prompts, target, rpc, setResult: (value: unknown) => { result = value; },
    setEffect: (value: typeof effect) => { effect = value; }, refreshes: () => refreshes,
    effects: () => calls.filter(call => ['slash.exec', 'command.dispatch', 'prompt.submit'].includes(call.method)) };
}

test('preparing, cancelling or expiring an advanced command never executes it', async () => {
  const h = harness(); await h.commands.execute('/undo 2');
  assert.equal(h.commands.state.confirmation?.text, '/undo 2'); assert.equal(h.commands.blocked, true);
  assert.equal(h.effects().length, 0); await assert.rejects(h.commands.execute('/usage'));
  h.commands.cancelConfirmation(); assert.equal(h.commands.blocked, false); await assert.rejects(h.commands.confirm());
  await h.commands.execute('/undo 2'); const now = Date.now; Date.now = () => now() + 120001;
  try { await assert.rejects(h.commands.confirm()); } finally { Date.now = now; }
  assert.equal(h.effects().length, 0); assert.equal(h.commands.blocked, false);
});

test('confirmed native commands retain exact arguments, use the right method, and refresh authoritative state', async () => {
  const h = harness(); await h.commands.execute('/compress here 3'); await h.commands.confirm();
  assert.deepEqual(h.effects(), [{ method: 'command.dispatch', params: { session_id: 'live-1', name: 'compress', arg: 'here 3' } }]);
  assert.equal(h.commands.state.result?.output, 'Done by Hermes'); assert.equal(h.commands.state.result?.native, true);
  assert.equal(h.refreshes(), 1); await assert.rejects(h.commands.confirm()); assert.equal(h.effects().length, 1);
});

test('skill and send outcomes hand the exact native scaffold to the agent once, never the original slash text', async () => {
  for (const type of ['skill', 'send']) {
    const h = harness(); h.setResult({ type, message: 'Native generated prompt\nwith exact instructions', display: '/default-skill task' });
    await h.commands.execute('/default-skill task'); assert.equal(h.prompts.length, 0);
    await h.commands.confirm(); assert.deepEqual(h.prompts, ['Native generated prompt\nwith exact instructions']);
    assert.equal(h.effects()[0]?.method, 'command.dispatch'); assert.equal(h.commands.state.result, undefined);
  }
});

test('undo prefill and quick-command aliases are recovered input, not unreviewed execution or draft mutation', async () => {
  for (const [raw, kind, text] of [[{ type: 'prefill', message: '/literal previous text', notice: 'Undone' }, 'prefill', '/literal previous text'],
    [{ type: 'alias', target: '/unsafe secret-task' }, 'alias', '/unsafe secret-task']] as const) {
    const h = harness(); h.setResult(raw); await h.commands.execute('/unsafe'); await h.commands.confirm();
    assert.equal(h.commands.state.recovered?.kind, kind); assert.equal(h.commands.state.recovered?.text, text);
    assert.equal(h.prompts.length, 0); assert.equal(h.effects().length, 1);
    h.commands.dismissResult(); assert.equal(h.commands.state.recovered, undefined);
  }
});

test('double confirmation cannot duplicate execution, including while preflight is in flight', async () => {
  const h = harness(); let finish!: (value: unknown) => void; h.setEffect(() => new Promise(resolve => { finish = resolve; }));
  await h.commands.execute('/undo'); const first = h.commands.confirm(); await assert.rejects(h.commands.confirm());
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0)); finish({ type: 'prefill', message: 'Edit' }); await first;
  assert.equal(h.effects().length, 1);
});

test('native failures become an uncertain outcome and never trigger fallback, resubmission or retry', async () => {
  const h = harness(); h.setEffect(async () => { throw new ClientError('rpc', 'PRIVATE upstream details', 4018); });
  await h.commands.execute('/unsafe'); await assert.rejects(h.commands.confirm());
  assert.equal(h.commands.state.uncertain, true); assert.equal(h.commands.blocked, true);
  await assert.rejects(h.commands.execute('/unsafe')); assert.equal(h.effects().length, 1); assert.equal(h.prompts.length, 0);
  assert.ok(!JSON.stringify(h.commands.state).includes('PRIVATE'));
  await h.commands.acknowledgeUncertain(); assert.equal(h.commands.blocked, false); assert.equal(h.refreshes(), 1);
});

test('pending native operations remain unsettled instead of falsely reporting completion', async () => {
  const h = harness(); h.setResult({ type: 'exec', status: 'pending', output: 'Still compressing' });
  await h.commands.execute('/compress'); await h.commands.confirm();
  assert.equal(h.commands.state.result?.pending, true); assert.equal(h.commands.state.uncertain, true); assert.equal(h.commands.blocked, true);
});

test('profile mismatch fails before execution and does not claim an uncertain native effect', async () => {
  const h = harness(); h.target.profile = 'work'; await h.commands.execute('/undo');
  await assert.rejects(h.commands.confirm()); assert.equal(h.effects().length, 0); assert.equal(!!h.commands.state.uncertain, false);
  assert.ok(!JSON.stringify(h.commands.state).includes('/home-private'));
});

test('late generated prompts from an old selection are discarded, never submitted into the new owner', async () => {
  const h = harness(); let finish!: (value: unknown) => void;
  h.setEffect(() => new Promise(resolve => { finish = resolve; })); await h.commands.execute('/default-skill task');
  const old = assert.rejects(h.commands.confirm()); while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  h.commands.reset(); h.target.runtimeId = 'other'; h.target.profile = 'work';
  finish({ type: 'send', message: 'PRIVATE old prompt' }); await old;
  assert.equal(h.prompts.length, 0); assert.ok(!JSON.stringify(h.commands.state).includes('PRIVATE'));
});

test('backgrounding an issued command remembers uncertainty but discards its private pending result', async () => {
  const h = harness(); let finish!: (value: unknown) => void;
  h.setEffect(() => new Promise(resolve => { finish = resolve; })); await h.commands.execute('/unsafe');
  const old = assert.rejects(h.commands.confirm()); while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  h.commands.setVisible(false); finish({ output: 'PRIVATE output' }); await old; h.commands.setVisible(true);
  assert.equal(h.commands.state.uncertain, true); assert.equal(h.commands.blocked, true);
  assert.ok(!JSON.stringify(h.commands.state).includes('PRIVATE')); assert.equal(h.effects().length, 1);
});

test('backgrounding an unconfirmed command cancels it without inventing an uncertain outcome', async () => {
  const h = harness(); await h.commands.execute('/undo'); h.commands.setVisible(false); h.commands.setVisible(true);
  await assert.rejects(h.commands.confirm()); assert.equal(h.effects().length, 0); assert.equal(h.commands.blocked, false);
});

test('malformed post-effect results fail closed and leave the operation uncertain', async () => {
  const h = harness(); h.setResult({ type: 'shell', code: 'PRIVATE()' }); await h.commands.execute('/unsafe');
  await assert.rejects(h.commands.confirm()); assert.equal(h.commands.state.uncertain, true); assert.equal(h.prompts.length, 0);
  assert.ok(!JSON.stringify(h.commands.state).includes('PRIVATE'));
});
