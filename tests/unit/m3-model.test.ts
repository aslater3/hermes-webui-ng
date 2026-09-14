import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m3Tool } from '../integration/m3-model.js';
const tools = ['terminal', 'skill_view'].map(name => ({ type: 'function', function: { name } }));
test('native M3 model decisions require an isolated lab and never repeat completed tool calls', () => {
  for (const tag of ['M3_APPROVAL_ALLOW', 'M3_APPROVAL_DENY', 'M3_APPROVAL_EXPIRE', 'M3_SUDO', 'M3_SUDO_SKIP', 'M3_SECRET', 'M3_SECRET_CHECK', 'M3_SECRET_SKIP']) {
    const messages = [{ role: 'user', content: tag }];
    assert.throws(() => m3Tool(messages, tools, '/home/operator'));
    assert.throws(() => m3Tool(messages, [], '/tmp/hermes-m3-FIXTURE'));
    const call = m3Tool(messages, tools, '/tmp/hermes-m3-FIXTURE')!;
    assert.ok(['terminal', 'skill_view'].includes(call.function.name));
    assert.equal(m3Tool([...messages, { role: 'tool', content: 'done' }], tools, '/tmp/hermes-m3-FIXTURE'), undefined);
    if (tag.startsWith('M3_APPROVAL')) assert.match(JSON.parse(call.function.arguments).command, /^rm -rf -- \/tmp\/hermes-m3-FIXTURE\/(allow|deny|expire)-target$/);
  }
  assert.equal(m3Tool([{ role: 'user', content: 'ordinary prompt' }], tools), undefined);
});
