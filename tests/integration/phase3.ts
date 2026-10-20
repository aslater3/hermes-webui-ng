/**
 * Initial real Phase 3 gate: actual clarify tool lifecycle and pending-request recovery.
 *
 * Protocol changes from the legacy event-driven gate (upstream Hermes main c5a3c0f):
 * - The clarify question is observed as a native JSON-RPC server request in gateway.requests
 *   (PeerRequest kind 'clarify'), as client/NativeQuestions.tsx renders it. It is no longer read
 *   from session.activity.state.inputs, which upstream's clarify.request events no longer feed.
 * - Recovery: reconnect clears gateway.requests; the same request id is re-delivered by the
 *   open_requests hydrate of session.activate. The pre-reconnect PeerRequest object is retired,
 *   so the answer is sent with the re-hydrated object.
 * - Answer encoding follows NativeQuestions.tsx: a batch clarify is ONE respond with
 *   {answers: {qid: value}}; a multi-select value is the selected choices joined with '\n'
 *   (previously JSON.stringify(choices)). Upstream has no partial-batch acknowledgement, so the
 *   former 'native-partial-batch-acknowledgement' gate is renamed 'native-batch-answer-single-response'.
 * - Tool lifecycle still comes from tool.* events, which upstream still emits (contracts/events.py).
 * - The clarify fixture (phase3-model.ts) still matches upstream's clarify schema
 *   (questions[{question, choices, multi_select}], at most 4 choices); unchanged.
 */
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
const pin='c5a3c0f8767a72203363d249add14142dbcf3cc7';
const origin=process.env.PHASE0_ORIGIN??'http://127.0.0.1:8787';
const auth=browserAuth(origin),dashboard=new DashboardClient(origin,auth.fetcher);
const gateway=new GatewayClient(new WsAuthClient(dashboard,signal=>connection.verifyAdmission(signal)),{socketFactory:auth.socketFactory,heartbeatMs:0,requestTimeoutMs:45000});
const connection:ConnectionStore=new ConnectionStore(dashboard,gateway);
const session=new NativeSession(gateway),gates:string[]=[];
let success=false;
const deadline=setTimeout(()=>{console.error('Phase 3 tool gate deadline exceeded');process.exit(1);},120000);
async function until(check:()=>boolean,label:string){for(let i=0;i<450;i++){if(session.state.error)throw session.state.error;if(check())return;await new Promise(r=>setTimeout(r,100));}throw new Error(`Phase 3 gate timeout: ${label}`);}
// The open clarify request for this session, as NativeQuestions.tsx would render it.
const clarifyRequest=()=>gateway.requests.getSnapshot().find(row=>row.kind==='clarify'&&row.sessionId===session.state.runtimeId);
function passed(gate:string){gates.push(gate);console.log(`PASS phase3/${gate}`);}
try{
  assert.equal(process.env.HERMES_TEST_REF,pin);
  const username=process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME,password=process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD;assert.ok(username&&password);
  await connection.start();const provider=connection.providers.find(p=>p.supports_password);assert.ok(provider);
  await connection.login(provider.name,username,password);await session.create();
  await session.submit(`PHASE3_CLARIFY_${randomUUID()} Use the controlled clarification fixture.`);
  await until(()=>!!clarifyRequest(),'pending native clarification request');
  const request=clarifyRequest()!;
  assert.equal(request.sessionId,session.state.runtimeId);assert.equal(request.questions.length,2);assert.equal(request.questions[0]?.multiple,true);
  assert.ok(session.activity.state.tools.some(t=>t.name==='clarify'));passed('real-clarify-tool-and-batch-request');
  await gateway.reconnect();
  await until(()=>session.state.phase==='waiting'&&clarifyRequest()?.id===request.id,'authoritative pending recovery');
  passed('pending-clarify-recovered-after-reconnect');
  // Answer with the re-hydrated request; the pre-reconnect object was retired by the reconnect.
  const recovered=clarifyRequest()!;const [first,second]=recovered.questions;assert.ok(first&&second);
  // NativeQuestions.tsx: multi-select value = selected choices joined by '\n'; text answer = textarea value.
  gateway.requests.respond(recovered,{answers:{[first.id]:first.choices.join('\n'),[second.id]:'Controlled test completed'}});
  assert.equal(clarifyRequest(),undefined);
  passed('native-batch-answer-single-response');
  await until(()=>session.state.phase==='idle'&&session.state.messages.some(m=>m.role==='assistant'&&m.text.includes(EXPECTED_RESPONSE)),'tool result and settled turn');
  assert.equal(clarifyRequest(),undefined);
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
    scope:'Real native clarify tool and callback through gateway.requests; production WebUI container, unmodified Hermes, deterministic model. Gate native-partial-batch-acknowledgement renamed native-batch-answer-single-response: upstream has no partial-batch acknowledgement, so the batch is answered in one response.',
    remaining:['Real approval, sudo and secret acceptance','Broader tool/history and off-selection attention acceptance','Physical mobile/PWA gates']},null,2));
  session.dispose();connection.dispose();gateway.close();clearTimeout(deadline);
}
