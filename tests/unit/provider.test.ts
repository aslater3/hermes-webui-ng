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

test('controlled delay applies only to the latest user turn and exposes no request content', async (t) => {
  const provider = await startProvider(0, 150); t.after(() => provider.close());
  const request = (messages: {role:string;content:string}[]) => fetch(`${provider.origin}/v1/chat/completions`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model:'phase0-fixture',messages}) });
  const held = request([{role:'user',content:'PHASE2_HOLD_private'}]);
  let health: {activeHolds:number} = {activeHolds:0};
  for (let i=0; i<50 && !health.activeHolds; i++) {
    health = await (await fetch(`${provider.origin}/health`)).json();
    if (!health.activeHolds) await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(health.activeHolds,1); assert.ok(!JSON.stringify(health).includes('private'));
  assert.equal((await held).status,200);
  const next = await request([{role:'user',content:'PHASE2_HOLD_old'},{role:'assistant',content:'old'},{role:'user',content:'next turn'}]);
  assert.equal(next.status,200);
  assert.equal((await (await fetch(`${provider.origin}/health`)).json()).activeHolds,0);
});
