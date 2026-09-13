import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentActivity, ACTIVITY_LIMITS, displayValue, inputRpc, parseInput } from '../../src/hermes/agent-activity.js';
const event = (type: string, payload: unknown) => ({ type, session_id: 'live', payload });
test('approval exposes only explicit once/deny choices and retains the command', () => {
  const prompt = parseInput('approval', { request_id:'a',command:'fixture operation',choices:['once','session','always','deny'] });
  assert.deepEqual(prompt.choices,['once','deny']);
  assert.deepEqual(inputRpc(prompt,{value:'once'},'live'),{method:'approval.respond',params:{session_id:'live',request_id:'a',choice:'once'}});
  assert.throws(()=>inputRpc(prompt,{value:'always'},'live'));
  assert.throws(()=>inputRpc(parseInput('approval',{request_id:'a',command:'x'.repeat(9000)}),{value:'once'},'live'));
  assert.throws(()=>inputRpc(parseInput('approval',{request_id:'a'}),{value:'once'},'live'));
});
test('malformed identifiers, choices and duplicate clarify questions are rejected',()=>{
  for(const request_id of ['',4,'x'.repeat(257),'bad\u0000id'])assert.throws(()=>parseInput('sudo',{request_id}));
  assert.throws(()=>parseInput('clarify',{request_id:'c',question:'Q',choices:[{label:'not supported'}]}));
  assert.throws(()=>parseInput('clarify',{request_id:'c',questions:[{qid:'q',question:'A'},{qid:'q',question:'B'}]}));
});
test('batch clarify uses official per-question fields; cancel-all is an empty unscoped answer',()=>{
  const prompt=parseInput('clarify',{request_id:'c',questions:[{qid:'q1',question:'Choose',choices:['A','B'],multi_select:true},{qid:'q2',question:'Why?'}]});
  assert.equal(prompt.questions[0]?.multiple,true);
  assert.deepEqual(inputRpc(prompt,{value:'["A","B"]',questionId:'q1'},'live').params,{session_id:'live',request_id:'c',answer:'["A","B"]',question_id:'q1'});
  assert.throws(()=>inputRpc(prompt,{value:'answer'},'live'));
  assert.throws(()=>inputRpc(prompt,{value:'answer',questionId:'foreign'},'live'));
  assert.deepEqual(inputRpc(prompt,{value:''},'live').params,{session_id:'live',request_id:'c',answer:''});
});
test('sudo/secret responses are transient RPC values, not projection fields',()=>{
  for(const kind of ['sudo','secret'] as const){
    const prompt=parseInput(kind,{request_id:kind,prompt:'Provide value',env_var:'TEST_KEY',value:'never-keep',password:'never-keep'});
    const rpc=inputRpc(prompt,{value:'test-sensitive-value'},'live');
    assert.equal(rpc.params[kind==='sudo'?'password':'value'],'test-sensitive-value');
    assert.ok(!JSON.stringify(prompt).includes('test-sensitive-value'));assert.ok(!JSON.stringify(prompt).includes('never-keep'));
  }
});
test('expiry targets the exact request and late acknowledgement cannot reverse expiry',()=>{
  const a=new AgentActivity();for(const request_id of ['a','b'])a.receive(event('secret.request',{request_id}));
  a.status('secret:a','sending');a.receive(event('secret.expire',{request_id:'a'}));a.result('secret:a',{status:'ok'});
  assert.equal(a.state.inputs[0]?.status,'expired');assert.equal(a.state.inputs[1]?.status,'pending');
});
test('expired and unresolved results do not look like successful approval',()=>{
  const a=new AgentActivity();a.receive(event('approval.request',{request_id:'a',command:'x'}));a.status('approval:a','sending');a.result('approval:a',{resolved:0});
  assert.equal(a.state.inputs[0]?.status,'expired');
  a.receive(event('secret.request',{request_id:'s'}));a.status('secret:s','sending');a.result('secret:s',{status:'expired'});
  assert.equal(a.state.inputs.at(-1)?.status,'expired');
});
test('partial clarify acknowledgements respect remaining questions without retaining answers',()=>{
  const a=new AgentActivity();a.receive(event('clarify.request',{request_id:'c',questions:[{qid:'one',question:'One'},{qid:'two',question:'Two'}]}));
  a.status('clarify:c','sending');a.result('clarify:c',{status:'ok',remaining:['two']},'one');
  assert.equal(a.state.inputs[0]?.status,'pending');assert.deepEqual(a.state.inputs[0]?.answered,['one']);
  a.status('clarify:c','sending');a.result('clarify:c',{status:'ok',remaining:[]},'two');assert.equal(a.state.inputs[0]?.status,'answered');
});
test('settlement and reconnect snapshots cannot resurrect confirmed inputs',()=>{
  const a=new AgentActivity();const request={request_id:'a',command:'x'};a.receive(event('approval.request',request));a.status('approval:a','sending');a.result('approval:a',{resolved:1});
  a.snapshot({running:true,pending_approval:request});assert.equal(a.state.inputs[0]?.status,'answered');
  a.receive(event('sudo.request',{request_id:'s'}));a.disconnect();assert.equal(a.state.recoveryGap,true);
  a.snapshot({running:true});assert.equal(a.state.inputs.find(p=>p.id==='s')?.status,'unknown');
  a.snapshot({running:false});assert.equal(a.state.inputs.find(p=>p.id==='s')?.status,'expired');
});
test('pending approval and batch clarify are rehydrated only from their authoritative snapshots',()=>{
  const a=new AgentActivity();a.snapshot({running:true,pending_approval:{request_id:'a',command:'x'},pending_clarify:{request_id:'c',questions:[{qid:'q',question:'Q'}],answers:{q:'not retained'}}});
  assert.equal(a.state.inputs.length,2);assert.deepEqual(a.state.inputs[1]?.answered,['q']);assert.ok(!JSON.stringify(a.state).includes('not retained'));
});
test('stable tool identity, failed results, duration, and large output are bounded',()=>{
  const a=new AgentActivity();a.receive(event('tool.start',{tool_id:'t',name:'terminal',args:{command:'fixture',password:'hidden'}}));
  a.receive(event('tool.progress',{tool_id:'t',name:'terminal',text:'progress'}));
  a.receive(event('tool.complete',{tool_id:'t',name:'terminal',duration_s:1.2,result:{exit_code:1,output:'x'.repeat(60000)}}));
  assert.equal(a.state.tools.length,1);assert.equal(a.state.tools[0]?.state,'error');assert.equal(a.state.tools[0]?.duration,1.2);
  assert.ok(a.state.tools[0]!.output.length<=ACTIVITY_LIMITS.text);assert.equal(a.state.tools[0]?.truncated,true);assert.ok(!a.state.tools[0]?.input.includes('hidden'));
  a.receive(event('tool.start',{tool_id:'t',name:'terminal'}));assert.equal(a.state.tools[0]?.state,'error');
});
test('tool and reasoning event storms cannot grow the projection without bounds',()=>{
  const a=new AgentActivity();for(let n=0;n<200;n++)a.receive(event('tool.start',{tool_id:String(n),name:'fixture'}));
  assert.equal(a.state.tools.length,40);assert.equal(a.state.droppedTools,160);
  for(let n=0;n<100;n++)a.receive(event('reasoning.delta',{text:'x'.repeat(1000)}));
  assert.equal(a.state.reasoning.length,32768);assert.equal(a.state.truncated,true);
  a.receive(event('message.start',{}));assert.equal(a.state.tools.length,0);
});
test('unknown events are ignored; malformed known events are visibly flagged',()=>{
  const a=new AgentActivity();assert.equal(a.receive(event('new.unknown',{huge:'x'})),false);
  a.receive(event('secret.request',{}));assert.equal(a.state.malformed,true);assert.equal(a.state.inputs.length,0);
  const deep:{child?:unknown}={};deep.child=deep;assert.ok(displayValue(deep).length<1000);
});
