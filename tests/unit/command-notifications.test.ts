import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeCommands } from '../../src/hermes/native-commands.js';
import { commandFixture } from '../fixtures/commands.js';

function harness() {
  const calls: { method: string }[] = [];
  let hook: (() => Promise<unknown>) | undefined;
  const commands = new NativeCommands({ call: async method => {
    calls.push({ method });
    if (hook) return hook();
    return method === 'commands.catalog' ? commandFixture() : { output: 'Native default counters' };
  } }, { read: () => ({ ready: true, idle: true, runtimeId: 'live-default', profile: 'default' }),
    notify: () => { /* Simulate a shell observer whose next render has not been delivered. */ } });
  return { commands, calls, setHook: (value: typeof hook) => { hook = value; } };
}

test('command subscribers observe loading and settled catalogue without a shell render', async () => {
  const h = harness(); let finish!: (value: unknown) => void;
  const snapshots: ReturnType<typeof h.commands.getSnapshot>[] = [];
  h.commands.subscribe(() => snapshots.push(h.commands.getSnapshot()));
  h.setHook(() => new Promise(resolve => { finish = resolve; }));
  const before = h.commands.getSnapshot(), pending = h.commands.load();
  assert.equal(snapshots.length, 1); assert.equal(snapshots[0]?.loading, true);
  assert.notEqual(snapshots[0], before);
  assert.equal(h.commands.getSnapshot(), h.commands.getSnapshot(), 'snapshot identity is stable until state changes');
  finish(commandFixture()); await pending;
  assert.ok(snapshots.at(-1)?.catalogue?.choices.some(row => row.name === '/usage'));
  assert.equal(snapshots.at(-1)?.loading, false);
  assert.equal(before.catalogue, undefined, 'published snapshots are not mutated');
});

test('command reset notifies direct subscribers and stale completion cannot publish into the new scope', async () => {
  const h = harness(); let finish!: (value: unknown) => void, notifications = 0;
  const unsubscribe = h.commands.subscribe(() => { notifications++; });
  h.setHook(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.commands.load(); h.commands.reset();
  assert.equal(notifications, 2); assert.equal(h.commands.getSnapshot().loading, false);
  finish(commandFixture()); await pending;
  assert.equal(notifications, 2); assert.equal(h.commands.getSnapshot().catalogue, undefined);
  unsubscribe(); h.commands.reset(); assert.equal(notifications, 2);
});

test('read-only result completion and clearing notify direct subscribers without replay', async () => {
  const h = harness(), outputs: (string | undefined)[] = [];
  const unsubscribe = h.commands.subscribe(() => outputs.push(h.commands.getSnapshot().result?.output));
  await h.commands.execute('/usage');
  assert.ok(outputs.includes('Native default counters'));
  h.commands.dismissResult(); assert.equal(outputs.at(-1), undefined);
  const notifications = outputs.length; unsubscribe(); h.commands.reset();
  assert.equal(outputs.length, notifications);
  assert.deepEqual(h.calls.map(call => call.method), ['commands.catalog', 'slash.exec']);
});
