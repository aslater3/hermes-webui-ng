import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpServerList, MCP_SERVER_LIMIT } from '../../src/hermes/mcp.js';
import { hermesStatus, hermesHealth, systemStats } from '../../src/hermes/hermes-status.js';
import { McpBrowser } from '../../src/hermes/mcp-browser.js';
import { DiagnosticsBrowser } from '../../src/hermes/diagnostics-browser.js';
import { CapabilitiesStore } from '../../src/hermes/capabilities.js';
import { localPathAllowed } from '../../server/trusted-local.js';
import { ClientError } from '../../src/hermes/protocol.js';
import { HttpError } from '../../src/hermes/dashboard-client.js';

const SECRETS = ['FIXTURE_MCP_URL_PASSWORD', 'FIXTURE_MCP_QUERY_TOKEN', 'FIXTURE_MCP_HEADER_SECRET', 'FIXTURE_MCP_ENV_SECRET',
  'FIXTURE_MCP_ARG_SECRET', 'FIXTURE_MCP_OAUTH_TOKEN', '/home/fixture/private', '/srv/hermes', 'fixture-host.internal',
  '48211', '9119', 'FIXTURE_INSTALL_ID', 'deadbeefcafe', 'FIXTURE_HOSTNAME_TOKEN'];

// A realistic upstream `GET /api/mcp/servers` body, with every secret-bearing field seeded.
const upstreamMcp = { servers: [
  { name: 'github', transport: 'http', url: 'https://user:FIXTURE_MCP_URL_PASSWORD@mcp.example.test/v1?access_token=FIXTURE_MCP_QUERY_TOKEN',
    command: null, args: [], env: {}, headers: { Authorization: 'Bearer FIXTURE_MCP_HEADER_SECRET' }, auth: 'header', enabled: true,
    tools: ['search_code', 'get_issue'], source: 'config', plugin: null },
  { name: 'filesystem', transport: 'stdio', url: null, command: '/usr/bin/npx', args: ['--root', '/home/fixture/private', 'FIXTURE_MCP_ARG_SECRET'],
    env: { FS_TOKEN: 'FIXTURE_MCP_ENV_SECRET' }, auth: null, enabled: false, tools: null, source: 'config', plugin: null },
  { name: 'oauth-calendar', transport: 'http', url: 'https://calendar.example.test/mcp', auth: 'oauth', enabled: true, tools: ['list_events'],
    oauth_tokens: { access_token: 'FIXTURE_MCP_OAUTH_TOKEN' }, source: 'plugin', plugin: 'calendar-plugin' },
] };

test('MCP projection keeps only name, transport, enabled, auth label, tool count and plugin', () => {
  const rows = mcpServerList(upstreamMcp);
  assert.deepEqual(rows, [
    { name: 'github', transport: 'http', enabled: true, auth: 'Header token', toolCount: 2, plugin: '' },
    { name: 'filesystem', transport: 'stdio', enabled: false, auth: '', toolCount: undefined, plugin: '' },
    { name: 'oauth-calendar', transport: 'http', enabled: true, auth: 'OAuth', toolCount: 1, plugin: 'calendar-plugin' },
  ]);
  const rendered = JSON.stringify(rows);
  for (const secret of SECRETS) assert.equal(rendered.includes(secret), false, secret);
  assert.equal(rendered.includes('mcp.example.test'), false);
});

test('MCP projection never echoes unknown transports, unknown auth labels or control characters', () => {
  const [row] = mcpServerList({ servers: [{ name: 'x\u0007y', transport: 'shell', auth: 'token=FIXTURE_UNKNOWN_AUTH_SECRET', enabled: 0, tools: 'all' }] });
  assert.equal(row!.transport, 'unknown'); assert.equal(row!.auth, ''); assert.equal(row!.enabled, true); assert.equal(row!.toolCount, undefined);
  assert.equal(row!.name, 'xy');
  assert.equal(JSON.stringify(row).includes('FIXTURE_UNKNOWN_AUTH_SECRET'), false);
});

test('MCP projection fails the whole page on malformed input, and bounds the list', () => {
  assert.throws(() => mcpServerList({ servers: [{ transport: 'stdio' }] }), ClientError);
  assert.throws(() => mcpServerList({}), ClientError);
  assert.throws(() => mcpServerList({ servers: Array.from({ length: MCP_SERVER_LIMIT + 1 }, (_, i) => ({ name: `s${i}` })) }), ClientError);
});

test('status, health and system stats drop paths, ports, PIDs, hostnames and install identity', () => {
  const status = hermesStatus({ auth_required: false, version: '0.13.2', release_date: '2026-10-15', gateway_running: true, gateway_state: 'running',
    active_agents: 1, active_sessions: 2, overall: 'ok', hermes_home: '/srv/hermes/home', config_path: '/srv/hermes/home/config.yaml',
    env_path: '/srv/hermes/home/.env', gateway_pid: 48211, gateway_health_url: 'http://127.0.0.1:9119/health',
    gateways: [{ port: 9119, host: 'fixture-host.internal' }], install_id: 'FIXTURE_INSTALL_ID', gateway_platforms: { telegram: {} } });
  const allowedKeys = ['activeAgents', 'activeSessions', 'gatewayRunning', 'gatewayState', 'heartbeatStaleSeconds', 'overall', 'releaseDate', 'version'];
  for (const key of Object.keys(status)) assert.ok(allowedKeys.includes(key), `unexpected status field ${key}`);
  assert.equal(status.version, '0.13.2'); assert.equal(status.activeSessions, 2); assert.equal(status.overall, 'ok');
  const health = hermesHealth({ ok: true, version: '0.13.2', displayVersion: '0.13.2 (fixture)', commit: 'deadbeefcafe', auth_required: true });
  assert.deepEqual(health, { ok: true, version: '0.13.2', displayVersion: '0.13.2 (fixture)' });
  const stats = systemStats({ os: 'Linux', os_release: '6.8.0', os_version: '#1', platform: 'Linux-x86_64', arch: 'x86_64', hostname: 'fixture-host.internal',
    python_version: '3.12.4', cpu_count: 8, cpu_percent: 12.5, load_avg: [0.4, 0.3, 0.2, 9], uptime_seconds: 302400,
    memory: { total: 100, used: 50, available: 50, percent: 50 }, disk: { total: 9, used: 3, free: 6, percent: 30 }, process: { pid: 48211, rss: 1 } });
  const rendered = JSON.stringify({ status, health, stats });
  for (const secret of SECRETS.filter(value => value !== '48211')) assert.equal(rendered.includes(secret), false, secret);
  assert.equal(rendered.includes('48211'), false);
  assert.deepEqual(stats.loadAverage, [0.4, 0.3, 0.2]);
  assert.deepEqual(stats.disk, { percent: 30 });
});

test('status with a non-boolean auth flag and health without ok are rejected', () => {
  assert.throws(() => hermesStatus({ version: '0.13.2' }), ClientError);
  assert.throws(() => hermesHealth({ ok: false }), ClientError);
});

function fakeMcpDashboard(rows: Record<string, unknown>) {
  const calls: (string | undefined)[] = [];
  return { calls, mcpServers: async (profile?: string) => { calls.push(profile); const value = rows[profile ?? 'default']; if (value instanceof Error) throw value; return value as never; } };
}

test('MCP browser is profile-scoped, drops rows on switch and keeps stale rows only for the same profile', async () => {
  const dashboard = fakeMcpDashboard({ default: mcpServerList(upstreamMcp), work: mcpServerList({ servers: [{ name: 'work-docs' }] }) });
  const browser = new McpBrowser(dashboard as never);
  await browser.load('default');
  assert.equal(browser.state.phase, 'ready'); assert.equal(browser.state.rows.length, 3);
  await browser.load('work');
  assert.equal(browser.state.profile, 'work'); assert.deepEqual(browser.state.rows.map(row => row.name), ['work-docs']);
  // Failure on the same profile keeps the last good rows, flagged stale.
  dashboard.mcpServers = async () => { throw new ClientError('network', 'offline'); };
  await browser.load('work');
  assert.equal(browser.state.phase, 'error'); assert.equal(browser.state.stale, true); assert.equal(browser.state.rows.length, 1);
  // A switch to another profile never shows the previous profile's rows.
  await browser.load('default');
  assert.equal(browser.state.phase, 'error'); assert.equal(browser.state.stale, false); assert.equal(browser.state.rows.length, 0);
  browser.dispose();
});

test('MCP browser reports auth failures through the callback and ignores results after dispose', async () => {
  let authFailures = 0;
  const browser = new McpBrowser({ mcpServers: async () => { throw new ClientError('auth-required', 'signed out'); } } as never, () => { authFailures++; });
  await browser.load('default');
  assert.equal(authFailures, 1);
  let resolve!: (value: never) => void;
  const pending = new McpBrowser({ mcpServers: () => new Promise(done => { resolve = done; }) } as never);
  const loading = pending.load('default');
  pending.dispose(); resolve([] as never); await loading;
  assert.equal(pending.state.phase, 'loading');
});

test('diagnostics browser keeps sections independent and marks stale values per section', async () => {
  const good = { status: { version: '0.13.2', releaseDate: '', gatewayState: 'running', activeAgents: 0, activeSessions: 1, overall: 'ok' } };
  let healthFails = false;
  const dashboard = {
    hermesStatus: async (profile?: string) => { if (profile === 'work') throw new ClientError('network', 'offline'); return good.status as never; },
    hermesHealth: async () => { if (healthFails) throw new HttpError(500); return { ok: true, version: '0.13.2', displayVersion: '0.13.2' }; },
    systemStats: async () => { throw new HttpError(403); },
  };
  const browser = new DiagnosticsBrowser(dashboard as never);
  await browser.load('default', false);
  assert.equal(browser.state.phase, 'ready');
  assert.equal(browser.state.status.value?.version, '0.13.2');
  assert.equal(browser.state.health.value?.ok, true);
  assert.equal(browser.state.stats.value, undefined);
  assert.equal(browser.state.stats.error, undefined, 'no stats request when Hermes does not advertise the route');
  healthFails = true;
  await browser.load('default', false);
  assert.equal(browser.state.health.stale, true);
  assert.equal(browser.state.health.value?.ok, true);
  assert.equal(browser.state.status.stale, false);
  await browser.load('work', false);
  assert.equal(browser.state.status.value, undefined, 'a profile switch never shows the previous profile');
  assert.equal(browser.state.status.stale, false);
  assert.equal(browser.state.status.error?.kind, 'network');
  assert.equal(browser.state.health.value, undefined, 'a profile switch clears every section, including machine-level health');
  browser.dispose();
});

test('capabilities advertise the three new GETs and nothing else from them', () => {
  const store = new CapabilitiesStore(); const epoch = store.begin();
  store.applySchema(epoch, { openapi: '3.1.0', paths: {
    '/api/mcp/servers': { get: {}, post: {} }, '/api/health': { get: {} }, '/api/system/stats': { get: {} },
  } }, false);
  const caps = store.snapshot();
  assert.equal(caps.mcpServers.state, 'available'); assert.equal(caps.health.state, 'available'); assert.equal(caps.systemStats.state, 'available');
  const missing = new CapabilitiesStore(); const epoch2 = missing.begin();
  missing.applySchema(epoch2, { openapi: '3.1.0', paths: { '/api/mcp/servers': { post: {} } } }, false);
  assert.equal(missing.snapshot().mcpServers.state, 'unavailable', 'a POST-only advertisement is not a GET read');
});

test('trusted-local allows exactly the three new GETs and keeps MCP writes, tests, auth and catalog refused', () => {
  for (const path of ['/api/mcp/servers?profile=default', '/api/health', '/api/system/stats', '/api/status?profile=work'])
    assert.equal(localPathAllowed(path, 'GET'), true, path);
  for (const [method, path] of [
    ['POST', '/api/mcp/servers'], ['PUT', '/api/mcp/servers'], ['DELETE', '/api/mcp/servers/github'], ['PUT', '/api/mcp/servers/github/enabled'],
    ['POST', '/api/mcp/servers/github/test'], ['POST', '/api/mcp/servers/github/auth'], ['GET', '/api/mcp/servers/github/test'],
    ['GET', '/api/mcp/oauth/flows/x'], ['GET', '/api/mcp/catalog'], ['POST', '/api/mcp/catalog/install'],
    ['GET', '/api/mcp/servers/github'], ['GET', '/api/mcp/servers?token=leak'], ['GET', '/api/mcp/servers/'],
    ['GET', '/api/health/idle'], ['POST', '/api/health/retirement'], ['GET', '/api/health?ticket=leak'],
    ['GET', '/api/system/stats/extra'], ['POST', '/api/system/stats'],
    ['POST', '/api/gateway/start'], ['POST', '/api/gateway/stop'], ['POST', '/api/ops/dump'], ['GET', '/api/config/raw'],
    ['GET', '/api/credentials/pool'], ['POST', '/api/webhooks'],
  ] as const) assert.equal(localPathAllowed(path, method), false, `${method} ${path}`);
});

test('diagnostics HttpError from the dashboard is an operator-facing status, not a raw body', () => {
  assert.equal(new HttpError(403).kind, 'forbidden');
});
