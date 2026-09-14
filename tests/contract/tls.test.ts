import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { loadConfig } from '../../server/config.js';
import { createApp } from '../../server/app.js';
import { startFixture } from '../fixtures/dashboard.js';
import { WS_PROTOCOL } from '../../src/hermes/dashboard-client.js';

test('native HTTPS validates certificate and carries authenticated REST and WSS without bypassing trust', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-tls-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cert = join(dir, 'server.crt'), key = join(dir, 'server.key');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert,
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  const fixture = await startFixture(); t.after(() => fixture.close());
  const config = loadConfig({ HERMES_DASHBOARD_URL: fixture.origin, PUBLIC_ORIGIN: 'https://127.0.0.1:1',
    WEBUI_TLS_CERT: cert, WEBUI_TLS_KEY: key });
  const app = createApp(config, () => {}); t.after(() => app.close());
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const addr = app.server.address(); assert.ok(addr && typeof addr !== 'string');
  config.publicOrigin = new URL(`https://127.0.0.1:${addr.port}`);
  const ca = readFileSync(cert);
  const request = (path: string, method = 'GET', cookie = '', body = '') => new Promise<{ status: number; body: string; cookies: string[] }>((resolve, reject) => {
    const req = https.request(new URL(path, config.publicOrigin), { ca, method, headers: { Origin: config.publicOrigin.origin,
      Cookie: cookie, 'Content-Type': 'application/json' } }, res => {
      let text = ''; res.on('data', chunk => { text += String(chunk); });
      res.on('end', () => resolve({ status: res.statusCode!, body: text, cookies: res.headers['set-cookie'] ?? [] }));
    }); req.on('error', reject); req.end(body);
  });
  assert.equal((await request('/healthz')).status, 200);
  const login = await request('/__hermes/auth/password-login', 'POST', '', JSON.stringify({username:'fixture',password:'fixture-password'}));
  assert.equal(login.status, 200); const cookie = login.cookies[0]!.split(';')[0]!;
  assert.equal((await request('/__hermes/api/auth/me', 'GET', cookie)).status, 200);
  const ticket = JSON.parse((await request('/__hermes/api/auth/ws-ticket', 'POST', cookie)).body).ticket;
  const ws = new WebSocket(`wss://127.0.0.1:${addr.port}/__hermes/api/ws`, [WS_PROTOCOL, `hermes-gateway-ticket.${ticket}`], { ca, origin: config.publicOrigin.origin });
  t.after(() => ws.terminate());
  const raw = await new Promise<string>((resolve, reject) => { ws.once('message', data => resolve(data.toString())); ws.once('error', reject); });
  assert.ok(raw.includes('gateway.ready')); assert.equal(ws.protocol, WS_PROTOCOL);
  await assert.rejects(new Promise((resolve, reject) => https.get(new URL('/healthz', config.publicOrigin), resolve).on('error', reject)));
});

test('partial TLS settings or unreadable/mismatched files fail closed with redacted errors', () => {
  const base = { HERMES_DASHBOARD_URL: 'http://localhost:9119', PUBLIC_ORIGIN: 'https://localhost:8788' };
  assert.throws(() => loadConfig({...base, WEBUI_TLS_KEY:'private-key'}));
  assert.throws(() => loadConfig({...base, PUBLIC_ORIGIN:'http://localhost:8788', WEBUI_TLS_KEY:'key', WEBUI_TLS_CERT:'cert'}));
  const config = loadConfig({...base, WEBUI_TLS_KEY:'/private-secret', WEBUI_TLS_CERT:'/private-secret'});
  assert.throws(() => createApp(config), err => err instanceof Error && !err.message.includes('private-secret'));
});
