import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phase3Tool } from '../integration/phase3-model.js';
import { startProvider } from '../integration/provider.js';
const tools=[{type:'function',function:{name:'clarify'}}];
test('controlled Phase 3 model refuses invented tools and never repeats a completed tool call',()=>{
  const messages=[{role:'user',content:'PHASE3_CLARIFY_fixture'}];
  assert.throws(()=>phase3Tool(messages,[]));
  const call=phase3Tool(messages,tools);assert.equal(call?.function.name,'clarify');
  assert.equal(JSON.parse(call!.function.arguments).questions.length,2);
  assert.equal(phase3Tool([...messages,{role:'tool',content:'result'}],tools),undefined);
  assert.equal(phase3Tool([{role:'user',content:'ordinary prompt'}],tools),undefined);
});
test('controlled provider sends complete native tool-call shapes in plain and streamed responses',async(t)=>{
  const provider=await startProvider();t.after(()=>provider.close());
  for(const stream of [false,true]){
    const response=await fetch(`${provider.origin}/v1/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stream,tools,messages:[{role:'user',content:'PHASE3_CLARIFY_fixture'}]})});
    assert.equal(response.status,200);const text=await response.text();assert.ok(text.includes('tool_calls'));assert.ok(text.includes('call_phase3_clarify'));
    if(!stream){const value=JSON.parse(text);assert.equal(value.choices[0].finish_reason,'tool_calls');assert.equal(value.choices[0].message.tool_calls.length,1);}
    else assert.ok(text.endsWith('data: [DONE]\n\n'));
  }
});
