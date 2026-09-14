import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentText, displayMessage } from '../../src/hermes/history-message.js';
import { historyPage } from '../../src/hermes/session-rest.js';

test('native tool summary is meaningful without a text property or fabricated output', () => {
  const row = displayMessage({ role: 'tool', name: 'terminal', context: 'git status', args: { secret: 'DO_NOT_SERIALISE' } }, 'native');
  assert.equal(row?.toolName, 'terminal'); assert.equal(row?.text, 'git status');
  assert.ok(!JSON.stringify(row).includes('DO_NOT_SERIALISE'));
  assert.ok(!JSON.stringify(row).includes('[Non-text entry]'));
});
test('REST arrays and native alternate content preserve known text in order', () => {
  const content = [{ type: 'text', text: 'First ' }, { type: 'output_text', text: 'second' }];
  assert.equal(displayMessage({ role: 'assistant', content }, 'rest')?.text, 'First second');
  assert.equal(displayMessage({ role: 'assistant', content }, 'native')?.text, 'First second');
});
test('sidecar-only assistant response and public reasoning survive a history reload', () => {
  const result = displayMessage({ role: 'assistant', text: '',
    codex_message_items: [{ type: 'message', content: [{ type: 'output_text', text: 'Recovered answer' }] }],
    codex_reasoning_items: [{ type: 'reasoning', encrypted_content: 'PRIVATE_BLOB', summary: [{ type: 'summary_text', text: 'Public summary' }] }],
  }, 'native');
  assert.equal(result?.text, 'Recovered answer'); assert.equal(result?.reasoning, 'Public summary');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_BLOB'));
});
test('opaque reasoning and hidden/empty envelopes are never rendered as generic messages', () => {
  assert.equal(displayMessage({ role: 'assistant', text: '', reasoning_details: [{ type: 'reasoning.encrypted', data: 'PRIVATE' }] }, 'native'), null);
  assert.equal(displayMessage({ role: 'assistant', text: '' }, 'native'), null);
  assert.equal(displayMessage({ role: 'user', content: 'Hidden', display_kind: 'hidden' }, 'rest'), null);
});
test('media parts are labelled without fetching or exposing embedded payloads', () => {
  const result = contentText([{ type: 'input_text', text: 'Photo' }, { type: 'image_url', image_url: { url: 'data:image/svg+xml;PRIVATE' } }, { type: 'input_audio', data: 'PRIVATE' }]);
  assert.ok(result.text.includes('Photo')); assert.ok(result.text.includes('[Image attachment]'));
  assert.ok(result.text.includes('[Audio attachment]')); assert.ok(!result.text.includes('PRIVATE'));
});
test('legitimate SVG words and fenced SVG source are not silently removed', () => {
  const text = 'svg\n**svgHermes**\n```svg\n<svg><text>Example</text></svg>\n```';
  assert.equal(displayMessage({ role: 'assistant', text }, 'native')?.text, text);
});
test('content projection has bounded bytes, breadth and nesting and never stringifies objects', () => {
  assert.deepEqual(contentText('a'.repeat(100), 12), { text: 'a'.repeat(12), truncated: true });
  let deep: unknown = 'hidden'; for (let i = 0; i < 20; i++) deep = [deep];
  assert.equal(contentText(deep).truncated, true);
  assert.equal(contentText(Array(3000).fill('x')).truncated, true);
  assert.equal(contentText({ private: 'NOT_TEXT' }).text, '');
});
test('REST filtering preserves pagination counts even when empty rows are omitted', () => {
  const page = historyPage({ session_id: 'safe-id', messages: [
    { id: 10, role: 'assistant', content: null },
    { id: 11, role: 'tool', tool_name: 'read_file', content: [{ type: 'text', text: 'file result' }] },
  ], pagination: { order: 'latest', offset: 0, limit: 100, returned: 2 } }, { id: 'safe-id' }, 0);
  assert.equal(page.returned, 2); assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0]?.rowId, 11); assert.equal(page.messages[0]?.text, 'file result');
});
