import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatController, navigation, navigationRef } from '../../src/hermes/chat-controller.js';
import { HttpError } from '../../src/hermes/dashboard-client.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';
import type { GatewayEvent } from '../../src/hermes/protocol.js';
import type { HistoryPage } from '../../src/hermes/session-rest.js';
function fixture(options: { missingHistory?: boolean } = {}) {
  const state: ConnectionState = {phase:'ready', generation:1, attempt:0};
  const events = new Set<(event:GatewayEvent) => void>();
  let prompts=0, creates=0, resumed='';
  let resolvePrompt: ((value:unknown) => void) | undefined;
  const gateway = { state, onState: (cb:(state:ConnectionState)=>void) => { cb(state); return () => {}; },
    onEvent: (cb:(event:GatewayEvent)=>void) => { events.add(cb); return () => {events.delete(cb);}; },
    call: async (method:string, params:Record<string,unknown>={}) => {
      if(method==='session.create') { creates++; return {session_id:'live',stored_session_id:'draft',info:{profile_name:'owner'}}; }
      if(method==='session.resume') { resumed=String(params.session_id); return {session_id:'live',session_key:params.session_id,info:{profile_name:'owner'}}; }
      if(method==='session.history') return {messages:[]};
      if(method==='session.activate') return {running:false};
      if(method==='prompt.submit') { prompts++; return new Promise((r) => {resolvePrompt=r;}); }
      return {};
    } };
  const reader = {sessions:async()=>({rows:[],total:0,limit:20,offset:0}),searchSessions:async()=>[],
    sessionMessages:async (ref:{id:string}):Promise<HistoryPage>=>{
      if (options.missingHistory) throw new HttpError(404);
      return {id:ref.id,profile:'owner',messages:[],returned:0,offset:0,limit:100};
    }};
  const chat = new ChatController(reader,gateway); chat.setEnabled(true);
  return {chat, gateway, prompts:()=>prompts, creates:()=>creates, resumed:()=>resumed, finish:()=>resolvePrompt?.({})};
}
test('navigation encodes the owning profile and rejects path-shaped identifiers',()=>{
  const ref={id:'stored-id',profile:'owner & one'};
  assert.deepEqual(navigationRef(navigation(ref)),ref); assert.throws(()=>navigationRef('#session=..%2Fsecret'));
});
test('double send remains one RPC; late acknowledgement cannot clear another conversation draft',async()=>{
  const h=fixture(); await h.chat.create(); h.chat.setDraft('first draft');
  const pending=h.chat.send(); await h.chat.send(); assert.equal(h.prompts(),1);
  await h.chat.open({id:'other',profile:'owner'}); h.chat.setDraft('new selection draft'); h.finish(); await pending;
  assert.equal(h.chat.draft,'new selection draft'); assert.equal(h.chat.selected?.id,'other'); h.chat.dispose();
});
test('session browsing resolves canonical owning profile and never creates on resume',async()=>{
  const h=fixture(); await h.chat.open({id:'existing'});
  assert.equal(h.resumed(),'existing'); assert.equal(h.chat.selected?.profile,'owner'); assert.equal(h.creates(),0); h.chat.dispose();
});
test('ended API-server history without a durable session key stays read-only and never resumes',async()=>{
  const h=fixture(); await h.chat.browser.list();
  const row = { id:'api-ended', profile:'owner', title:'Ended API conversation', preview:'saved reply', source:'api_server',
    lastActive:1712345678, messageCount:415, endedAt:1712345680.5, endReason:'ws_orphan_reap' };
  h.chat.browser.index = { phase:'ready', rows:[row], query:'', offset:0, total:1, hasNext:false };
  await h.chat.open(row);
  assert.equal(h.resumed(),''); assert.equal(h.chat.browser.history.phase,'ready');
  assert.equal(h.chat.historical,true); assert.equal(h.chat.readOnly,true);
  await h.chat.latest(); assert.equal(h.resumed(),''); assert.equal(h.chat.historical,true); assert.equal(h.chat.readOnly,true);
  h.chat.dispose();
});
test('an empty native session can resume before Dashboard REST materialises its first transcript',async()=>{
  const h=fixture({missingHistory:true}); await h.chat.open({id:'empty-session',profile:'owner'});
  assert.equal(h.resumed(),'empty-session'); assert.equal(h.chat.selected?.id,'empty-session');
  assert.equal(h.chat.browser.history.phase,'empty'); assert.equal(h.creates(),0); h.chat.dispose();
});
test('drafts are per-selection transient memory and account clear removes them',async()=>{
  const h=fixture(); await h.chat.open({id:'one',profile:'owner'}); h.chat.setDraft('private');
  await h.chat.open({id:'two',profile:'owner'}); assert.equal(h.chat.draft,'');
  await h.chat.open({id:'one',profile:'owner'}); assert.equal(h.chat.draft,'private');
  h.chat.clear(); h.chat.setEnabled(true); await h.chat.open({id:'one',profile:'owner'}); assert.equal(h.chat.draft,''); h.chat.dispose();
});
test('read-only history never submits and disconnected browsing never creates a runtime',async()=>{
  const h=fixture(); h.gateway.state.phase='disconnected'; await h.chat.open({id:'existing'});
  assert.equal(h.resumed(),''); assert.equal(h.chat.browser.history.phase,'ready'); h.chat.setDraft('not sent'); await h.chat.send();
  assert.equal(h.prompts(),0); h.chat.dispose();
});
