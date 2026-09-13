import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeSession } from '../../src/hermes/native-session.js';
import { ClientError, type GatewayEvent } from '../../src/hermes/protocol.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';
class Wire {
  state:ConnectionState={phase:'ready',generation:1,attempt:0};
  events=new Set<(event:GatewayEvent)=>void>(); states=new Set<(state:ConnectionState)=>void>();
  running=true; pending:Record<string,unknown>={}; calls:{method:string;params:Record<string,unknown>}[]=[];
  reply:()=>Promise<unknown>=async()=>({status:'ok'});
  call=async(method:string,params:Record<string,unknown>={}):Promise<unknown>=>{
    this.calls.push({method,params:structuredClone(params)});
    if(method==='session.create'||method==='session.resume')return {session_id:'live',stored_session_id:'saved'};
    if(method==='session.history')return {messages:[]};
    if(method==='session.activate')return {running:this.running,status:this.running?'waiting':'idle',...this.pending};
    if(method.endsWith('.respond'))return this.reply();
    return {};
  };
  onEvent=(fn:(event:GatewayEvent)=>void)=>{this.events.add(fn);return()=>{this.events.delete(fn);};};
  onState=(fn:(state:ConnectionState)=>void)=>{this.states.add(fn);fn(this.state);return()=>{this.states.delete(fn);};};
  emit(type:string,payload:unknown,session_id='live'){this.events.forEach(fn=>fn({type,payload,session_id}));}
  phase(phase:ConnectionState['phase']){this.state={...this.state,phase,generation:this.state.generation+1};this.states.forEach(fn=>fn(this.state));}
}
const tick=()=>new Promise<void>(r=>setTimeout(r,0));
test('one masked response uses the current runtime and cannot be double-submitted',async()=>{
  const w=new Wire(),s=new NativeSession(w);await s.create();w.emit('sudo.request',{request_id:'s'});await tick();
  let done!:(value:unknown)=>void;w.reply=()=>new Promise(r=>{done=r;});
  const p=s.respond('sudo:s','fixture-only-password');await assert.rejects(s.respond('sudo:s','duplicate'));
  assert.equal(w.calls.filter(c=>c.method==='sudo.respond').length,1);
  assert.deepEqual(w.calls.find(c=>c.method==='sudo.respond')?.params,{session_id:'live',request_id:'s',password:'fixture-only-password'});
  assert.ok(!JSON.stringify(s.activity.state).includes('fixture-only-password'));
  done({status:'ok'});await p;assert.equal(s.activity.state.inputs[0]?.status,'answered');s.dispose();
});
test('selection change and old request handlers cannot send into a new session',async()=>{
  const w=new Wire(),s=new NativeSession(w);await s.create();w.emit('secret.request',{request_id:'old'});await tick();
  await s.resume('other');await assert.rejects(s.respond('secret:old','value'));
  w.emit('secret.request',{request_id:'foreign'},'wrong-live');assert.equal(s.activity.state.inputs.length,0);
  s.dispose();await assert.rejects(s.respond('secret:old','value'));assert.equal(w.calls.filter(c=>c.method==='secret.respond').length,0);
});
test('disconnect invalidates pending admission and never replays a response',async()=>{
  const w=new Wire(),s=new NativeSession(w);await s.create();w.emit('secret.request',{request_id:'s'});await tick();
  let reject!:(e:unknown)=>void;w.reply=()=>new Promise((_r,j)=>{reject=j;});
  const p=s.respond('secret:s','value');const rejected=assert.rejects(p);w.phase('disconnected');reject(new ClientError('network','lost'));await rejected;
  await assert.rejects(s.respond('secret:s','value'));w.phase('ready');await tick();await tick();
  assert.equal(s.activity.state.inputs[0]?.status,'unknown');assert.equal(w.calls.filter(c=>c.method==='secret.respond').length,1);s.dispose();
});
test('expiry during acknowledgement and missing RPC support stay terminal',async()=>{
  const w=new Wire(),s=new NativeSession(w);await s.create();w.emit('sudo.request',{request_id:'s'});await tick();
  let done!:(v:unknown)=>void;w.reply=()=>new Promise(r=>{done=r;});const p=s.respond('sudo:s','value');
  w.emit('sudo.expire',{request_id:'s'});done({status:'ok'});await p;assert.equal(s.activity.state.inputs[0]?.status,'expired');
  w.emit('secret.request',{request_id:'n'});await tick();w.reply=async()=>{throw new ClientError('rpc','Not supported',-32601);};
  await assert.rejects(s.respond('secret:n','value'));assert.equal(s.activity.state.inputs.find(p=>p.id==='n')?.status,'unsupported');s.dispose();
});
test('authoritative pending clarify survives refresh without leaking confirmed answer text',async()=>{
  const w=new Wire();w.pending={pending_clarify:{request_id:'c',questions:[{qid:'one',question:'One'},{qid:'two',question:'Two'}]}};
  const s=new NativeSession(w);await s.create();w.reply=async()=>{
    w.pending={pending_clarify:{request_id:'c',questions:[{qid:'one',question:'One'},{qid:'two',question:'Two'}],answers:{one:'sensitive answer'}}};
    return {status:'ok',remaining:['two']};
  };
  await s.respond('clarify:c','sensitive answer','one');assert.equal(s.activity.state.inputs[0]?.status,'pending');
  assert.deepEqual(s.activity.state.inputs[0]?.answered,['one']);assert.ok(!JSON.stringify(s.activity.state).includes('sensitive answer'));s.dispose();
});
