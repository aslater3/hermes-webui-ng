import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { WorkspaceApi } from '../../client/workspace/api.js';
import { WorkspaceStore } from '../../client/workspace/store.js';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { startFixture } from '../fixtures/dashboard.js';

test('the actual workspace client traverses file/Git APIs with scoped admission and no local writes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-client-wire-'));
  await mkdir(join(root, 'src')); await writeFile(join(root, 'src/main.ts'), 'export const value = 1;\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=test@example.invalid', '-C', root, ...args], { stdio: 'pipe' });
  git('init', '-b', 'main'); git('add', '.'); git('commit', '-m', 'Fixture');
  await writeFile(join(root, 'src/main.ts'), 'export const value = 2;\n');
  const original = await readFile(join(root, '.git/index'));
  const upstream = await startFixture();
  const config = loadConfig({ HERMES_DASHBOARD_URL: upstream.origin, PUBLIC_ORIGIN: 'http://127.0.0.1:1', WORKSPACE_ROOTS: root, GIT_ENABLED: 'true' });
  const app = createApp(config, () => {});
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string'); config.publicOrigin = new URL(`http://127.0.0.1:${address.port}`);
  t.after(async () => { await app.close(); await upstream.close(); await rm(root, { recursive: true, force: true }); });
  const api = new WorkspaceApi((input, init) => fetch(config.publicOrigin.origin + input, { ...init, headers: { cookie: upstream.cookie } }));
  const store = new WorkspaceStore(api); t.after(() => store.dispose());
  await store.load(); assert.equal(store.state.error, ''); assert.equal(store.state.git, true);
  await store.directory('src'); await store.file('src/main.ts'); assert.match(store.state.preview!.text!, /value = 2/);
  await store.directory(''); await store.discover(); assert.deepEqual(store.state.repos, [{ path: '', supported: true }]);
  await store.repository(''); assert.equal(store.state.status?.branch, 'main');
  await store.showDiff('src/main.ts', false); assert.match(store.state.diff!.patch, /\+export const value = 2/);
  const download = await fetch(config.publicOrigin.origin + api.download('workspace', 'src/main.ts'), { headers: { cookie: upstream.cookie } });
  assert.match(download.headers.get('content-disposition')!, /^attachment/); await download.text();
  assert.deepEqual(await readFile(join(root, '.git/index')), original);
});

test('HTML supplies a per-response editor stylesheet nonce without allowing inline scripts or active file rendering', async t => {
  const assets = await mkdtemp(join(tmpdir(), 'workspace-csp-')); await writeFile(join(assets, 'index.html'), '<!doctype html><html><head><title>Public shell</title></head><body>public</body></html>');
  const config = loadConfig({ HERMES_DASHBOARD_URL: 'http://127.0.0.1:1', PUBLIC_ORIGIN: 'http://127.0.0.1:1' }); config.staticDir = assets;
  const app = createApp(config, () => {}); await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string'); config.publicOrigin = new URL(`http://127.0.0.1:${address.port}`);
  t.after(async () => { await app.close(); await rm(assets, { recursive: true, force: true }); });
  const nonces: string[] = [];
  for (let i = 0; i < 2; i++) {
    const response = await fetch(config.publicOrigin); const body = await response.text();
    const nonce = /name="webui-style-nonce" content="([A-Za-z0-9+/=]+)"/.exec(body)?.[1]; assert.ok(nonce); nonces.push(nonce);
    const csp = response.headers.get('content-security-policy')!;
    assert.ok(csp.includes(`style-src 'self' 'nonce-${nonce}'`)); assert.ok(csp.includes("script-src 'self';"));
    assert.ok(!csp.includes('unsafe-inline')); assert.ok(!csp.includes('unsafe-eval'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.notEqual(nonces[0], nonces[1]);
});
