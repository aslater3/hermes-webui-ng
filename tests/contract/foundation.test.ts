import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';

test('public capability/diagnostic API exposes only allowlisted metadata, never browser credentials', async (t) => {
  let requests = 0;
  const upstream = createServer((req, res) => {
    requests++;
    assert.equal(req.url, '/api/status');
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ auth_required: true, hermes_home: '/private-home',
      config_path: '/private-config', platform_errors: ['private-error'], token: 'private-token' }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const config = loadConfig({ HERMES_DASHBOARD_URL: `http://127.0.0.1:${address.port}`, PUBLIC_ORIGIN: 'http://127.0.0.1:1' });
  const app = createApp(config, () => {});
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const addr = app.server.address(); assert.ok(addr && typeof addr !== 'string');
  const origin = `http://127.0.0.1:${addr.port}`; config.publicOrigin = new URL(origin);
  t.after(async () => { await app.close(); upstream.closeAllConnections(); await new Promise<void>((r) => upstream.close(() => r())); });
  const read = async (path: string) => {
    const response = await fetch(origin + path, { headers: { Cookie: 'private-cookie', Authorization: 'Bearer private' } });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };
  const data = await read('/api/webui/capabilities');
  assert.deepEqual(data.hermes, { reachable: true, status: 'healthy', authRequired: true });
  assert.equal(data.gateway.status, 'browser-not-probed');
  assert.deepEqual(data.workspace, { available: false, writable: false, git: false });
  assert.equal(data.features.pwa, false);
  await Promise.all([read('/api/webui/capabilities'), read('/api/webui/capabilities')]);
  assert.equal(requests, 1, 'public probes are coalesced and briefly cached');
  assert.equal(JSON.stringify([data, await read('/api/webui/diagnostics')]).includes('private'), false);
  assert.equal((await read('/api/webui/health')).ok, true);
  assert.equal((await fetch(origin + '/api/webui/capabilities?url=https://evil.example')).status, 404);
  assert.equal((await fetch(origin + '/api/webui/diagnostics', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(origin + '/api/webui/capabilities', { method: 'POST', headers: { Origin: origin } })).status, 405);
});

test('capabilities remain inspectable during an upstream outage without claiming Gateway readiness', async (t) => {
  const config = loadConfig({ HERMES_DASHBOARD_URL: 'http://127.0.0.1:1', PUBLIC_ORIGIN: 'http://127.0.0.1:1' });
  const app = createApp(config, () => {});
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  config.publicOrigin = new URL(`http://127.0.0.1:${address.port}`);
  t.after(() => app.close());
  const response = await fetch(`${config.publicOrigin.origin}/api/webui/capabilities`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.hermes.status, 'unreachable');
  assert.equal(body.gateway.status, 'browser-not-probed');
});
