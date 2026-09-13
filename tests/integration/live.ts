/** Real vanilla-Hermes acceptance runner. No Hermes imports or filesystem access. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { GatewayClient } from '../../src/hermes/gateway-client.js';
import { NativeSession } from '../../src/hermes/native-session.js';
import { ClientError, record } from '../../src/hermes/protocol.js';
import { browserAuth } from '../helpers/browser-auth.js';
import { EXPECTED_RESPONSE } from './provider.js';

const PIN = 'b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a';
const gates: string[] = [];
const origin = process.env.PHASE0_ORIGIN ?? 'http://127.0.0.1:8787';
const username = process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME;
const password = process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD;
const deadline = setTimeout(() => {
  console.error('Vanilla-Hermes acceptance deadline exceeded');
  process.exit(1);
}, 180_000);
let gateway: GatewayClient | undefined;
let session: NativeSession | undefined;
const sockets: WebSocket[] = [];
const eventTypes: string[] = [];
let turnFailed = false;
const auth = browserAuth(origin);
const dashboard = new DashboardClient(origin, auth.fetcher);
const options = {
  heartbeatMs: 0,
  retryBaseMs: 100,
  connectTimeoutMs: 30_000,
  requestTimeoutMs: 45_000,
  socketFactory: (url: string, protocols: string[]) => {
    const socket = new WebSocket(url, protocols, { origin });
    sockets.push(socket);
    return socket as unknown as globalThis.WebSocket;
  },
};
async function until(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 900; attempt++) {
    if (turnFailed)
      throw new Error('Hermes reported a failed turn; inspect the isolated provider configuration');
    if (check()) return;
    if (session?.state.phase === 'error') throw session.state.error ?? new Error('Session error');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Gate timeout: ${label}`);
}
function passed(gate: string): void {
  gates.push(gate);
  console.log(`PASS ${gate}`);
}
try {
  assert.equal(process.env.HERMES_TEST_REF, PIN, 'The exact tested upstream ref must be supplied');
  assert.ok(username && password, 'An isolated authenticated Hermes test environment is required');
  await dashboard.status();
  await assert.rejects(
    dashboard.me(),
    (error: unknown) => error instanceof ClientError && error.kind === 'auth-required',
  );
  passed('authenticated-dashboard-proxy');
  const providers = await dashboard.providers();
  const provider = providers.find((item) => item.supports_password);
  assert.ok(provider, 'Hermes must expose an official password provider');
  await dashboard.login(provider.name, username, password);
  passed('official-proxied-login');
  gateway = new GatewayClient(dashboard, options);
  gateway.onEvent((event) => {
    eventTypes.push(event.type);
    if (eventTypes.length > 100) eventTypes.shift();
    if (event.type === 'message.complete' && record(event.payload).status === 'error') turnFailed = true;
  });
  await gateway.connect();
  passed('one-use-ticket-upgrade-gateway-ready');
  session = new NativeSession(gateway);
  await session.create();
  assert.ok(session.state.storedId);
  const key = session.state.storedId;
  passed('native-session-create');
  const prompt = `Briefly acknowledge this isolated transport test. Reference ${randomUUID()}. Do not use tools.`;
  await session.submit(prompt);
  await until(
    () =>
      session?.state.phase === 'idle' &&
      session.state.messages.some(
        (message) => message.role === 'assistant' && message.text.includes(EXPECTED_RESPONSE),
      ),
    'native-prompt-completion',
  );
  passed('real-agent-controlled-model-response');
  const firstSocketCount = sockets.length;
  sockets.at(-1)!.terminate();
  await until(
    () =>
      sockets.length > firstSocketCount &&
      gateway?.state.phase === 'ready' &&
      session?.state.phase === 'idle',
    'socket-loss-reconnect',
  );
  assert.equal(session.state.storedId, key);
  assert.equal(
    session.state.messages.filter((message) => message.role === 'user' && message.text === prompt).length,
    1,
  );
  passed('socket-loss-rehydrate-without-replay');
  session.dispose();
  gateway.close();
  session = undefined;
  gateway = new GatewayClient(dashboard, options);
  await gateway.connect();
  session = new NativeSession(gateway);
  await session.resume(key);
  assert.ok(
    session.state.messages.some(
      (message) => message.role === 'assistant' && message.text.includes(EXPECTED_RESPONSE),
    ),
  );
  assert.equal(
    session.state.messages.filter((message) => message.role === 'user' && message.text === prompt).length,
    1,
  );
  passed('fresh-client-native-history-no-local-persistence');
  const model = (await (await fetch('http://127.0.0.1:9120/health')).json()) as { completions: number };
  assert.ok(model.completions >= 1);
  passed('controlled-provider-received-real-agent-request');
  await mkdir('test-results/live', { recursive: true });
  await writeFile(
    'test-results/live/acceptance.json',
    JSON.stringify(
      {
        upstream: PIN,
        commit: process.env.GITHUB_SHA ?? 'local',
        gates,
        modelRequests: model.completions,
        hermes: 'unmodified official serve (Dashboard API + native Gateway)',
        model: 'deterministic loopback fixture',
        webui: 'production Docker image',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof ClientError
      ? `${error.kind}: ${error.message}`
      : error instanceof Error
        ? error.message
        : 'Acceptance failed',
  );
  process.exitCode = 1;
} finally {
  await mkdir('test-results/live', { recursive: true });
  await writeFile(
    'test-results/live/gates.json',
    JSON.stringify(
      {
        upstream: PIN,
        commit: process.env.GITHUB_SHA ?? 'local',
        gates,
        eventTypes,
        turnFailed,
        phase: session?.state.phase,
        entries: session?.state.messages.length,
        success: process.exitCode !== 1,
      },
      null,
      2,
    ),
  );
  session?.dispose();
  gateway?.close();
  sockets.forEach((socket) => socket.terminate());
  clearTimeout(deadline);
}
