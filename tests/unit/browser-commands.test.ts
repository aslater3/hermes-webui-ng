import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserCommand, copyAssistantResponse, COPY_TEXT_LIMIT, BROWSER_COMMAND_NAMES } from '../../src/hermes/browser-commands.js';
import { commandCatalogue, commandChoice } from '../../src/hermes/command-catalog.js';
import { NativeCommands } from '../../src/hermes/native-commands.js';
import { branchCommandConversation } from '../../client/browser-command-actions.js';

const pairs = [...BROWSER_COMMAND_NAMES].map(name => [name, `Browser ${name}`]);
const catalogue = { pairs, canon: { '/compose': '/prompt', '/reset': '/new' } };

test('client-owned commands have explicit browser semantics and preserve aliases', () => {
  assert.deepEqual(browserCommand('/new', 'Project notes'), { kind: 'new', title: 'Project notes' });
  assert.deepEqual(browserCommand('/clear', ''), { kind: 'new', title: '' });
  assert.deepEqual(browserCommand('/resume', 'Project'), { kind: 'sessions', query: 'Project' });
  assert.deepEqual(browserCommand('/sessions', ''), { kind: 'sessions', query: '' });
  assert.deepEqual(browserCommand('/prompt', 'Initial text'), { kind: 'compose', text: 'Initial text' });
  assert.deepEqual(browserCommand('/copy', '1'), { kind: 'copy', ordinal: 1 });
  assert.deepEqual(browserCommand('/copy', ''), { kind: 'copy' });
  assert.deepEqual(browserCommand('/redraw', ''), { kind: 'redraw' });
  assert.deepEqual(browserCommand('/branch', 'Experiment'), { kind: 'branch', title: 'Experiment' });
  assert.deepEqual(browserCommand('/yolo', ''), { kind: 'yolo' });
  assert.deepEqual(browserCommand('/image', '/tmp/example.png'), { kind: 'image', hostPath: '/tmp/example.png' });
  assert.deepEqual(browserCommand('/paste', ''), { kind: 'paste' });
  assert.equal(commandChoice(commandCatalogue(catalogue), { name: '/compose', argument: 'text' }).name, '/prompt');
});

test('browser command validation rejects unsupported arguments rather than delegating to a worker', () => {
  for (const [name, arg] of [['/copy', '0'], ['/copy', '-1'], ['/copy', '1.2'], ['/copy', 'NaN'], ['/clear', 'all'], ['/redraw', 'now'], ['/new', 'x'.repeat(513)], ['/resume', 'x'.repeat(513)], ['/paste', 'extra'], ['/yolo', 'on'], ['/branch', 'x'.repeat(513)], ['/image', 'x'.repeat(4097)], ['/prompt', '\0']])
    assert.throws(() => browserCommand(name!, arg!));
});

test('copy N counts assistant messages from the beginning; default skips empty tool-only replies', () => {
  const history = { messages: [{ role: 'user', text: 'question' }, { role: 'assistant', content: 'First answer' },
    { role: 'assistant', content: '' }, { role: 'tool', content: 'PRIVATE TOOL' }, { role: 'assistant', content: 'Last answer' },
    { role: 'assistant', tool_calls: [{ arguments: 'PRIVATE ARGUMENT' }] }] };
  assert.deepEqual(copyAssistantResponse(history, 1), { text: 'First answer', ordinal: 1 });
  assert.deepEqual(copyAssistantResponse(history, 3), { text: 'Last answer', ordinal: 3 });
  assert.deepEqual(copyAssistantResponse(history), { text: 'Last answer', ordinal: 3 });
  for (const ordinal of [0, 2, 9, -1, 1.5, NaN, Infinity]) assert.throws(() => copyAssistantResponse(history, ordinal));
});

test('copy extracts only textual assistant content, never media/reasoning/tool payloads', () => {
  assert.deepEqual(copyAssistantResponse({ messages: [{ role: 'assistant', content: [
    { type: 'thinking', text: 'PRIVATE REASONING' }, { type: 'text', text: 'Visible ' },
    { type: 'image_url', text: 'PRIVATE IMAGE', url: 'data:private' }, { type: 'output_text', text: 'answer' },
  ] }] }), { text: 'Visible answer', ordinal: 1 });
  for (const raw of [{}, { messages: [] }, { messages: [{ role: 'tool', text: 'private' }] }, { messages: [{ role: 'assistant', text: '\0bad' }] },
    { messages: [{ role: 'assistant', text: 'x'.repeat(COPY_TEXT_LIMIT + 1) }] }, { messages: Array(20001).fill(null) }])
    assert.throws(() => copyAssistantResponse(raw));
});

test('browser intents block conflicting actions, preserve composer input and never perform remote execution', async () => {
  const calls: string[] = [], target = { ready: true, idle: true, runtimeId: 'runtime', profile: 'work' };
  const commands = new NativeCommands({ call: async method => { calls.push(method); assert.equal(method, 'commands.catalog'); return catalogue; } },
    { read: () => target, notify: () => {} });
  await commands.execute('/compose Initial text', 'composer');
  assert.deepEqual(commands.state.action, { kind: 'browser', query: '/prompt Initial text', text: '/compose Initial text', source: 'composer' });
  assert.equal(commands.blocked, true); await assert.rejects(commands.execute('/clear'));
  commands.dismissAction(); assert.equal(commands.blocked, false);
  await commands.execute('/copy'); assert.equal(commands.state.action?.source, 'catalogue');
  commands.setVisible(false); assert.equal(commands.state.action, undefined); assert.equal(commands.blocked, false);
  assert.deepEqual(calls, ['commands.catalog', 'commands.catalog']);
});

test('an advertised custom command with a browser-command name retains native ownership', () => {
  const custom = commandCatalogue({ ...catalogue, categories: [{ name: 'User commands', pairs: [['/copy', 'Custom copy']] }] });
  assert.equal(commandChoice(custom, { name: '/copy', argument: 'custom args' }).action, 'confirm-native');
});


test('branch browser action uses the selected native session RPC and opens only the returned stored child', async () => {
  const oldHistory = globalThis.history;
  const pushed: string[] = [];
  Object.defineProperty(globalThis, 'history', { configurable: true, value: { pushState: (_a: unknown, _b: string, url: string) => pushed.push(url) } });
  try {
    const calls: { method: string; params: Record<string, unknown> }[] = [], opened: unknown[] = [];
    const native = { state: { phase: 'idle', runtimeId: 'live-parent', profile: 'work' }, commands: { blocked: false } } as unknown as Parameters<typeof branchCommandConversation>[1];
    const rt = {
      ready: true, accountGeneration: 4,
      gateway: { state: { generation: 9 }, call: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params }); return { session_id: 'live-child', stored_session_id: 'stored-child', title: 'Experiment' };
      } },
      chat: { busy: false, native, error: undefined, open: async (ref: unknown) => { opened.push(ref); } }, notify: () => {},
    } as unknown as Parameters<typeof branchCommandConversation>[0];
    await branchCommandConversation(rt, native, 'Experiment');
    assert.deepEqual(calls, [{ method: 'session.branch', params: { session_id: 'live-parent', profile: 'work', name: 'Experiment' } }]);
    assert.deepEqual(opened, [{ id: 'stored-child', profile: 'work' }]); assert.equal(pushed.length, 1); assert.match(pushed[0]!, /stored-child/);
  } finally { Object.defineProperty(globalThis, 'history', { configurable: true, value: oldHistory }); }
});
