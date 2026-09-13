import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startProvider, EXPECTED_RESPONSE } from '../integration/provider.js';

test('controlled model endpoint supports plain and streaming chat completions without executing tools', async (t) => {
  const provider = await startProvider();
  t.after(() => provider.close());
  for (const stream of [false, true]) {
    const response = await fetch(`${provider.origin}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'phase0-fixture',
        stream,
        messages: [{ role: 'user', content: 'acknowledge' }],
      }),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(text.includes(EXPECTED_RESPONSE));
    assert.ok(!text.includes('tool_calls'));
    if (stream) assert.ok(text.endsWith('data: [DONE]\n\n'));
    else assert.equal(JSON.parse(text).choices[0].message.content, EXPECTED_RESPONSE);
  }
  assert.equal(provider.count(), 2);
});
