import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { WsAuthClient } from '../../src/hermes/ws-auth.js';
import { ConnectionStore } from '../../src/hermes/connection-store.js';
import { NativeSession } from '../../src/hermes/native-session.js';
import { browserAuth } from '../helpers/browser-auth.js';
import { EXPECTED_RESPONSE } from './provider.js';
const origin = 'https://127.0.0.1:8790', mode = process.env.PHASE4_TLS_MODE;
assert.ok(['dashboard', 'trusted-local'].includes(mode ?? ''));
assert.ok(process.env.NODE_EXTRA_CA_CERTS); assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
const auth = browserAuth(origin), dashboard = new DashboardClient(origin, auth.fetcher);
let wss = false;
const gateway = new GatewayClient(new WsAuthClient(dashboard, signal => connection.verifyAdmission(signal)), {
  socketFactory: (url, protocols) => { assert.ok(url.startsWith('wss://')); wss = true; return auth.socketFactory(url, protocols); },
  heartbeatMs: 0, requestTimeoutMs: 45_000,
});
const connection: ConnectionStore = new ConnectionStore(dashboard, gateway), session = new NativeSession(gateway);
const gates: string[] = []; let success = false;
const timer = setTimeout(() => { console.error('HTTPS acceptance deadline exceeded'); process.exit(1); }, 120000);
const until = async (predicate: () => boolean) => { for (let n = 0; n < 450; n++) { if (session.state.error) throw session.state.error; if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('HTTPS acceptance condition timed out'); };
try {
  await connection.start();
  if (mode === 'dashboard') {
    assert.equal(connection.state.auth, 'auth-required');
    const provider = connection.providers.find(row => row.supports_password); assert.ok(provider);
    await connection.login(provider.name, process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME!, process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD!);
  } else assert.equal(connection.state.auth, 'local-access');
  assert.equal(gateway.state.phase, 'ready'); assert.ok(wss); gates.push('verified-https-rest-and-wss-admission');
  await session.create(); await session.submit('Controlled HTTPS and secure WebSocket acceptance.');
  await until(() => session.state.phase === 'idle' && session.state.messages.some(row => row.text.includes(EXPECTED_RESPONSE)));
  const key = session.state.storedId; gates.push('native-prompt-completion');
  await gateway.reconnect(); await until(() => session.state.phase === 'idle');
  assert.equal(session.state.storedId, key); assert.equal(session.state.messages.filter(row => row.role === 'user').length, 1);
  gates.push('secure-reconnect-without-replay');
  for (const path of ['/sw.js', '/manifest.webmanifest', '/pwa/icon-192.png']) {
    const response = await fetch(origin + path); assert.equal(response.status, 200); assert.equal(response.headers.get('x-webui-static'), '1'); await response.body?.cancel();
  }
  gates.push('public-pwa-assets-over-https'); success = true;
} finally {
  session.dispose(); connection.dispose(); clearTimeout(timer);
  await mkdir('test-results/live', { recursive: true });
  await writeFile(`test-results/live/phase4-https-${mode}.json`, JSON.stringify({ success, gates, mode,
    upstream: process.env.HERMES_TEST_REF, commit: process.env.GITHUB_SHA, certificateVerification: true,
    transport: 'HTTPS and WSS; upstream is private host loopback HTTP', webui: 'production non-root read-only Docker image' }, null, 2));
}
