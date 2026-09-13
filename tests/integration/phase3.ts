/** Initial real Phase 3 gate: actual clarify tool lifecycle and pending-request recovery. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { NativeSession } from '../../src/hermes/native-session.js';
import { WsAuthClient } from '../../src/hermes/ws-auth.js';
import { ConnectionStore } from '../../src/hermes/connection-store.js';
import { browserAuth } from '../helpers/browser-auth.js';
import { EXPECTED_RESPONSE } from './provider.js';
const pin='b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a';
const origin=process.env.PHASE0_ORIGIN??'http://127.0.0.1:8787';
const auth=browserAuth(origin),dashboard=new DashboardClient(origin,auth.fetcher);
const gateway=new GatewayClient(new WsAuthClient(dashboard,signal=>connection.verifyAdmission(signal)),{socketFactory:auth.socketFactory,heartbeatMs:0,requestTimeoutMs:45000});
const connection:ConnectionStore=new ConnectionStore(dashboard,gateway);
const session=new NativeSession(gateway),gates:string[]=[];
let success=false;
const deadline=setTimeout(()=>{console.error('Phase 3 tool gate deadline exceeded');process.exit(1);},120000);
async function until(check:()=>boolean,label:string){for(let i=0;i<450;i++){if(session.state.error)throw session.state.error;if(check())return;await new Promise(r=>setTimeout(r,100));}throw new Error(`Phase 3 gate timeout: ${label}`);}
function passed(gate:string){gates.push(gate);console.log(`PASS phase3/${gate}`);}
try{
  assert.equal(process.env.HERMES_TEST_REF,pin);
  const username=process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME,password=process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD;assert.ok(username&&password);
  await connection.start();const provider=connection.providers.find(p=>p.supports_password);assert.ok(provider);
  await connection.login(provider.name,username,password);await session.create();
  await session.submit(`PHASE3_CLARIFY_${randomUUID()} Use the controlled clarification fixture.`);
  await until(()=>session.activity.state.inputs.some(p=>p.kind==='clarify'&&p.status==='pending'),'pending native clarification');
  const request=session.activity.state.inputs.find(p=>p.kind==='clarify')!;
  assert.equal(request.questions.length,2);assert.equal(request.questions[0]?.multiple,true);
  assert.ok(session.activity.state.tools.some(t=>t.name==='clarify'));passed('real-clarify-tool-and-batch-request');
  await gateway.reconnect();await until(()=>session.state.phase==='waiting'&&session.activity.state.inputs.some(p=>p.id===request.id&&p.status==='pending'),'authoritative pending recovery');
  passed('pending-clarify-recovered-after-reconnect');
  const question=request.questions[0]!;assert.ok(question.id);
  await session.respond(request.key,JSON.stringify(question.choices),question.id);
  assert.equal(session.activity.state.inputs.find(p=>p.key===request.key)?.status,'pending');
  assert.ok(session.activity.state.inputs.find(p=>p.key===request.key)?.answered.includes(question.id));
  passed('native-partial-batch-acknowledgement');
  const second=request.questions[1]!;assert.ok(second.id);await session.respond(request.key,'Controlled test completed',second.id);
  await until(()=>session.state.phase==='idle'&&session.state.messages.some(m=>m.role==='assistant'&&m.text.includes(EXPECTED_RESPONSE)),'tool result and settled turn');
  assert.equal(session.activity.state.inputs.find(p=>p.key===request.key)?.status,'answered');
  assert.ok(session.activity.state.tools.some(t=>t.name==='clarify'&&t.state==='complete'));
  passed('confirmed-response-resumes-real-agent');
  const before=session.state.messages.filter(m=>m.role==='user').length;
  await session.submit('Acknowledge a normal turn after clarification without tools.');
  await until(()=>session.state.phase==='idle','subsequent normal turn');
  assert.equal(session.state.messages.filter(m=>m.role==='user').length,before+1);passed('next-turn-without-response-replay');
  success=true;
}catch(error){console.error(error instanceof Error?error.message:'Phase 3 tool gate failed');process.exitCode=1;}
finally{
  await mkdir('test-results/live',{recursive:true});await writeFile('test-results/live/phase3-tools.json',JSON.stringify({upstream:pin,commit:process.env.GITHUB_SHA??'local',success,gates,
    scope:'Real native clarify tool and callback; production WebUI container, unmodified Hermes, deterministic model.',
    remaining:['Real approval, sudo and secret acceptance','Broader tool/history and off-selection attention acceptance','Physical mobile/PWA gates']},null,2));
  session.dispose();connection.dispose();gateway.close();clearTimeout(deadline);
}
