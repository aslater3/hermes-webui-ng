import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixture } from '../fixtures/dashboard.js';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { WORKSPACE_ALIAS } from '../../server/routes/workspace.js';

async function setup(t: TestContext, local = false, mounted = true) {
  const root = await mkdtemp(join(tmpdir(), 'ng-files-wire-'));
  await writeFile(join(root, 'hello.html'), '<script>window.WORKSPACE_XSS=true</script>');
  await writeFile(join(root, 'huge.bin'), Buffer.alloc(10_485_761));
  await writeFile(join(root, '.env'), 'DO_NOT_EXPOSE');
  await symlink('/etc/passwd', join(root, 'outside'));
  const token = 'SYNTHETIC_LOCAL_WORKSPACE_TOKEN';
  const upstream = await startFixture(0, local ? { sessionToken: token } : {});
  const config = loadConfig({ HERMES_DASHBOARD_URL: upstream.origin, PUBLIC_ORIGIN: 'http://127.0.0.1:8787',
    ...(mounted ? { WORKSPACE_ROOTS: root } : {}), ...(local ? { HERMES_AUTH_MODE: 'trusted-local', HERMES_DASHBOARD_SESSION_TOKEN: token } : {}) });
  const logs: unknown[] = [];
  const app = createApp(config, event => logs.push(event));
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  config.publicOrigin = new URL(origin);
  const request = (path: string, options: RequestInit = {}, authenticated = true) => fetch(origin + path, { ...options,
    headers: { host: config.publicOrigin.host, origin: config.publicOrigin.origin,
      ...(authenticated ? { cookie: upstream.cookie } : {}), ...options.headers } });
  t.after(async () => { await app.close(); await upstream.close(); await rm(root, { recursive: true, force: true }); });
  return { request, logs, root, token, config, upstream };
}
const readPath = (path: string) => `${WORKSPACE_ALIAS}files/read?${new URLSearchParams({ root: 'workspace', path })}`;
test('canonical and cookie-scoped local APIs require live Hermes identity and reject revoked cookies', async t => {
  const { request, upstream } = await setup(t);
  for (const path of ['/api/webui/workspaces', WORKSPACE_ALIAS + 'workspaces', readPath('hello.html')]) {
    assert.equal((await request(path, {}, false)).status, 401);
  }
  assert.equal((await request(WORKSPACE_ALIAS + 'workspaces')).status, 200);
  assert.equal((await request(readPath('hello.html'))).status, 200);
  await fetch(upstream.origin + '/auth/logout', { method: 'POST', headers: { cookie: upstream.cookie }, redirect: 'manual' });
  assert.equal((await request(readPath('hello.html'))).status, 401);
});
test('no mount is explicitly unavailable; configured capabilities expose booleans not host paths', async t => {
  const disabled = await setup(t, false, false);
  assert.deepEqual((await (await disabled.request(WORKSPACE_ALIAS + 'workspaces')).json()).roots, []);
  const enabled = await setup(t);
  const body = await (await enabled.request('/api/webui/capabilities')).text();
  assert.equal(JSON.parse(body).workspace.available, true); assert.ok(!body.includes(enabled.root));
  assert.equal(JSON.parse(body).workspace.writable, false); assert.equal(JSON.parse(body).workspace.git, false);
});
test('file reads are inert; downloads are attachments, bounded and not cached', async t => {
  const { request, root, logs, token } = await setup(t);
  const result = await request(readPath('hello.html'));
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).kind, 'text');
  const download = await request(`${WORKSPACE_ALIAS}files/download?root=workspace&path=hello.html`);
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.match(download.headers.get('content-disposition')!, /^attachment;/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(download.headers.get('cache-control'), 'no-store'); await download.text();
  assert.equal((await request(`${WORKSPACE_ALIAS}files/download?root=workspace&path=huge.bin`)).status, 413);
  assert.ok(!JSON.stringify(logs).includes(root)); assert.ok(!JSON.stringify(logs).includes(token));
});
test('traversal, symlinks, secret paths, unknown roots, writes and cross-origin access are refused', async t => {
  const { request } = await setup(t);
  for (const path of ['../secret', '%2e%2e/secret', '/etc/passwd', '.env', '.git/config', 'outside', 'a\\b', '\0'])
    assert.ok((await request(readPath(path))).status >= 400, path);
  assert.equal((await request(readPath('hello.html'), { headers: { origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await request(readPath('hello.html'), { method: 'PUT', body: 'change' })).status, 405);
  assert.equal((await request(WORKSPACE_ALIAS + 'files/write')).status, 404);
  assert.equal((await request(WORKSPACE_ALIAS + 'files/read?root=other&path=hello.html')).status, 404);
  assert.equal((await request(WORKSPACE_ALIAS + 'files/read?root=workspace&root=other&path=hello.html')).status, 400);
});
test('upstream unavailability fails closed', async t => {
  const { request, upstream } = await setup(t);
  await upstream.close();
  assert.equal((await request(readPath('hello.html'))).status, 503);
});
test('explicit trusted-local workspace retains server-only token and fails when access is revoked', async t => {
  const { request, config, root, token } = await setup(t, true);
  const result = await request(WORKSPACE_ALIAS + 'workspaces', {}, false);
  assert.equal(result.status, 200);
  const text = await result.text(); assert.ok(!text.includes(root)); assert.ok(!text.includes(token));
  // Supported local admission is checked on every workspace read, not presumed from a private IP.
  const old = config.upstream;
  config.upstream = new URL('http://127.0.0.1:1');
  assert.equal((await request(readPath('hello.html'), {}, false)).status, 503); config.upstream = old;
});

test('an ungated upstream cannot downgrade Dashboard workspace authentication', async t => {
  const { request, config } = await setup(t, true);
  config.authMode = 'dashboard';
  assert.equal((await request(readPath('hello.html'))).status, 401);
});

test('workspace abuse is bounded without preventing the liveness route', async t => {
  const { request } = await setup(t);
  for (let i = 0; i < 120; i++) assert.equal((await request(WORKSPACE_ALIAS + 'workspaces', {}, false)).status, 401);
  assert.equal((await request(WORKSPACE_ALIAS + 'workspaces', {}, false)).status, 429);
  assert.equal((await request('/healthz', {}, false)).status, 200);
});
