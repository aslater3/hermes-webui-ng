import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayMessage, type DisplayMessage } from '../../src/hermes/history-message.js';
import { AgentActivity } from '../../src/hermes/agent-activity.js';
import { conversationSegments, thoughtLabel, toolLabel, type TimelineItem, type TurnSegment, type ToolGroupItem } from '../../src/hermes/turn-timeline.js';

const rest = (row: Record<string, unknown>) => displayMessage(row, 'rest') as DisplayMessage;
const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const result = (id: string, name: string, content: unknown, timestamp?: number) =>
  rest({ id: 900 + id.length, role: 'tool', tool_call_id: id, tool_name: name, content: typeof content === 'string' ? content : JSON.stringify(content), ...(timestamp ? { timestamp } : {}) });
const user = (text: string, timestamp?: number) => rest({ id: 1, role: 'user', content: text, ...(timestamp ? { timestamp } : {}) });

/** A saved turn: the prompt at 97 s, reasoning stored at 100 s, a failing pair, narration, one call, then the reply. */
function savedTurn(): DisplayMessage[] {
  return [
    user('Check the radar math.', 97),
    rest({ id: 2, role: 'assistant', content: '', reasoning_content: 'Read the helper first.', timestamp: 100,
      tool_calls: [call('c1', 'terminal', { command: 'cd /work && make test' }), call('c2', 'read_file', { path: 'tools/radar_math.py', offset: 1, limit: 40 })] }),
    result('c1', 'terminal', { output: 'FAILED', exit_code: 1, error: null, duration_s: 2.1 }, 103),
    result('c2', 'read_file', { content: '1|x' }, 104),
    rest({ id: 5, role: 'assistant', content: 'The rounding case fails.', timestamp: 110, tool_calls: [call('c3', 'terminal', { command: 'make verify' })] }),
    result('c3', 'terminal', { exit_code: 0, duration_s: 5 }, 115),
    rest({ id: 7, role: 'assistant', content: 'Fixed and verified.', timestamp: 120 }),
  ] as DisplayMessage[];
}
function turnOf(segments: ReturnType<typeof conversationSegments>): TurnSegment {
  const turn = segments.find((segment): segment is TurnSegment => segment.kind === 'turn');
  assert.ok(turn, 'a turn segment');
  return turn;
}
/** One label per row: the thought preview, the narration or reply text, or the tool names of a group. */
const kinds = (items: readonly TimelineItem[]) => items.map(item => {
  if (item.kind === 'tools') return `tools:${item.calls.map(c => c.name).join('+')}`;
  return `${item.kind}:${item.kind === 'thought' ? item.preview : item.text}`;
});
const groups = (items: readonly TimelineItem[]) => items.filter((item): item is ToolGroupItem => item.kind === 'tools');
/** Live activity from Hermes gateway events; `clock` supplies the epoch ms each entry is stamped with, in order of creation. */
function liveActivity(events: [string, unknown][], clock: number[]): AgentActivity {
  const activity = new AgentActivity();
  let index = 0;
  activity.clock = () => clock[index++] ?? 0;
  for (const [type, payload] of events) activity.receive({ type, session_id: 'live', payload } as never);
  return activity;
}

test('a saved turn becomes one CLI-style timeline: thought, grouped calls, narration, reply', () => {
  const turn = turnOf(conversationSegments(savedTurn()));
  assert.deepEqual(kinds(turn.items), [
    'thought:Read the helper first.',
    'tools:terminal+read_file',
    'narration:The rounding case fails.',
    'tools:terminal',
    'reply:Fixed and verified.',
  ]);
  const [first, second] = groups(turn.items);
  assert.equal(first?.status, 'failed');
  assert.equal(first?.calls[0]?.verdict, 'exit 1 · failed');
  assert.equal(first?.calls[0]?.summary, 'make test', 'the cd prefix is stripped from the one-line summary');
  assert.match(first?.calls[0]?.args ?? '', /make test/, 'the full command stays in the details');
  assert.equal(first?.calls[1]?.summary, 'tools/radar_math.py:1–40');
  assert.equal(first?.calls[0]?.seconds, 2.1);
  assert.equal(second?.status, 'ok');
  assert.equal(second?.seconds, 5);
  // Saved thinking time runs from the previous stored row (the prompt at 97 s) to the reasoning at 100 s.
  const thought = turn.items[0];
  assert.equal(thought?.kind === 'thought' ? thought.seconds : undefined, 3);
});

test('a thought or narration between calls splits the group; calls in one envelope stay together', () => {
  const messages = [user('go'),
    rest({ id: 2, role: 'assistant', content: '', tool_calls: [call('a', 'terminal', { command: 'ls' }), call('b', 'terminal', { command: 'pwd' })] }),
    result('a', 'terminal', { exit_code: 0 }), result('b', 'terminal', { exit_code: 0 }),
    rest({ id: 3, role: 'assistant', content: '', reasoning_content: 'Now the test.', tool_calls: [call('c', 'terminal', { command: 'make' })] }),
    result('c', 'terminal', { exit_code: 0 }),
    rest({ id: 4, role: 'assistant', content: 'Done.' })] as DisplayMessage[];
  const turn = turnOf(conversationSegments(messages));
  assert.deepEqual(kinds(turn.items), ['tools:terminal+terminal', 'thought:Now the test.', 'tools:terminal', 'reply:Done.']);
});

test('a turn without stored timestamps shows no thought duration rather than a fake zero', () => {
  const messages = [user('x'), rest({ id: 2, role: 'assistant', content: '', reasoning_content: 'Hmm.' }), rest({ id: 3, role: 'assistant', content: 'Answer.' })] as DisplayMessage[];
  const thought = turnOf(conversationSegments(messages)).items[0];
  assert.equal(thought?.kind === 'thought' ? thought.seconds : 'missing', undefined);
});

test('a running live call shows its start time; a finished one shows its duration and the thought ends at the first call', () => {
  const live = liveActivity([
    ['reasoning.delta', { text: 'Planning the radar check. ' }],
    ['tool.start', { tool_id: 't1', name: 'terminal', args: { command: 'make radar-check' } }],
    ['tool.complete', { tool_id: 't1', name: 'terminal', duration_s: 2.5, result: '{"exit_code":0}' }],
    ['message.delta', { text: 'Checking the build. ' }],
    ['tool.start', { tool_id: 't2', name: 'terminal', args: { command: 'make verify' } }],
  ], [1000, 3300, 3400, 3500]);
  const turn = turnOf(conversationSegments([user('check')], { activity: live.state, running: true, interleaved: true }));
  assert.equal(turn.key, 'turn:current');
  assert.deepEqual(kinds(turn.items), ['thought:Planning the radar check.', 'tools:terminal', 'narration:Checking the build.', 'tools:terminal']);
  const [done, running] = groups(turn.items);
  assert.equal(done?.status, 'ok');
  assert.equal(done?.calls[0]?.seconds, 2.5);
  assert.equal(running?.status, 'running');
  assert.equal(running?.calls[0]?.status, 'running');
  assert.equal(running?.startedAt, 3500);
  const thought = turn.items[0];
  assert.equal(thought?.kind === 'thought' ? thought.seconds : undefined, 2.3, 'from the reasoning (1000 ms) to the first call (3300 ms)');
  assert.equal(thought?.kind === 'thought' ? thought.running : true, false);
});

test('a live thought still streaming is marked running and has no duration yet', () => {
  const live = liveActivity([['reasoning.delta', { text: 'Still thinking' }]], [500]);
  const turn = turnOf(conversationSegments([user('hi')], { activity: live.state, running: true, interleaved: false }));
  const thought = turn.items[0];
  assert.equal(thought?.kind === 'thought' && thought.running, true);
  assert.equal(thought?.kind === 'thought' ? thought.seconds : 'missing', undefined);
});

test('live reply text is kept out of the timeline unless it is interleaved with tools', () => {
  const live = liveActivity([['message.delta', { text: 'Only text so far.' }]], [0]);
  const segments = conversationSegments([user('hi')], { activity: live.state, running: true, interleaved: false });
  assert.equal(segments.some(segment => segment.kind === 'turn'), false, 'no timeline row for text that stays in the streamed box');
});

test('a failed live call is marked failed with its verdict', () => {
  const live = liveActivity([
    ['tool.start', { tool_id: 'f1', name: 'terminal', args: { command: 'make' } }],
    ['tool.complete', { tool_id: 'f1', name: 'terminal', duration_s: 0.4, result: '{"exit_code":2}' }],
  ], [0]);
  const [group] = groups(turnOf(conversationSegments([user('x')], { activity: live.state, running: false, interleaved: false })).items);
  assert.equal(group?.status, 'failed');
  assert.equal(group?.calls[0]?.verdict, 'exit 2 · failed');
});

test('a finished live turn merges into its saved history: each step once, in order, with the same keys', () => {
  const live = liveActivity([
    ['reasoning.delta', { text: 'Read the helper first.' }],
    ['tool.start', { tool_id: 'c1', name: 'terminal', args: { command: 'make test' } }],
    ['tool.complete', { tool_id: 'c1', name: 'terminal', duration_s: 2.1, result: '{"exit_code":1}' }],
    ['message.delta', { text: 'The rounding case fails.' }],
    ['tool.start', { tool_id: 'c3', name: 'terminal', args: { command: 'make verify' } }],
    ['tool.complete', { tool_id: 'c3', name: 'terminal', duration_s: 5, result: '{"exit_code":0}' }],
    ['message.delta', { text: 'Fixed and verified.' }],
  ], [0, 500, 2600, 2700, 2800, 7800, 7900]);
  const liveOnly = turnOf(conversationSegments([user('Check the radar math.')], { activity: live.state, running: false, interleaved: true }));
  assert.equal(liveOnly.items.length, 5, 'before the refresh the live turn shows all five rows');
  const merged = turnOf(conversationSegments(savedTurn(), { activity: live.state, running: false, interleaved: true }));
  assert.equal(merged.key, 'turn:current');
  assert.deepEqual(kinds(merged.items), [
    'thought:Read the helper first.',
    'tools:terminal+read_file',
    'narration:The rounding case fails.',
    'tools:terminal',
    'reply:Fixed and verified.',
  ]);
  // Rows keep their keys across the handover, so nothing remounts when history replaces the live copy.
  assert.deepEqual(merged.items.map(item => item.key), liveOnly.items.map(item => item.key));
  assert.equal(groups(merged.items)[0]?.calls.find(call => call.callId === 'c1')?.status, 'failed');
});

test('a live thought keeps the duration it measured when the saved copy has no timestamps', () => {
  const live = liveActivity([
    ['reasoning.delta', { text: 'Weighing the options.' }],
    ['tool.start', { tool_id: 'c1', name: 'terminal', args: { command: 'make' } }],
    ['tool.complete', { tool_id: 'c1', name: 'terminal', result: '{"exit_code":0}' }],
  ], [0, 2500]);
  const saved = [user('go'), rest({ id: 2, role: 'assistant', content: '', reasoning_content: 'Weighing the options.',
    tool_calls: [call('c1', 'terminal', { command: 'make' })] }), result('c1', 'terminal', { exit_code: 0 })] as DisplayMessage[];
  const turn = turnOf(conversationSegments(saved, { activity: live.state, running: false, interleaved: false }));
  const thought = turn.items[0];
  assert.equal(thought?.kind === 'thought' ? thought.seconds : undefined, 2.5);
  assert.equal(turn.items.length, 2, 'the thought and its group, once each');
});

test('a shared call keeps the duration measured live when the stored result has none', () => {
  const live = liveActivity([
    ['tool.start', { tool_id: 'c1', name: 'terminal', args: { command: 'make' } }],
    ['tool.complete', { tool_id: 'c1', name: 'terminal', duration_s: 2.2, result: '{"exit_code":0}' }],
  ], [0, 1]);
  const saved = [user('go'), rest({ id: 2, role: 'assistant', content: '', tool_calls: [call('c1', 'terminal', { command: 'make' })] }),
    result('c1', 'terminal', { exit_code: 0 })] as DisplayMessage[];
  const [group] = groups(turnOf(conversationSegments(saved, { activity: live.state, running: false, interleaved: false })).items);
  assert.equal(group?.calls[0]?.seconds, 2.2);
  assert.equal(group?.seconds, 2.2);
});

test('live calls the history does not know yet are appended to the saved group', () => {
  const saved = [user('go'), rest({ id: 2, role: 'assistant', content: '', tool_calls: [call('c1', 'terminal', { command: 'make' }), call('c2', 'terminal', { command: 'ls' })] }),
    result('c1', 'terminal', { exit_code: 0 })] as DisplayMessage[];
  const live = liveActivity([
    ['tool.start', { tool_id: 'c1', name: 'terminal', args: { command: 'make' } }],
    ['tool.complete', { tool_id: 'c1', name: 'terminal', result: '{"exit_code":0}' }],
    ['tool.start', { tool_id: 'c3', name: 'terminal', args: { command: 'make verify' } }],
    ['tool.complete', { tool_id: 'c3', name: 'terminal', result: '{"exit_code":0}' }],
    ['tool.start', { tool_id: 'c4', name: 'terminal', args: { command: 'make package' } }],
  ], [0, 1, 2, 3, 4]);
  const turn = turnOf(conversationSegments(saved, { activity: live.state, running: true, interleaved: true }));
  const [group] = groups(turn.items);
  assert.deepEqual(group?.calls.map(call => call.callId), ['c1', 'c2', 'c3', 'c4']);
  assert.equal(turn.items.length, 1, 'one group, not a second block');
  assert.equal(group?.calls.at(-1)?.status, 'running');
  assert.equal(group?.status, 'running');
});

test('a tool-free live answer already saved by history appears once', () => {
  const live = liveActivity([['reasoning.delta', { text: 'Simple question.' }], ['message.delta', { text: 'Fine.' }]], [0, 0]);
  const saved = [user('hi'), rest({ id: 2, role: 'assistant', content: 'Fine.', reasoning_content: 'Simple question.' })] as DisplayMessage[];
  const turn = turnOf(conversationSegments(saved, { activity: live.state, running: false, interleaved: false }));
  assert.deepEqual(kinds(turn.items), ['thought:Simple question.', 'reply:Fine.']);
});

test('history that ends at the user message gets a live current turn; an empty live state adds nothing', () => {
  const live = liveActivity([['reasoning.delta', { text: 'Thinking it through.' }]], [0]);
  const withLive = conversationSegments([user('hi')], { activity: live.state, running: true, interleaved: false });
  const last = withLive.at(-1) as TurnSegment;
  assert.equal(last.kind, 'turn');
  assert.deepEqual(kinds(last.items), ['thought:Thinking it through.']);
  const empty = conversationSegments([user('hi')], { activity: new AgentActivity().state, running: false, interleaved: false });
  assert.equal(empty.length, 1);
});

test('segment keys: the last saved turn is current; earlier turns keep the key of their first message', () => {
  const messages = [...savedTurn(), user('next'), rest({ id: 9, role: 'assistant', content: 'Ok.' })] as DisplayMessage[];
  const turns = conversationSegments(messages).filter((segment): segment is TurnSegment => segment.kind === 'turn');
  assert.equal(turns.length, 2);
  assert.equal(turns[0]?.key, 'turn:1');
  assert.equal(turns[1]?.key, 'turn:current');
  assert.equal(turns[1]?.current, true);
});

test('durations are labelled without faking precision', () => {
  assert.equal(thoughtLabel(undefined), '');
  assert.equal(thoughtLabel(0.2), '<1s');
  assert.equal(thoughtLabel(3.4), '3s');
  assert.equal(toolLabel(5), '5.0s');
  assert.equal(toolLabel(75), '1:15');
});

test('readable output: command text and errors, file content, pretty JSON, plain text untouched', async () => {
  const { readableOutput } = await import('../../src/hermes/turn-timeline.js');
  assert.equal(readableOutput('terminal', '{"output":"timeline ok","exit_code":0}'), 'timeline ok');
  assert.equal(readableOutput('terminal', '{"output":"","exit_code":2,"error":"boom"}'), '[error] boom');
  assert.equal(readableOutput('read_file', '{"content":"1|import x"}'), '1|import x');
  assert.equal(readableOutput('write_file', '{"bytes_written":10}'), '{\n  "bytes_written": 10\n}');
  assert.equal(readableOutput('terminal', 'plain text output'), 'plain text output');
  assert.equal(readableOutput('terminal', '{"output": "cut off'), '{"output": "cut off');
});
test('a multi-line command summarises as one joined line', async () => {
  const { oneLine } = await import('../../src/hermes/agent-steps.js');
  assert.equal(oneLine('python3 -c "\nimport json\nprint(1)"'), 'python3 -c " import json print(1)"');
});
