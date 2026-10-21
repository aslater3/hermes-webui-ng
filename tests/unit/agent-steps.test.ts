import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayMessage, type DisplayMessage } from '../../src/hermes/history-message.js';
import { groupHistory, keyArgument, lastStep, redact, reasoningPreview, toolVerdict, STEPS_VISIBLE, type AgentStep, type ToolStep } from '../../src/hermes/agent-steps.js';
import { currentAction } from '../../src/hermes/agent-now.js';
import { AgentActivity } from '../../src/hermes/agent-activity.js';

const rest = (row: Record<string, unknown>) => displayMessage(row, 'rest') as DisplayMessage;
const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const toolRow = (id: string, name: string, content: unknown, extra: Record<string, unknown> = {}) =>
  rest({ id: 99, role: 'tool', tool_call_id: id, tool_name: name, content: typeof content === 'string' ? content : JSON.stringify(content), ...extra });
const tools = (steps: AgentStep[]) => steps.filter((step): step is ToolStep => step.kind === 'tool');
/** Steps of the first agent-steps block in a page. */
const stepsOf = (messages: readonly DisplayMessage[]): AgentStep[] => {
  const item = groupHistory(messages).find(entry => entry.kind === 'steps');
  return item?.kind === 'steps' ? item.steps : [];
};

test('projection keeps tool calls on the assistant envelope and the call id on the result', () => {
  const envelope = rest({ id: 1, role: 'assistant', content: '', reasoning_content: 'Check the file first.', tool_calls: [call('c1', 'read_file', { path: 'a.py', offset: 1, limit: 20 })] });
  assert.equal(envelope.text, ''); assert.equal(envelope.reasoning, 'Check the file first.');
  assert.deepEqual(envelope.toolCalls, [{ id: 'c1', name: 'read_file', args: '{"path":"a.py","offset":1,"limit":20}' }]);
  const result = toolRow('c1', 'read_file', { content: '1|x' });
  assert.equal(result.toolCallId, 'c1'); assert.equal(result.toolName, 'read_file');
});
test('an assistant with only tool calls is a step envelope, not an empty message or a "Requested tools" sentence', () => {
  const message = rest({ id: 2, role: 'assistant', content: '', tool_calls: [call('c2', 'terminal', { command: 'ls' })] });
  assert.equal(message.text, ''); assert.equal(message.toolCalls?.length, 1);
  assert.equal(rest({ id: 3, role: 'assistant', content: null }), null);
});
test('calls without a name are dropped and calls past the cap are bounded', () => {
  const many = Array.from({ length: 40 }, (_, i) => call(`m${i}`, 'terminal', { command: `echo ${i}` }));
  const message = rest({ id: 4, role: 'assistant', content: '', tool_calls: [{ id: 'nameless', function: {} }, ...many] });
  assert.equal(message.toolCalls?.length, 32); assert.equal(message.truncated, true);
});
test('tool calls pair with results by tool_call_id, out of order, and an unmatched result stays its own step', () => {
  const messages = [
    rest({ id: 1, role: 'user', content: 'Run the checks' }),
    rest({ id: 2, role: 'assistant', content: '', reasoning_content: 'Build first.', tool_calls: [call('a', 'terminal', { command: 'make' }), call('b', 'read_file', { path: 'radar.py' })] }),
    toolRow('b', 'read_file', { content: '1|import math' }),
    toolRow('zzz', 'write_file', { bytes_written: 12 }),
    toolRow('a', 'terminal', { output: 'ok', exit_code: 0, error: null }),
  ];
  const items = groupHistory(messages);
  assert.equal(items.length, 2);
  assert.equal(items[0]!.kind, 'message'); const group = items[1]!;
  assert.equal(group.kind, 'steps'); if (group.kind !== 'steps') return;
  assert.deepEqual(group.steps.map(step => step.kind), ['reasoning', 'tool', 'tool', 'tool']);
  const [reasoning, make, read, orphan] = group.steps as [AgentStep, ToolStep, ToolStep, ToolStep];
  assert.equal(reasoning.kind, 'reasoning');
  assert.equal(make.summary, 'make'); assert.equal(make.verdict, 'exit 0'); assert.equal(make.orphan, false);
  assert.equal(read.summary, 'radar.py'); assert.ok(read.output.includes('1|import math'));
  assert.equal(orphan.orphan, true); assert.equal(orphan.name, 'write_file'); assert.equal(orphan.verdict, '12 bytes written');
});
test('a reply with real text is an ordinary message in order; calls requested with it follow it', () => {
  const messages = [
    rest({ id: 1, role: 'user', content: 'Go' }),
    rest({ id: 2, role: 'assistant', content: '', reasoning_content: 'r', tool_calls: [call('x', 'terminal', { command: 'a' })] }),
    toolRow('x', 'terminal', { exit_code: 0 }),
    rest({ id: 4, role: 'assistant', content: 'Midway reply.', tool_calls: [call('y', 'read_file', { path: 'p.md' })] }),
    toolRow('y', 'read_file', { content: 'text' }),
    rest({ id: 6, role: 'assistant', content: 'Final.' }),
  ];
  const kinds = groupHistory(messages).map(item => item.kind === 'message' ? `msg:${item.message.text}` : `steps:${item.steps.length}`);
  assert.deepEqual(kinds, ['msg:Go', 'steps:2', 'msg:Midway reply.', 'steps:1', 'msg:Final.']);
});
test('failures are marked with words, not colour alone; missing results are unknown', () => {
  assert.deepEqual(toolVerdict('{"output":"FAILED","exit_code":1,"error":null}', true), { outcome: 'failed', verdict: 'exit 1 · failed', duration: undefined });
  assert.equal(toolVerdict('{"output":"x","error":"boom"}', true).verdict, 'error');
  assert.equal(toolVerdict('{"success":false}', true).outcome, 'failed');
  assert.equal(toolVerdict('{"exit_code":0,"duration_s":1.84}', true).duration, '1.8s');
  assert.deepEqual(toolVerdict(undefined, false), { outcome: 'unknown', verdict: 'no result recorded' });
  assert.equal(toolVerdict('plain words', true).outcome, 'unknown');
  const pending = stepsOf([rest({ id: 1, role: 'assistant', content: '', tool_calls: [call('p', 'terminal', { command: 'sleep 9' })] })]);
  assert.equal(tools(pending)[0]!.verdict, 'no result recorded');
});
test('summaries: terminal command, file path and line range, search query, unknown first string argument', () => {
  assert.equal(keyArgument('terminal', { command: 'make test\nmake lint' }), 'make test\nmake lint');
  assert.equal(keyArgument('read_file', { path: 'tools/radar_math.py', offset: 40, limit: 20 }), 'tools/radar_math.py:40–59');
  assert.equal(keyArgument('write_file', { path: 'tools/radar_math.py', content: 'x' }), 'tools/radar_math.py');
  assert.equal(keyArgument('web_search', { query: 'radar gain', max: 3 }), 'radar gain');
  assert.equal(keyArgument('mystery_tool', { count: 3, label: 'first text', other: 'second' }), 'first text');
});
test('redaction covers key=value, bearer, provider keys and JSON credential members before display', () => {
  assert.equal(redact('OPENAI_API_KEY=sk-fixture0123456789abcdef make verify', 200).includes('sk-fixture'), false);
  assert.ok(!redact('curl -H "Authorization: Bearer abc.def.ghi"', 200).includes('abc.def.ghi'));
  assert.ok(!redact('{"api_key": "FIXTURE_JSON_VALUE", "x": 1}', 200).includes('FIXTURE_JSON_VALUE'));
  const messages = [rest({ id: 1, role: 'assistant', content: '', tool_calls: [call('t', 'terminal', { command: 'OPENAI_API_KEY=sk-fixture0123456789abcdef make verify' })] }),
    toolRow('t', 'terminal', { output: 'token=SECRET_OUT ok', exit_code: 0 })];
  const step = tools(stepsOf(messages))[0]!;
  assert.ok(!step.summary.includes('sk-fixture')); assert.ok(!step.args.includes('sk-fixture'));
  assert.ok(!step.output.includes('SECRET_OUT'));
});
test('reasoning preview is one line of about 100 characters with markdown stripped', () => {
  const preview = reasoningPreview(`**Plan**\n\n${'word '.repeat(60)}`);
  assert.ok(!preview.includes('\n') && !preview.includes('*'));
  assert.ok(preview.length <= 100 && preview.endsWith('…'));
});
test('grouping: a long run keeps every step, the visible window is the caller\'s concern', () => {
  const messages: DisplayMessage[] = [rest({ id: 0, role: 'user', content: 'Go' })];
  for (let i = 0; i < 12; i++) {
    messages.push(rest({ id: 2 * i + 1, role: 'assistant', content: '', reasoning_content: `step ${i}`, tool_calls: [call(`k${i}`, 'read_file', { path: `f${i}.py` })] }));
    messages.push(toolRow(`k${i}`, 'read_file', { content: '1|x' }));
  }
  const items = groupHistory(messages);
  assert.equal(items.length, 2);
  assert.equal(stepsOf(messages).length, 24); assert.equal(STEPS_VISIBLE, 6);
  assert.deepEqual(lastStep(items)?.label, 'read_file — f11.py');
});
test('current action: running tool with elapsed start, then reply, then thinking; last-step fallback when nothing is live', () => {
  const activity = new AgentActivity(); let now = 10_000; activity.clock = () => now;
  activity.receive({ type: 'tool.start', payload: { tool_id: 'n1', name: 'terminal', args: { command: 'make radar-check' } } } as never);
  const running = currentAction({ running: true, activity: activity.state, streaming: '', history: [] });
  assert.equal(running?.kind, 'tool'); assert.equal(running?.label, 'Running terminal: make radar-check'); assert.equal(running?.startedAt, 10_000);
  activity.receive({ type: 'tool.complete', payload: { tool_id: 'n1', name: 'terminal', result: '{"exit_code":0}' } } as never);
  now = 20_000;
  assert.equal(currentAction({ running: true, activity: activity.state, streaming: '', history: [] })?.label, 'Thinking…');
  assert.equal(currentAction({ running: true, activity: activity.state, streaming: 'Hi', history: [] })?.label, 'Writing reply…');
  assert.equal(currentAction({ running: false, activity: activity.state, streaming: '', history: [] }), undefined);
  const fresh = new AgentActivity();
  const history = groupHistory([rest({ id: 1, role: 'assistant', content: '', tool_calls: [call('w', 'write_file', { path: 'tools/radar_math.py', content: 'x' })] }),
    toolRow('w', 'write_file', { bytes_written: 10 }, { timestamp: 1000 })]);
  assert.equal(currentAction({ running: true, activity: fresh.state, streaming: '', history })?.label, 'Last step: write_file — tools/radar_math.py');
});
test('native rows: the gateway preview is the summary and is never treated as a result', () => {
  const native = displayMessage({ role: 'tool', name: 'terminal', context: 'git status', tool_call_id: 'n', args: { deliberately: 'PRIVATE_ARG' } }, 'native') as DisplayMessage;
  const [step] = tools(stepsOf([native]));
  assert.equal(step!.summary, 'git status'); assert.equal(step!.orphan, true); assert.equal(step!.verdict, 'no result recorded');
  assert.ok(!JSON.stringify(step).includes('PRIVATE_ARG'));
});
