/** Real Phase 1 auth/capability acceptance through the production container. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { WsAuthClient } from '../../src/hermes/ws-auth.js';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { ConnectionStore } from '../../src/hermes/connection-store.js';
import { DiagnosticsRing } from '../../src/hermes/diagnostics.js';
import { ClientError } from '../../src/hermes/protocol.js';
import { browserAuth } from '../helpers/browser-auth.js';

const pin = 'b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a';
const gates: string[] = [];
const origin = process.env.PHASE0_ORIGIN ?? 'http://127.0.0.1:8787';
const username = process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME;
const password = process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD;
const browser = browserAuth(origin);
const ring = new DiagnosticsRing();
const dashboard = new DashboardClient(origin, browser.fetcher, 15_000, ring);
const wsAuth = new WsAuthClient(dashboard);
const gateway = new GatewayClient(wsAuth, { socketFactory: browser.socketFactory, heartbeatMs: 0, diagnostics: ring });
const connection = new ConnectionStore(dashboard, gateway, ring);
const sockets: WebSocket[] = [];
const deadline = setTimeout(() => { console.error('Phase 1 acceptance deadline exceeded'); process.exit(1); }, 120_000);
let success = false;
function passed(gate: string) { gates.push(gate); console.log(`PASS phase1/${gate}`); }
try {
  assert.equal(process.env.HERMES_TEST_REF, pin);
  assert.ok(username && password, 'Use an isolated authenticated Hermes test environment');
  await connection.start();
  assert.equal(connection.state.rest, 'healthy');
  assert.equal(connection.state.auth, 'auth-required');
  assert.equal(gateway.state.phase, 'auth-required');
  passed('healthy-rest-without-gateway-admission');
  const provider = connection.providers.find((item) => item.supports_password);
  assert.ok(provider);
  await connection.login(provider.name, username, password);
  assert.equal(gateway.state.phase, 'ready');
  assert.equal(connection.state.auth, 'signed-in');
  await connection.refreshCapabilities();
  const capabilities = connection.capabilities.snapshot();
  assert.equal(capabilities.gateway.state, 'available');
  assert.equal(capabilities.heartbeat.state, 'available');
  assert.equal(capabilities.sessionsList.state, 'available');
  assert.equal(capabilities.sessionsList.implemented, false);
  assert.equal(capabilities.workspace.state, 'unavailable');
  passed('authenticated-schema-and-gateway-capabilities');
  const ticket = await wsAuth.credential();
  const first = new WebSocket(ticket.url, ticket.protocols, { origin }); sockets.push(first);
  first.on('error', () => {});
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('One-use admission timed out')), 5000);
    first.once('open', () => { clearTimeout(timer); resolve(); });
    first.once('error', () => { clearTimeout(timer); reject(new Error('One-use admission rejected')); });
  });
  const replay = new WebSocket(ticket.url, ticket.protocols, { origin }); sockets.push(replay);
  replay.on('error', () => {});
  const denied = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Ticket replay rejection timed out')), 5000);
    replay.once('unexpected-response', (request, response) => {
      clearTimeout(timer); resolve(response.statusCode ?? 0); response.resume(); request.destroy();
    });
    replay.once('open', () => { clearTimeout(timer); reject(new Error('Consumed ticket admitted twice')); });
  });
  assert.ok([401, 403].includes(denied), 'Hermes must reject a consumed ticket');
  first.close();
  passed('vanilla-one-use-ticket-replay-rejected');
  const report = JSON.stringify(connection.report());
  for (const forbidden of [password, '"user_id":', '"provider":', '"ticket":', 'hermes-gateway-ticket.'])
    assert.ok(!report.includes(forbidden), 'Support report leaked an excluded field');
  assert.ok(connection.report().events.length <= 500);
  passed('allowlisted-support-report');
  let cleared = false;
  connection.onIdentityBoundary(() => { cleared = true; });
  // Revoke through the official API, then prove the coordinator notices on resume.
  await dashboard.logout();
  await connection.resume();
  assert.ok(cleared);
  assert.equal(connection.state.auth, 'auth-required');
  assert.equal(gateway.state.phase, 'auth-required');
  const mints = ring.snapshot().filter((entry) => entry.event === 'auth.ticket').length;
  await connection.resume();
  assert.equal(ring.snapshot().filter((entry) => entry.event === 'auth.ticket').length, mints);
  passed('revoked-cookie-closes-existing-admission');
  await connection.login(provider.name, username, password);
  assert.equal(gateway.state.phase, 'ready');
  await connection.logout();
  assert.equal(connection.state.auth, 'signed-out');
  assert.equal(gateway.state.phase, 'disconnected');
  await assert.rejects(wsAuth.credential(), (error: unknown) => error instanceof ClientError && error.kind === 'auth-required');
  passed('verified-logout-and-fresh-sign-in');
  success = true;
} catch (error) {
  console.error(error instanceof ClientError ? `${error.kind}: ${error.message}` : error instanceof Error ? error.message : 'Phase 1 acceptance failed');
  process.exitCode = 1;
} finally {
  connection.dispose(); sockets.forEach((socket) => socket.terminate()); clearTimeout(deadline);
  await mkdir('test-results/live', { recursive: true });
  await writeFile('test-results/live/phase1.json', JSON.stringify({ upstream: pin, commit: process.env.GITHUB_SHA ?? 'local', phase: 1, success, gates }, null, 2));
}
