import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeSession } from '../../src/hermes/native-session.js';
import { NativeCommands } from '../../src/hermes/native-commands.js';
import { automationNoticeText, goalLine, goalSummary, NOTICE_LIMIT } from '../../src/hermes/session-automation.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';
import type { GatewayEvent } from '../../src/hermes/protocol.js';
import { commandFixture } from '../fixtures/commands.js';

const goalControl = (goal: Record<string, unknown> | null) => ({ control: { goal, loop: null, heartbeat: null, revision: 'r' } });

class Rpc {
  state: ConnectionState = { phase: 'ready', generation: 1, attempt: 0 };
  events = new Set<(event: GatewayEvent) => void>();
  calls: string[] = [];
  control: unknown = goalControl(null);
  call = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    this.calls.push(method);
    if (method === 'session.resume') return { session_id: 'live-1', session_key: params.session_id };
    if (method === 'session.history') return { messages: [] };
    if (method === 'session.activate') return { running: false, status: 'idle' };
    if (method === 'session.control.read') {
      if (this.control instanceof Error) throw this.control;
      return this.control;
    }
    throw new Error(`unsupported test method ${method}`);
  };
  onEvent(fn: (event: GatewayEvent) => void) { this.events.add(fn); return () => { this.events.delete(fn); }; }
  onState(fn: (state: ConnectionState) => void) { fn(this.state); return () => {}; }
  emit(type: string, payload: unknown, session_id = 'live-1') { this.events.forEach(fn => fn({ type, session_id, payload })); }
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test('status.update goal/loop lines parse; other kinds and empty text do not', () => {
  assert.deepEqual(automationNoticeText({ type: 'status.update', payload: { kind: 'goal', text: ' ⏸ Goal waiting ' } }), { kind: 'goal', text: '⏸ Goal waiting' });
  assert.deepEqual(automationNoticeText({ type: 'status.update', payload: { kind: 'loop', text: 'tick' } }), { kind: 'loop', text: 'tick' });
  assert.equal(automationNoticeText({ type: 'status.update', payload: { kind: 'compressing', text: 'x' } }), undefined);
  assert.equal(automationNoticeText({ type: 'status.update', payload: { kind: 'goal', text: '' } }), undefined);
  assert.equal(automationNoticeText({ type: 'message.delta', payload: { kind: 'goal', text: 'x' } }), undefined);
});

test('control snapshots map to a goal summary; null goal clears; malformed is ignored', () => {
  const goal = goalSummary(goalControl({ title: 'ship it', status: 'paused', turns_used: 2, max_turns: 20, awaiting_input: true,
    paused_reason: 'awaiting user input: pick a policy' }).control);
  assert.equal(goal?.awaitingInput, true);
  assert.equal(goalLine(goal!), 'Goal waiting for your reply · 2/20 turns');
  assert.equal(goalSummary(goalControl(null).control), null);
  assert.equal(goalSummary('nope'), undefined);
  // awaiting_input only means something while paused
  assert.equal(goalSummary(goalControl({ title: 'g', status: 'active', awaiting_input: true }).control)?.awaitingInput, false);
  assert.equal(goalLine(goalSummary(goalControl({ title: 'g', status: 'active', turns_used: 1, max_turns: 20, wait_barrier: { type: 'pid', reason: 'CI' } }).control)!),
    'Goal parked — CI · 1/20 turns');
});

test('a resumed session seeds the goal strip, then follows control updates and verdict lines', async () => {
  const rpc = new Rpc();
  rpc.control = goalControl({ title: 'finish the implementation', status: 'active', turns_used: 1, max_turns: 20 });
  const session = new NativeSession(rpc);
  await session.resume('durable');
  await tick();
  assert.equal(session.state.goal?.status, 'active');
  assert.ok(rpc.calls.includes('session.control.read'));

  rpc.emit('status.update', { kind: 'goal', text: '⏸ Goal waiting for your input: power-cycle the device' });
  rpc.emit('session.control.update', goalControl({ title: 'finish the implementation', status: 'paused', awaiting_input: true, turns_used: 2, max_turns: 20 }));
  assert.equal(session.state.notices?.length, 1);
  assert.equal(session.state.notices?.[0]?.kind, 'goal');
  assert.equal(session.state.goal?.awaitingInput, true);

  // Another session's events never land here.
  rpc.emit('status.update', { kind: 'goal', text: 'other' }, 'live-2');
  assert.equal(session.state.notices?.length, 1);

  session.dismissNotice(session.state.notices![0]!.id);
  assert.deepEqual(session.state.notices, []);

  for (let i = 0; i < NOTICE_LIMIT + 3; i++) rpc.emit('status.update', { kind: 'loop', text: `tick ${i}` });
  const notices = (): { text: string }[] => session.state.notices ?? [];
  assert.equal(notices().length, NOTICE_LIMIT);
  assert.equal(notices().at(-1)?.text, `tick ${NOTICE_LIMIT + 2}`);

  rpc.emit('session.control.update', goalControl(null));
  assert.equal(session.state.goal, undefined);
});

test('older Hermes without session.control.read leaves the strip hidden and the session healthy', async () => {
  const rpc = new Rpc();
  rpc.control = new Error('method not found');
  const session = new NativeSession(rpc);
  await session.resume('durable');
  await tick();
  assert.equal(session.state.goal, undefined);
  assert.equal(session.state.phase, 'idle');
});

test('switching conversations clears the previous session\'s notices and goal', async () => {
  const rpc = new Rpc();
  rpc.control = goalControl({ title: 'g', status: 'active', turns_used: 0, max_turns: 20 });
  const session = new NativeSession(rpc);
  await session.resume('durable');
  await tick();
  rpc.emit('status.update', { kind: 'goal', text: '↻ Continuing' });
  rpc.control = goalControl(null);
  await session.resume('other');
  await tick();
  assert.deepEqual(session.state.notices, []);
  assert.equal(session.state.goal, undefined);
});

test('a send-type command (e.g. /goal) surfaces its notice before handing off the kickoff prompt', async () => {
  const target = { ready: true, idle: true, runtimeId: 'live-1', profile: 'default' };
  const order: string[] = [];
  const rpc = { call: async (method: string): Promise<unknown> => {
    if (method === 'commands.catalog') return commandFixture();
    if (method === 'config.get') return { home: '/home-private' };
    if (method === 'profiles.list') return { profiles: [{ name: 'default', path: '/home-private' }] };
    if (method === 'session.activate') return { running: false, info: { profile_name: 'default' } };
    if (method === 'command.dispatch') return { type: 'send', message: 'Kickoff prompt', notice: '⊙ Goal set (20-turn budget): finish it' };
    throw new Error(`Unexpected ${method}`);
  } };
  const commands = new NativeCommands(rpc, { read: () => target, notify() {}, refresh: async () => {},
    submitGenerated: async message => { order.push(`prompt:${message}`); }, notice: text => { order.push(`notice:${text}`); } });
  await commands.execute('/default-skill task');
  await commands.confirm();
  assert.deepEqual(order, ['notice:⊙ Goal set (20-turn budget): finish it', 'prompt:Kickoff prompt']);
});
