import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixture } from '../fixtures/dashboard.js';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { WORKSPACE_ALIAS } from '../../server/routes/workspace.js';

async function setup(t: TestContext, enabled = true) {
  const root = await mkdtemp(join(tmpdir(), 'git-wire-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', root, ...args], { stdio: 'pipe' });
  await writeFile(join(root, 'hello.txt'), 'original\n');
  git('init', '-b', 'main'); git('add', 'hello.txt'); git('commit', '-m', 'fixture');
  await writeFile(join(root, 'hello.txt'), 'safe new content\n');
  const upstream = await startFixture();
  const config = loadConfig({ HERMES_DASHBOARD_URL: upstream.origin, PUBLIC_ORIGIN: 'http://127.0.0.1:8787', WORKSPACE_ROOTS: root, GIT_ENABLED: String(enabled) });
  const app = createApp(config, () => {});
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  config.publicOrigin = new URL(`http://127.0.0.1:${address.port}`);
  const request = (path: string, options: RequestInit = {}, authenticated = true) => fetch(config.publicOrigin.origin + path, { ...options,
    headers: { origin: config.publicOrigin.origin, ...(authenticated ? { cookie: upstream.cookie } : {}), ...options.headers } });
  t.after(async () => { await app.close(); await upstream.close(); await rm(root, { recursive: true, force: true }); });
  return { request };
}
test('Git routes share live auth and provide no-store patches without any mutation or arbitrary-ref endpoint', async t => {
  const { request } = await setup(t);
  for (const route of ['repos', 'status', 'diff']) assert.equal((await request(`${WORKSPACE_ALIAS}git/${route}?root=workspace`, {}, false)).status, 401);
  assert.equal((await (await request(WORKSPACE_ALIAS + 'workspaces')).json()).git, true);
  const discovery = await (await request(WORKSPACE_ALIAS + 'git/repos?root=workspace')).json();
  assert.equal(discovery.repos[0].path, '');
  const status = await request(WORKSPACE_ALIAS + 'git/status?root=workspace'); assert.equal(status.status, 200);
  assert.equal((await status.json()).branch, 'main');
  const patch = await request(WORKSPACE_ALIAS + 'git/diff?root=workspace&path=hello.txt');
  assert.equal(patch.status, 200); assert.equal(patch.headers.get('cache-control'), 'no-store');
  assert.match((await patch.json()).patch, /safe new content/);
  assert.equal((await request(WORKSPACE_ALIAS + 'git/status?root=workspace', { method: 'POST' })).status, 405);
  assert.equal((await request(WORKSPACE_ALIAS + 'git/commit?root=workspace')).status, 404);
  assert.equal((await request(WORKSPACE_ALIAS + 'git/diff?root=workspace&path=hello.txt&ref=HEAD')).status, 400);
  assert.equal((await request(WORKSPACE_ALIAS + 'git/diff?root=workspace&path=hello.txt&staged=yes')).status, 400);
  assert.equal((await request(WORKSPACE_ALIAS + 'git/status?root=workspace&repo=..')).status, 400);
  assert.equal((await request(WORKSPACE_ALIAS + 'git/status?root=workspace', { headers: { origin: 'https://evil.invalid' } })).status, 403);
});
test('Git is independently opt-in in both API namespaces', async t => {
  const { request } = await setup(t, false);
  assert.equal((await request(WORKSPACE_ALIAS + 'git/status?root=workspace')).status, 404);
  assert.equal((await request('/api/webui/git/status?root=workspace')).status, 404);
});
