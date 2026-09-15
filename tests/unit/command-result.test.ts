import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandResult, readOnlyCommandResult, COMMAND_RESULT_LIMITS as limits } from '../../src/hermes/command-result.js';

test('native plain, exec and plugin text results have identical inert presentation contracts', () => {
  for (const type of [undefined, 'exec', 'plugin']) {
    assert.deepEqual(commandResult({ type, output: '<script>not code</script>', password: 'discard' }),
      { kind: 'output', output: '<script>not code</script>', truncated: false, pending: false });
  }
});
test('output is bounded but pending and warnings remain distinguishable from completed execution', () => {
  const result = commandResult({ type: 'exec', status: 'pending', output: 'x'.repeat(50000), warning: 'Read state before continuing' });
  assert.equal(result.kind, 'output');
  if (result.kind === 'output') { assert.equal(result.output.length, limits.output); assert.equal(result.pending, true); assert.equal(result.truncated, true); }
});
test('skill/send prompts retain exact model-facing content, without treating display as executable input', () => {
  for (const type of ['skill', 'send']) assert.deepEqual(commandResult({ type, message: 'Native scaffold\nexact', display: '/skill task', notice: 'Loaded', api_key: 'discard' }),
    { kind: 'send', message: 'Native scaffold\nexact', display: '/skill task', notice: 'Loaded' });
});
test('undo prefill and aliases are distinct from immediate prompt submission', () => {
  assert.deepEqual(commandResult({ type: 'prefill', message: 'Edit this', notice: 'Undone' }), { kind: 'prefill', message: 'Edit this', notice: 'Undone' });
  assert.deepEqual(commandResult({ type: 'alias', target: '/plan build this' }), { kind: 'alias', target: '/plan build this' });
});
test('malformed, ambiguous or unrecognised directive shapes are rejected without exposing payloads in errors', () => {
  for (const raw of [null, [], 42, {}, { type: 'shell', command: 'PRIVATE' }, { output: 'PRIVATE', target: '/unsafe' },
    { type: 'send', message: 'PRIVATE', output: 'ambiguous' }, { type: 'prefill', message: [] },
    { type: 'alias', target: '' }, { type: 'send', message: ' ' }, { output: 'ok', status: 'streaming' }]) {
    assert.throws(() => commandResult(raw), e => e instanceof Error && !e.message.includes('PRIVATE'));
  }
});
test('model input, prefill and aliases are never silently truncated', () => {
  for (const [type, key, max] of [['send', 'message', limits.generatedPrompt], ['skill', 'message', limits.generatedPrompt],
    ['prefill', 'message', limits.draft], ['alias', 'target', limits.alias]] as const) {
    assert.throws(() => commandResult({ type, [key]: 'x'.repeat(max + 1) }));
    assert.throws(() => commandResult({ type, [key]: 'bad\0text' }));
  }
});
test('the read-only adapter refuses all prompt/alias/edit/pending outcomes', () => {
  for (const raw of [{ type: 'send', message: 'do it' }, { type: 'skill', message: 'skill' },
    { type: 'alias', target: '/new' }, { type: 'prefill', message: 'draft' }, { type: 'exec', output: 'queued', status: 'pending' }])
    assert.throws(() => readOnlyCommandResult(raw));
  assert.equal(readOnlyCommandResult({ output: 'usage' }).output, 'usage');
});
