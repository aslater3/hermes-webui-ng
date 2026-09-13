import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { NativeSession } from '../../src/hermes/native-session.js';
import { startFixture } from '../fixtures/dashboard.js';
import { browserAuth } from '../helpers/browser-auth.js';
async function setup(t:TestContext,scenario:string){
  const fixture=await startFixture();
  const config=loadConfig({HERMES_DASHBOARD_URL:fixture.origin,PUBLIC_ORIGIN:'http://127.0.0.1:1'});
  const logs:unknown[]=[];const app=createApp(config,event=>logs.push(event));
  await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const address=app.server.address();assert.ok(address&&typeof address!=='string');
  const origin=`http://127.0.0.1:${address.port}`;config.publicOrigin=new URL(origin);
  const auth=browserAuth(origin),dashboard=new DashboardClient(origin,auth.fetcher),gateway=new GatewayClient(dashboard,{socketFactory:auth.socketFactory,heartbeatMs:0,retryBaseMs:10});
  const session=new NativeSession(gateway);
  t.after(async()=>{session.dispose();gateway.close();await app.close();await fixture.close();});
  await dashboard.login('basic','fixture','fixture-password');await gateway.connect();await session.create();await session.submit(`[agent-test] ${scenario}`);
  return {session,gateway,fixture,logs};
}
async function until(check:()=>boolean){for(let i=0;i<250;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Fixture condition timeout');}
test('synthetic agent wire: approval, batch clarify, sudo and secret responses settle once each',async(t)=>{
  const h=await setup(t,'');const next=async(kind:string)=>{await until(()=>h.session.activity.state.inputs.some(p=>p.kind===kind&&p.status==='pending'));return h.session.activity.state.inputs.find(p=>p.kind===kind&&p.status==='pending')!;};
  await h.session.respond((await next('approval')).key,'once');
  const clarify=await next('clarify');await h.session.respond(clarify.key,'["Blue","Green"]','colour');
  assert.deepEqual(h.session.activity.state.inputs.find(p=>p.key===clarify.key)?.answered,['colour']);
  await h.session.respond(clarify.key,'fixture answer','note');
  await h.session.respond((await next('sudo')).key,'ONLY_FIXTURE_PASSWORD');await h.session.respond((await next('secret')).key,'ONLY_FIXTURE_SECRET');
  await until(()=>h.session.state.phase==='idle');assert.equal(h.session.state.messages.at(-1)?.text,'SYNTHETIC_AGENT_COMPLETE');
  assert.deepEqual(h.fixture.interactions.responseCounts,{approval:1,clarify:2,sudo:1,secret:1});
  assert.equal(h.session.activity.state.tools[0]?.state,'complete');
  for(const value of ['ONLY_FIXTURE_PASSWORD','ONLY_FIXTURE_SECRET','fixture answer']){
    assert.ok(!JSON.stringify(h.session.state).includes(value));assert.ok(!JSON.stringify(h.session.activity.state).includes(value));assert.ok(!JSON.stringify(h.logs).includes(value));
  }
});
test('synthetic agent wire: reconnect recovers pending approval and denial never repeats a tool',async(t)=>{
  const h=await setup(t,'approval');const key=h.session.activity.state.inputs[0]!.key;
  h.fixture.disconnect();await until(()=>h.fixture.metrics.upgrades===2&&h.session.state.phase==='waiting');
  await h.session.respond(key,'deny');await until(()=>h.session.state.phase==='idle');
  assert.equal(h.session.state.messages.at(-1)?.text,'Operation denied');assert.equal(h.fixture.interactions.responseCounts.approval,1);
});
test('synthetic agent wire: credential expiry and reconnect gap disable further response admission',async(t)=>{
  const h=await setup(t,'secret');const key=h.session.activity.state.inputs[0]!.key;
  h.fixture.disconnect();await until(()=>h.fixture.metrics.upgrades===2&&h.session.state.phase==='waiting');
  await assert.rejects(h.session.respond(key,'NOT_RESENT'));assert.equal(h.session.activity.state.recoveryGap,true);
  await h.session.interrupt();await until(()=>h.session.state.phase==='idle');assert.equal(h.fixture.interactions.responseCounts.secret,0);
});
