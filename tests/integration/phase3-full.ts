/** Actual Hermes tools/callbacks, never imported or mocked. The WebUI uses only public RPC/REST. */
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { WsAuthClient } from '../../src/hermes/ws-auth.js';
import { ConnectionStore } from '../../src/hermes/connection-store.js';
import { NativeSession } from '../../src/hermes/native-session.js';
import { SessionAttention } from '../../src/hermes/session-attention.js';
import { ClientError } from '../../src/hermes/protocol.js';
import { browserAuth } from '../helpers/browser-auth.js';
const pin = 'b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a';
const mode = process.env.HERMES_M3_MODE, lab = process.env.HERMES_M3_LAB!;
const auth = browserAuth('http://127.0.0.1:8790'), dashboard = new DashboardClient('http://127.0.0.1:8790', auth.fetcher);
const gateway = new GatewayClient(new WsAuthClient(dashboard, signal => connection.verifyAdmission(signal)), { socketFactory: auth.socketFactory, heartbeatMs: 0 });
const connection: ConnectionStore = new ConnectionStore(dashboard, gateway);
const attention = new SessionAttention(gateway, 1000);
let session = new NativeSession(gateway), success = false, stage = 'start';
const gates: string[] = [], kinds: string[] = [];
const password = process.env.HERMES_M3_PASSWORD!, secret = process.env.HERMES_M3_SECRET!;
const deadline = setTimeout(() => { console.error('M3 native acceptance deadline'); process.exit(1); }, 240000);
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
const pending = (kind: string) => session.activity.state.inputs.find(input => input.kind === kind && input.status === 'pending');
const exists = (path: string) => access(path).then(() => true, () => false);
function pass(name: string) { gates.push(name); console.log(`PASS m3/${mode}/${name}`); }
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 900; i++) {
    if (session.state.error) throw session.state.error;
    if (check()) return;
    await pause();
  }
  throw new Error(`M3 timeout: ${label}`);
}
async function fresh(prompt: string) {
  stage = prompt; session.dispose(); session = new NativeSession(gateway); await session.create();
  attention.bind(session.state.runtimeId!, { id: session.state.storedId!, profile: session.state.profile });
  await session.submit(prompt);
}
async function settled() { await until(() => session.state.phase === 'idle', stage); }
async function approveIfPresent() {
  for (let i = 0; i < 400; i++) {
    const request = pending('approval');
    if (request) { await session.respond(request.key, 'once'); return; }
    if (pending('sudo') || session.state.phase === 'idle') return;
    await pause();
  }
}
gateway.onEvent(event => { if (event.type.endsWith('.request')) kinds.push(event.type); });
try {
  assert.equal(process.env.HERMES_TEST_REF, pin); assert.match(lab, /^\/tmp\/hermes-m3-[A-Za-z0-9]+$/); assert.ok(password && secret);
  await connection.start();
  if (!connection.hasAccess) await connection.login(connection.providers.find(p => p.supports_password)!.name,
    process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME!, process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD!);
  assert.equal(gateway.state.phase, 'ready'); attention.setEnabled(true);
  await fresh('M3_APPROVAL_ALLOW'); await until(() => !!pending('approval'), stage);
  const approval = pending('approval')!;
  await gateway.reconnect(); await until(() => !!pending('approval') && session.state.phase === 'waiting', 'approval recovery');
  await attention.refresh(); assert.ok(attention.items.some(item => item.runtimeId === session.state.runtimeId && item.status === 'waiting'));
  await session.respond(approval.key, 'once'); await settled(); assert.equal(await exists(`${lab}/allow-target`), false);
  await assert.rejects(session.respond(approval.key, 'once')); pass('real-approval-recovery-allow-once-and-command-effect');
  await fresh('M3_APPROVAL_DENY'); await until(() => !!pending('approval'), stage);
  await session.respond(pending('approval')!.key, 'deny'); await settled(); assert.equal(await exists(`${lab}/deny-target/canary`), true);
  pass('real-approval-denial-prevents-command');
  await fresh('M3_APPROVAL_EXPIRE'); await until(() => !!pending('approval'), stage);
  const expiry = pending('approval')!.key; await settled(); assert.equal(await exists(`${lab}/expire-target/canary`), true);
  assert.equal(session.activity.state.inputs.find(input => input.key === expiry)?.status, 'expired');
  await assert.rejects(session.respond(expiry, 'once')); pass('real-approval-expiry-fails-closed');
  await fresh('M3_SUDO'); await approveIfPresent(); await until(() => !!pending('sudo'), stage);
  await session.respond(pending('sudo')!.key, password); await settled();
  assert.ok(session.activity.state.tools.some(tool => tool.name === 'terminal' && /(?:\\n|\n|\s|\")0(?:\\n|\n|\s|\")/.test(tool.output)), 'Real sudo command must return root UID');
  pass('native-sudo-password-runs-restricted-id-command');
  await fresh('M3_SUDO_SKIP'); await approveIfPresent(); await until(() => !!pending('sudo'), stage);
  const lostSudo = pending('sudo')!.key;
  await gateway.reconnect(); await until(() => session.state.phase === 'waiting', 'sudo reconnect');
  assert.equal(session.activity.state.inputs.find(input => input.key === lostSudo)?.status, 'unknown');
  await assert.rejects(session.respond(lostSudo, password));
  await session.interrupt(); await settled();
  pass('lost-sudo-request-cannot-replay-and-can-be-interrupted-in-webui');
  await fresh('M3_SUDO_SKIP'); await approveIfPresent(); await until(() => !!pending('sudo'), stage);
  await session.respond(pending('sudo')!.key, ''); await settled(); pass('native-sudo-skip-settles-without-password');
  await fresh('M3_SECRET'); await until(() => !!pending('secret'), stage);
  const capture = pending('secret')!; assert.equal(capture.envVar, 'HERMES_M3_CAPTURE_KEY');
  await session.respond(capture.key, secret); await settled();
  assert.ok(session.activity.state.tools.some(tool => tool.name === 'skill_view' && /available/.test(tool.output)));
  pass('native-secret-capture-completes-skill-setup');
  const before = kinds.filter(kind => kind === 'secret.request').length;
  await fresh('M3_SECRET_CHECK'); await settled();
  assert.equal(kinds.filter(kind => kind === 'secret.request').length, before);
  assert.ok(session.activity.state.tools.some(tool => tool.name === 'skill_view' && /available/.test(tool.output)));
  pass('fresh-native-session-observes-stored-secret-without-webui-filesystem-access');
  await fresh('M3_SECRET_SKIP'); await until(() => !!pending('secret'), stage);
  const lostSecret = pending('secret')!.key;
  await gateway.reconnect(); await until(() => session.state.phase === 'waiting', 'secret reconnect');
  assert.equal(session.activity.state.inputs.find(input => input.key === lostSecret)?.status, 'unknown');
  await assert.rejects(session.respond(lostSecret, secret));
  await session.interrupt(); await settled();
  pass('lost-secret-request-cannot-replay-and-can-be-interrupted-in-webui');
  await fresh('M3_SECRET_SKIP'); await until(() => !!pending('secret'), stage);
  await session.respond(pending('secret')!.key, ''); await settled();
  assert.ok(session.activity.state.tools.some(tool => tool.name === 'skill_view' && /setup_skipped/.test(tool.output)));
  pass('native-secret-skip-is-explicit-and-settles');
  const beforeTurns = session.state.messages.filter(message => message.role === 'user').length;
  await session.submit('A normal turn after native interactive workflows.'); await settled();
  assert.equal(session.state.messages.filter(message => message.role === 'user').length, beforeTurns + 1);
  const observable = JSON.stringify([session.state, session.activity.state, session.activity.archive, connection.report(), attention.items]);
  assert.ok(!observable.includes(password)); assert.ok(!observable.includes(secret));
  pass('subsequent-turn-and-no-credential-values-in-client-state-or-report'); success = true;
} catch (error) {
  console.error(`M3 stage ${stage}: ${error instanceof ClientError ? `${error.kind}/${error.rpcCode ?? 'none'}` : error instanceof Error ? error.message : 'failed'}`);
  process.exitCode = 1;
} finally {
  await mkdir('test-results/live', { recursive: true });
  await writeFile(`test-results/live/phase3-full-${mode}.json`, JSON.stringify({ upstream: pin, commit: process.env.GITHUB_SHA, mode, success, stage, gates,
    requestKinds: [...new Set(kinds)], tools: session.activity.state.tools.map(tool => ({ name: tool.name, state: tool.state })),
    boundary: 'Unmodified Hermes; actual approval gate, restricted sudo account and external fixture skill. Model endpoint deterministic. No operator host or Hermes-file inspection.' }, null, 2));
  session.dispose(); attention.dispose(); connection.dispose(); clearTimeout(deadline);
}
