/** Actual unmodified loopback Hermes + production container; no Python/state/config access. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { WsAuthClient } from '../../src/hermes/ws-auth.js';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { ConnectionStore } from '../../src/hermes/connection-store.js';
import { NativeSession } from '../../src/hermes/native-session.js';
import { EXPECTED_RESPONSE } from './provider.js';
const PIN = 'b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a';
const origin = 'http://127.0.0.1:8789', gates: string[] = [];
const sockets: WebSocket[] = [];
const deadline = setTimeout(() => { console.error('Local acceptance deadline exceeded'); process.exit(1); }, 150_000);
function client() {
  const dashboard = new DashboardClient(origin);
  const gateway = new GatewayClient(new WsAuthClient(dashboard, (signal): Promise<void> => connection.verifyAdmission(signal)), {
    heartbeatMs: 0, connectTimeoutMs: 20_000, requestTimeoutMs: 45_000,
    socketFactory: (url, protocols) => {
      assert.equal(url, 'ws://127.0.0.1:8789/__hermes/api/ws');
      assert.deepEqual(protocols, ['hermes-gateway-v1']);
      const socket = new WebSocket(url, protocols, { origin }); sockets.push(socket);
      return socket as unknown as globalThis.WebSocket;
    },
  });
  const connection = new ConnectionStore(dashboard, gateway);
  const native = new NativeSession(gateway);
  return { dashboard, gateway, connection, native, dispose: () => { native.dispose(); connection.dispose(); } };
}
async function until(test: () => boolean) {
  for (let i = 0; i < 600; i++) {
    if (test()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Local acceptance condition timed out');
}
function pass(label: string) { gates.push(label); console.log(`PASS local/${label}`); }
let current = client(), success = false;
try {
  assert.equal(process.env.HERMES_TEST_REF, PIN);
  const token = process.env.HERMES_DASHBOARD_SESSION_TOKEN;
  assert.ok(token, 'The isolated test environment must supply its token');
  const unauthenticated = await fetch('http://127.0.0.1:9118/api/sessions?limit=1');
  await unauthenticated.body?.cancel(); assert.equal(unauthenticated.status, 401);
  pass('upstream-rest-still-requires-operator-token');
  const status = await (await fetch(`${origin}/readyz`)).json();
  assert.equal(status.hermes.reachable, true); assert.equal(status.hermes.authenticatedMode, false);
  await current.connection.start();
  assert.equal(current.connection.state.auth, 'local-access'); assert.equal(current.gateway.state.phase, 'ready');
  assert.deepEqual(current.connection.providers, []); await assert.rejects(current.dashboard.me());
  assert.equal(sockets[0]?.protocol, 'hermes-gateway-v1');
  pass('explicit-local-state-and-browser-compatible-upgrade');
  await current.native.create(); const key = current.native.state.storedId!;
  await current.native.submit('Acknowledge this isolated local transport test. Do not use tools.');
  await until(() => current.native.state.phase === 'idle' && current.native.state.messages.some(message => message.text.includes(EXPECTED_RESPONSE)));
  assert.equal(current.native.state.messages.filter(message => message.role === 'user').length, 1);
  pass('native-prompt-completes-through-local-container');
  const before = sockets.length; sockets.at(-1)!.terminate();
  await until(() => sockets.length > before && current.gateway.state.phase === 'ready' && current.native.state.phase === 'idle');
  assert.equal(current.native.state.storedId, key);
  assert.equal(current.native.state.messages.filter(message => message.role === 'user').length, 1);
  pass('network-reconnect-without-replay');
  current.dispose(); current = client(); await current.connection.start(); await current.native.resume(key);
  assert.ok(current.native.state.messages.some(message => message.text.includes(EXPECTED_RESPONSE)));
  const history = await current.dashboard.sessionMessages({ id: key }); assert.ok(history.messages.length >= 2);
  pass('fresh-client-authoritative-rest-and-native-history');
  await assert.rejects(current.connection.logout());
  current.connection.disconnect(); await current.connection.resume(); assert.equal(current.gateway.state.phase, 'disconnected');
  pass('disconnect-is-not-fabricated-logout');
  const report = JSON.stringify(current.connection.report());
  assert.ok(!report.includes(token)); assert.ok(!report.includes('user_id')); assert.ok(!report.includes(EXPECTED_RESPONSE));
  const forbidden = await fetch(`${origin}/__hermes/api/status`, { headers: { Origin: 'https://untrusted.invalid' } });
  assert.equal(forbidden.status, 403);
  for (const path of ['/__hermes/', '/__hermes/login', '/__hermes/api/config']) assert.equal((await fetch(origin + path)).status, 403);
  pass('redacted-report-and-preserved-browser-origin-guards'); success = true;
} catch {
  console.error('Local acceptance failed; completed gate labels are retained without credentials or transcript.');
  process.exitCode = 1;
} finally {
  current.dispose(); sockets.forEach(socket => socket.terminate()); clearTimeout(deadline);
  await mkdir('test-results/live', { recursive: true });
  await writeFile('test-results/live/local-acceptance.json', JSON.stringify({
    upstream: PIN, commit: process.env.GITHUB_SHA, success, gates,
    hermes: 'Unmodified official loopback serve', webui: 'Non-root read-only production Docker image',
    model: 'Deterministic loopback provider', browserAuthentication: false,
  }, null, 2));
}
