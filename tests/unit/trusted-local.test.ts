import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { loadConfig } from '../../server/config.js';
import { requestHeaders, allowedRequest } from '../../server/proxy/headers.js';
import { localPathAllowed, localUpgradePath, localHandshake } from '../../server/trusted-local.js';
const env = { HERMES_AUTH_MODE: 'trusted-local', HERMES_DASHBOARD_SESSION_TOKEN: 'LOCAL_TEST_TOKEN_NOT_A_REAL_SECRET', HERMES_DASHBOARD_URL: 'http://127.0.0.1:9119', PUBLIC_ORIGIN: 'http://192.168.0.63:8788' };

test('local access requires an explicit mode, private origin, loopback and server-only token', () => {
  const config = loadConfig(env);
  assert.equal(config.authMode, 'trusted-local');
  assert.equal(config.sessionToken, env.HERMES_DASHBOARD_SESSION_TOKEN);
  assert.ok(!JSON.stringify(config).includes(env.HERMES_DASHBOARD_SESSION_TOKEN));
  for (const change of [
    { HERMES_AUTH_MODE: 'dashboard' }, { HERMES_AUTH_MODE: 'auto' },
    { HERMES_DASHBOARD_SESSION_TOKEN: '' }, { HERMES_DASHBOARD_SESSION_TOKEN: 'private\r\nvalue' },
    { HERMES_DASHBOARD_URL: 'http://example.com' }, { PUBLIC_ORIGIN: 'https://public.example' },
  ]) assert.throws(() => loadConfig({ ...env, ...change }), error => error instanceof Error && !error.message.includes('private\r\nvalue'));
});

test('local translation happens after independent browser origin validation', () => {
  const config = loadConfig(env);
  const req = { method: 'GET', headers: { host: '192.168.0.63:8788', origin: env.PUBLIC_ORIGIN, cookie: 'untrusted=value', authorization: 'Bearer untrusted', 'x-hermes-session-token': 'untrusted' }, socket: { remoteAddress: '192.168.0.2' } } as unknown as IncomingMessage;
  assert.equal(allowedRequest(req, config, true), true);
  const headers = requestHeaders(req, config, 'test');
  assert.equal(headers.host, '127.0.0.1:9119'); assert.equal(headers.origin, 'http://127.0.0.1:9119');
  assert.equal(headers.cookie, undefined); assert.equal(headers.authorization, undefined);
  assert.equal(headers['x-hermes-session-token'], config.sessionToken);
  req.headers.origin = 'https://evil.example'; assert.equal(allowedRequest(req, config, true), false);
});

test('local bridge excludes upstream HTML, token overrides and unimplemented API mutations', () => {
  for (const path of ['/', '/login', '/api/config', '/api/status?token=override', '/api/sessions?internal=override']) assert.equal(localPathAllowed(path, 'GET'), false);
  assert.equal(localPathAllowed('/api/sessions?limit=20', 'GET'), true);
  assert.equal(localPathAllowed('/api/sessions/id/messages?offset=0', 'GET'), true);
  assert.equal(localPathAllowed('/api/status', 'POST'), false);
  assert.equal(localPathAllowed('/api/sessions/id/messages', 'DELETE'), false);
});

test('local bridge allows exactly the read-only skill routes and no skill or hub writes', () => {
  assert.equal(localPathAllowed('/api/skills?profile=work', 'GET'), true);
  assert.equal(localPathAllowed('/api/skills/content?name=arxiv&profile=work', 'GET'), true);
  assert.equal(localPathAllowed('/api/skills', 'POST'), false);
  assert.equal(localPathAllowed('/api/skills/content', 'PUT'), false);
  assert.equal(localPathAllowed('/api/skills/content?name=x', 'DELETE'), false);
  assert.equal(localPathAllowed('/api/skills/content?name=x&token=override', 'GET'), false);
  for (const path of ['/api/skills/hub/search?q=x', '/api/skills/hub/preview?identifier=x', '/api/skills/toggle', '/api/skills/content/extra', '/api/config', '/api/skills/hub/install'])
    assert.equal(localPathAllowed(path, 'GET'), false, path);
});

test('local bridge allows exactly the read-only memory and cron routes; every write, provider config and fire stays refused', () => {
  assert.equal(localPathAllowed('/api/memory?profile=default', 'GET'), true);
  assert.equal(localPathAllowed('/api/cron/jobs?profile=default', 'GET'), true);
  assert.equal(localPathAllowed('/api/cron/jobs/a1b2c3/runs?profile=default&limit=20', 'GET'), true);
  assert.equal(localPathAllowed('/api/cron/jobs/a1b2c3?profile=default', 'GET'), true);
  for (const [method, path] of [
    ['POST', '/api/cron/jobs/a1b2c3/pause'], ['POST', '/api/cron/jobs/a1b2c3/resume'], ['POST', '/api/cron/jobs/a1b2c3/trigger'],
    ['DELETE', '/api/cron/jobs/a1b2c3'], ['PUT', '/api/cron/jobs/a1b2c3'], ['POST', '/api/cron/jobs'], ['POST', '/api/cron/fire'],
    ['GET', '/api/cron/jobs/a1b2c3/pause'], ['GET', '/api/cron/jobs/a1b2c3/trigger'], ['GET', '/api/cron/blueprints'],
    ['GET', '/api/cron/delivery-targets'], ['GET', '/api/cron/jobs/a1b2c3/runs/extra'], ['GET', '/api/cron/jobs/a/b'],
    ['POST', '/api/memory/reset'], ['PUT', '/api/memory/provider'], ['GET', '/api/memory/providers/honcho/config'],
    ['POST', '/api/memory/providers/honcho/setup'], ['PUT', '/api/memory/providers/honcho/config'], ['GET', '/api/memory?token=leak'],
    ['GET', '/api/cron/jobs?token=leak'],
  ] as const) assert.equal(localPathAllowed(path, method), false, `${method} ${path}`);
});

test('local WS supplies only stable offered protocol, without relaxing gated negotiation', () => {
  const config = loadConfig(env);
  const req = { headers: { 'sec-websocket-protocol': 'hermes-gateway-v1' } } as IncomingMessage;
  const path = localUpgradePath(req, '/api/ws', config)!;
  assert.equal(new URL(path, config.upstream).searchParams.get('token'), config.sessionToken);
  assert.equal(localUpgradePath(req, '/api/ws?token=override', config), undefined);
  req.headers['sec-websocket-protocol'] = 'hermes-gateway-v1, hermes-gateway-ticket.fake';
  assert.equal(localUpgradePath(req, '/api/ws', config), undefined);
  const output: Record<string, string> = {};
  assert.equal(localHandshake(output, config), true); assert.equal(output['sec-websocket-protocol'], 'hermes-gateway-v1');
  assert.equal(localHandshake({ 'sec-websocket-protocol': 'wrong' }, config), false);
  const gated = loadConfig({ HERMES_DASHBOARD_URL: 'http://hermes:9119', PUBLIC_ORIGIN: 'https://chat.example' });
  const normal: Record<string, string> = {}; assert.equal(localHandshake(normal, gated), true); assert.deepEqual(normal, {});
});
