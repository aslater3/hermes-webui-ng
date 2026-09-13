import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionStore } from '../../src/hermes/connection-store.js';
import { ClientError } from '../../src/hermes/protocol.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';
test('account boundaries disable authenticated browsing before reset subscribers run',async()=>{
  let expired=false;
  const state:ConnectionState={phase:'disconnected',generation:0,attempt:0};
  const listeners=new Set<(state:ConnectionState)=>void>();
  const gateway={state,onState:(cb:(state:ConnectionState)=>void)=>{listeners.add(cb);return()=>{listeners.delete(cb);};},
    close:()=>{},connect:async()=>({}),suspend:()=>{},ensureLive:async()=>{},advertised:()=>({}),telemetry:()=>({})};
  const dashboard={status:async()=>({auth_required:true}),providers:async()=>[],
    me:async()=>{if(expired)throw new ClientError('auth-required','Expired');return {user_id:'one',provider:'basic'};},
    login:async()=>({user_id:'one',provider:'basic'}),logout:async()=>{expired=true;},
    schema:async()=>({openapi:'3.1.0',paths:{}}),capabilities:async()=>({schemaVersion:1,features:{pwa:false},workspace:{available:false}})};
  const store=new ConnectionStore(dashboard,gateway);await store.start();assert.equal(store.state.auth,'signed-in');
  let boundaries=0;store.onIdentityBoundary(()=>{boundaries++;assert.notEqual(store.state.auth,'signed-in');});
  await store.logout();assert.equal(boundaries,1);assert.equal(store.state.auth,'signed-out');store.dispose();
});
