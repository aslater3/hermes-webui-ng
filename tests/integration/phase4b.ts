/** Session settings on unmodified Hermes through the actual WebUI container. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { NativeSession } from '../../src/hermes/native-session.js';
import { WsAuthClient } from '../../src/hermes/ws-auth.js';
import { ConnectionStore } from '../../src/hermes/connection-store.js';
import { sessionUsage } from '../../src/hermes/session-usage.js';
import { modelCatalogue, profileCatalogue } from '../../src/hermes/model-catalog.js';
import { record, ClientError } from '../../src/hermes/protocol.js';
import { browserAuth } from '../helpers/browser-auth.js';
import { EXPECTED_RESPONSE } from './provider.js';
import { rpcFailureKind } from '../helpers/rpc-failure-kind.js';
const pin = 'b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a';
const local = process.env.PHASE4B_LOCAL === 'true';
const origin = local ? 'http://127.0.0.1:8789' : 'http://127.0.0.1:8787';
const auth = browserAuth(origin), gates: string[] = [];
const failures: { stage: string; code: number; kinds: string[] }[] = [];
let stage = 'connect';
function client() {
  const dashboard = new DashboardClient(origin, auth.fetcher);
  const gateway = new GatewayClient(new WsAuthClient(dashboard, signal => connection.verifyAdmission(signal)), {
    socketFactory: (url, protocols) => {
      const socket = auth.socketFactory(url, protocols);
      socket.addEventListener('message', event => {
        const failure = rpcFailureKind(event.data);
        if (failure) { failures.push({ stage, ...failure }); if (failures.length > 16) failures.shift(); }
      });
      return socket;
    }, heartbeatMs: 0, requestTimeoutMs: 45_000,
  });
  const connection: ConnectionStore = new ConnectionStore(dashboard, gateway);
  const session = new NativeSession(gateway);
  return { gateway, connection, session, dispose: () => { session.dispose(); connection.dispose(); } };
}
let current = client(), success = false;
const otherSessions: NativeSession[] = [];
const deadline = setTimeout(() => { console.error('Settings gate deadline exceeded'); process.exit(1); }, 150_000);
function pass(gate: string) { gates.push(gate); console.log(`PASS phase4b/${local ? 'local' : 'gated'}/${gate}`); }
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 450; i++) {
    if (current.session.state.error) throw current.session.state.error;
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Settings acceptance condition timed out');
}
async function connect() {
  await current.connection.start();
  if (!local && !current.connection.hasAccess) {
    const name = current.connection.providers.find(provider => provider.supports_password)?.name;
    const username = process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME, password = process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD;
    assert.ok(name && username && password);
    await current.connection.login(name, username, password);
  }
  assert.equal(current.gateway.state.phase, 'ready');
}
try {
  assert.equal(process.env.HERMES_TEST_REF, pin);
  await connect();
  const profiles = profileCatalogue(await current.gateway.call('profiles.list', { include_sessions: false }));
  assert.ok(profiles.some(profile => profile.name === 'default'));
  const defaults = modelCatalogue(await current.gateway.call('model.options', {}));
  const reasoningDefault = record(await current.gateway.call('config.get', { key: 'reasoning' }));
  await current.session.create('default');
  const initial = current.session.state.agent;
  assert.equal(initial?.model, 'phase0-fixture');
  const inventory = modelCatalogue(await current.gateway.call('model.options', {
    session_id: current.session.state.runtimeId, profile: 'default', refresh: true,
  }));
  const alternate = inventory.choices.find(row => row.model === 'phase0-fixture-alternate');
  assert.ok(alternate, 'Controlled alternate model must be advertised by vanilla Hermes');
  pass('native-profiles-and-configured-model-inventory');
  stage = 'change-model';
  await current.session.settings.changeModel(alternate);
  assert.equal(current.session.settings.state.outcome, 'applied');
  assert.equal(current.session.state.agent?.model, alternate.model);
  pass('native-model-change-confirmed');
  stage = 'change-reasoning';
  await current.session.settings.changeReasoning('high');
  assert.equal(current.session.settings.state.outcome, 'applied');
  assert.equal(current.session.state.agent?.reasoningEffort, 'high');
  pass('confirmed-session-model-and-reasoning-effort');
  stage = 'isolation-and-recovery';
  const after = modelCatalogue(await current.gateway.call('model.options', {}));
  assert.equal(after.model, defaults.model); assert.equal(after.provider, defaults.provider);
  assert.deepEqual(record(await current.gateway.call('config.get', { key: 'reasoning' })), reasoningDefault);
  const second = new NativeSession(current.gateway); otherSessions.push(second); await second.create('default');
  assert.equal(second.state.agent?.model, initial?.model);
  assert.equal(second.state.agent?.reasoningEffort, initial?.reasoningEffort);
  pass('profile-defaults-and-second-session-unchanged');
  const prompt = 'Acknowledge this controlled model-selection test without using tools.';
  const key = current.session.state.storedId!;
  await current.session.submit(prompt);
  await until(() => current.session.state.phase === 'idle' && current.session.state.messages.some(message => message.text.includes(EXPECTED_RESPONSE)));
  const health = record(await (await fetch('http://127.0.0.1:9120/health')).json());
  assert.ok(Array.isArray(health.selections));
  assert.ok(health.selections.some(selection => record(selection).model === alternate.model));
  pass('real-agent-request-uses-selected-model');
  const usage = sessionUsage(await current.gateway.call('session.usage', { session_id: current.session.state.runtimeId }));
  assert.ok(usage && (usage.calls ?? 0) > 0 && (usage.total ?? 0) > 0, 'Real Hermes reports completed-call counters');
  await current.session.refresh();
  assert.deepEqual(current.session.state.usage, usage, 'Native info projection matches the official usage RPC');
  assert.equal(second.state.usage?.total ?? 0, 0, 'The untouched second session does not inherit usage');
  pass('phase7-native-usage-context-and-session-isolation');
  stage = 'phase7-native-commands';
  const beforeHistory = JSON.stringify(current.session.state.messages);
  await current.session.commands.load();
  const nativeChoices = current.session.commands.state.catalogue?.choices;
  for (const command of ['/usage', '/status', '/history']) {
    assert.ok(nativeChoices?.some(choice => choice.name === command && choice.action === 'native'), `Hermes advertises ${command}`);
    await current.session.commands.execute(command);
    assert.equal(current.session.commands.state.result?.command, command);
    assert.ok(current.session.commands.state.result?.output.length);
    if (command === '/usage') assert.ok(current.session.commands.state.result?.output.includes('Session Token Usage'));
    if (command === '/history') assert.ok(current.session.commands.state.result?.output.includes(prompt));
  }
  for (const command of ['/usage reset', '/phase7-unknown'])
    await assert.rejects(current.session.commands.execute(command));
  await current.session.commands.execute('/model other --global');
  assert.ok(current.session.commands.state.confirmation);
  current.session.commands.cancelConfirmation();
  await current.session.refresh();
  assert.equal(JSON.stringify(current.session.state.messages), beforeHistory, 'Read-only commands add no model turn or transcript row');
  const afterCommands = modelCatalogue(await current.gateway.call('model.options', {}));
  assert.equal(afterCommands.model, defaults.model); assert.equal(afterCommands.provider, defaults.provider);
  assert.deepEqual(record(await current.gateway.call('config.get', { key: 'reasoning' })), reasoningDefault);
  await second.commands.execute('/history');
  assert.ok(!second.commands.state.result?.output.includes(prompt), 'A second native session cannot read the selected session history');
  await current.session.commands.execute('/usage');
  pass('phase7-native-catalogue-readonly-dispatch-no-prompt-fallback-and-isolation');
  await current.gateway.reconnect();
  assert.equal(current.session.commands.state.result, undefined);
  assert.equal(current.session.commands.state.catalogue, undefined);
  await until(() => current.session.state.phase === 'idle');
  assert.equal(current.session.state.agent?.model, alternate.model);
  assert.equal(current.session.state.agent?.reasoningEffort, 'high');
  assert.equal(current.session.state.messages.filter(message => message.role === 'user' && message.text === prompt).length, 1);
  assert.deepEqual(current.session.state.usage, usage, 'Usage rehydrates on reconnect without a local ledger');
  pass('reconnect-restores-settings-without-replay');
  otherSessions.forEach(session => session.dispose()); current.dispose(); current = client();
  await connect(); await current.session.resume(key, 'default');
  assert.equal(current.session.state.agent?.model, alternate.model);
  assert.equal(current.session.state.agent?.reasoningEffort, 'high');
  assert.equal(current.session.state.messages.filter(message => message.role === 'user' && message.text === prompt).length, 1);
  const report = JSON.stringify(current.connection.report());
  assert.ok(!report.includes(prompt)); assert.ok(!report.includes(alternate.model));
  assert.deepEqual(current.session.state.usage, usage);
  pass('fresh-client-native-recovery-and-redacted-report');
  stage = 'native-command-parity-transactions';
  const commandSession = new NativeSession(current.gateway); otherSessions.push(commandSession);
  await commandSession.create('default');
  const task = 'Describe this controlled command parity task without using tools or changing any files.';
  await commandSession.commands.execute(`/plan ${task}`);
  assert.ok(commandSession.commands.state.confirmation, 'A generated-prompt command requires explicit confirmation');
  assert.equal(commandSession.state.messages.length, 0, 'Preparation did not create a model turn');
  await commandSession.commands.confirm();
  await until(() => commandSession.state.phase === 'idle' && commandSession.state.messages.some(message => message.text.includes(EXPECTED_RESPONSE)));
  assert.equal(commandSession.state.messages.filter(message => message.role === 'user').length, 1);
  assert.ok(commandSession.state.messages.some(message => message.role === 'user' && message.text.includes(task)));
  const commandHistory = JSON.stringify(commandSession.state.messages);
  await commandSession.commands.execute('/undo 1');
  assert.equal(JSON.stringify(commandSession.state.messages), commandHistory, 'Unconfirmed undo leaves native history intact');
  await commandSession.commands.confirm();
  assert.equal(commandSession.commands.state.recovered?.kind, 'prefill');
  assert.ok(commandSession.commands.state.recovered?.text.includes(task));
  assert.equal(commandSession.state.messages.filter(message => message.role === 'user').length, 0);
  await assert.rejects(commandSession.commands.confirm());
  await commandSession.refresh();
  assert.equal(commandSession.state.messages.filter(message => message.role === 'user').length, 0, 'Undo did not auto-resubmit the recovered input');
  assert.equal(current.session.state.messages.filter(message => message.role === 'user' && message.text === prompt).length, 1, 'The other session remained untouched');
  pass('native-command-confirm-plan-send-undo-readback-and-session-isolation');
  stage = 'native-command-dedicated-routes';
  commandSession.commands.dismissResult();
  await commandSession.commands.execute('/title Command route acceptance');
  await commandSession.commands.confirm();
  assert.equal(record(await current.gateway.call('session.title', { session_id: commandSession.state.runtimeId })).title, 'Command route acceptance');
  await commandSession.commands.execute('/compress'); await commandSession.commands.confirm();
  assert.equal(commandSession.commands.state.uncertain, false);
  assert.equal(commandSession.state.messages.filter(message => message.role === 'user').length, 0);
  assert.equal(current.session.state.messages.filter(message => message.role === 'user' && message.text === prompt).length, 1);
  pass('native-command-title-and-empty-compression-use-selected-session');
  success = true;
} catch (error) {
  console.error(error instanceof ClientError ? `${error.kind}: ${error.message}` : error instanceof Error ? error.message : 'Settings acceptance failed');
  console.error(JSON.stringify({ stage, failures }));
  process.exitCode = 1;
} finally {
  await mkdir('test-results/live', { recursive: true });
  await writeFile(`test-results/live/phase4b-${local ? 'local' : 'gated'}.json`, JSON.stringify({
    upstream: pin, commit: process.env.GITHUB_SHA, success, gates, stage, failures,
    mode: local ? 'trusted-local' : 'dashboard',
    scope: 'Unmodified Hermes, production WebUI image, deterministic model endpoint; session settings, not global mutations.',
  }, null, 2));
  otherSessions.forEach(session => session.dispose()); current.dispose(); clearTimeout(deadline);
}
