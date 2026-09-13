/** Real Phase 2 chat acceptance. All state is accessed through supported REST/RPC. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { WsAuthClient } from '../../src/hermes/ws-auth.js';
import { ConnectionStore } from '../../src/hermes/connection-store.js';
import { ChatController } from '../../src/hermes/chat-controller.js';
import { ClientError, record } from '../../src/hermes/protocol.js';
import type { SessionRef } from '../../src/hermes/session-rest.js';
import { browserAuth } from '../helpers/browser-auth.js';
import { EXPECTED_RESPONSE } from './provider.js';
const pin = 'b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a';
const origin = process.env.PHASE0_ORIGIN ?? 'http://127.0.0.1:8787';
const auth = browserAuth(origin);
const dashboard = new DashboardClient(origin, auth.fetcher);
const gateway = new GatewayClient(new WsAuthClient(dashboard, (signal) => connection.verifyAdmission(signal)),
  {socketFactory:auth.socketFactory,heartbeatMs:0,requestTimeoutMs:45000});
const connection: ConnectionStore = new ConnectionStore(dashboard,gateway);
let chat = new ChatController(dashboard,gateway);
connection.onIdentityBoundary(() => chat.clear());
const gates: string[] = [];
const terminal: string[] = [];
gateway.onEvent((event) => {
  if (event.type==='message.complete') {
    const status=record(event.payload).status;
    if (status==='complete'||status==='interrupted'||status==='error') terminal.push(status);
  }
});
const deadline = setTimeout(()=>{console.error('Phase 2 acceptance deadline exceeded');process.exit(1);},180000);
let success=false;
function passed(gate:string){gates.push(gate);console.log(`PASS phase2/${gate}`);}
async function until(check:()=>boolean|Promise<boolean>,label:string):Promise<void>{
  for(let i=0;i<600;i++){
    if(chat.error)throw chat.error;
    if(chat.native.state.phase==='error')throw chat.native.state.error??new Error('Native session failed');
    if(await check())return;
    await new Promise((resolve)=>setTimeout(resolve,100));
  }
  throw new Error(`Phase 2 gate timeout: ${label}`);
}
async function turn(text:string):Promise<void>{
  chat.setDraft(text);await chat.send();
  await until(()=>chat.native.state.phase==='idle'&&chat.native.state.messages.some(
    (message)=>message.role==='assistant'&&message.text.includes(EXPECTED_RESPONSE)),'prompt completion');
  assert.equal(chat.draft,'');
}
try{
  assert.equal(process.env.HERMES_TEST_REF,pin);
  const username=process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME,password=process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD;
  assert.ok(username&&password);
  await connection.start();
  const provider=connection.providers.find((item)=>item.supports_password);assert.ok(provider);
  await connection.login(provider.name,username,password);chat.setEnabled(true);
  assert.equal(gateway.state.phase,'ready');
  const marker=`P2${randomUUID().replaceAll('-','')}`;
  await chat.create();assert.ok(chat.selected);
  await turn(`Please acknowledge ${marker}A without using tools.`);
  const first:SessionRef={...chat.selected};
  await chat.create();await turn(`Please acknowledge ${marker}B without using tools.`);
  const second:SessionRef={...chat.selected!};assert.notEqual(first.id,second.id);
  passed('two-native-conversations');
  const listed=await dashboard.sessions({profile:first.profile,limit:100});
  assert.ok(listed.rows.some((row)=>row.id===first.id));assert.ok(listed.rows.some((row)=>row.id===second.id));
  const found=await dashboard.searchSessions(marker+'A',first.profile);
  assert.ok(found.some((row)=>row.id===first.id));
  const rest=await dashboard.sessionMessages(first);
  assert.equal(rest.id,first.id);assert.ok(rest.profile);
  assert.ok(rest.messages.some((message)=>message.text.includes(marker+'A')));
  assert.ok(!rest.messages.some((message)=>message.text.includes(marker+'B')));
  const older=await dashboard.sessionMessages(first,100);assert.equal(older.returned,0);
  passed('official-rest-list-search-history-and-offset');
  await chat.open(first);assert.equal(chat.native.state.phase,'idle');
  await turn(`Please acknowledge ${marker}C without using tools.`);
  assert.equal(chat.native.state.messages.filter((message)=>message.role==='user'&&message.text.includes(marker+'A')).length,1);
  assert.ok(!chat.native.state.messages.some((message)=>message.text.includes(marker+'B')));
  passed('selection-isolation-and-repeated-turn');
  connection.disconnect();await chat.open(first);
  assert.equal(chat.native.state.runtimeId,undefined);assert.equal(chat.browser.history.phase,'ready');
  assert.ok(chat.browser.history.page?.messages.some((message)=>message.text.includes(marker+'C')));
  await connection.start();await until(()=>chat.native.state.phase==='idle','read-only reattachment');
  passed('read-only-history-and-native-reattachment');
  chat.dispose();chat=new ChatController(dashboard,gateway);chat.setEnabled(true);await chat.open(first);
  assert.ok(chat.native.state.messages.some((message)=>message.text.includes(marker+'C')));
  passed('fresh-controller-authoritative-resume');
  const terminalBefore=terminal.length;
  chat.setDraft(`PHASE2_HOLD_${marker} Please acknowledge this controlled cancellation test. Do not use tools.`);
  await chat.send();
  await until(async()=>{
    const response=await fetch('http://127.0.0.1:9120/health',{signal:AbortSignal.timeout(2000)});
    const data=record(await response.json());return typeof data.activeHolds==='number'&&data.activeHolds>0;
  },'model request in flight');
  assert.equal(chat.native.state.phase,'running');
  await Promise.all([chat.interrupt(),chat.interrupt()]);
  await until(()=>chat.native.state.phase==='idle','interruption settlement');
  assert.ok(terminal.slice(terminalBefore).includes('interrupted'),'Hermes must confirm the interrupted outcome');
  passed('real-inflight-turn-interrupted-and-settled');
  await turn(`Please acknowledge ${marker}D after interruption without using tools.`);
  const recovered=await dashboard.sessionMessages(first);
  assert.equal(recovered.messages.filter((message)=>message.role==='user'&&message.text.includes(marker+'D')).length,1);
  passed('subsequent-turn-after-interruption-without-replay');
  await connection.logout();assert.equal(chat.selected,undefined);assert.equal(chat.draft,'');
  passed('account-boundary-clears-browser-chat-state');success=true;
}catch(error){
  console.error(error instanceof ClientError?`${error.kind}: ${error.message}`:error instanceof Error?error.message:'Phase 2 acceptance failed');process.exitCode=1;
}finally{
  chat.dispose();connection.dispose();clearTimeout(deadline);
  await mkdir('test-results/live',{recursive:true});
  await writeFile('test-results/live/phase2.json',JSON.stringify({upstream:pin,commit:process.env.GITHUB_SHA??'local',phase:2,success,gates,terminalOutcomes:terminal},null,2));
}
