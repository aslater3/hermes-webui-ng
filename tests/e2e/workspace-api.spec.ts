import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { WORKSPACE_ALIAS } from '../../server/routes/workspace.js';
import { startFixture } from '../fixtures/dashboard.js';

// Backend slice: actual browser cookies and unchanged SW policy with a minimal public
// shell. This is not full Workspace UI, physical-device or vanilla-Hermes evidence.
test.use({ serviceWorkers: 'allow' });
async function fixture(page: Page) {
  const base = await mkdtemp(join(tmpdir(), 'ng-workspace-browser-'));
  const project = join(base, 'project'), assets = join(base, 'assets');
  await mkdir(project); await mkdir(assets);
  await writeFile(join(project, 'hello.html'), '<script>window.WORKSPACE_CANARY=true</script>');
  await writeFile(join(assets, 'index.html'), '<!doctype html><html lang="en"><head><title>Workspace wire fixture</title></head><body><h1>Public protocol fixture</h1></body></html>');
  const policy = await readFile('pwa/service-worker.js', 'utf8');
  await writeFile(join(assets, 'sw.js'), policy.replace('__BUILD_ID__', 'workspace-api-test').replace('__PRECACHE__', JSON.stringify(['/'])));
  const upstream = await startFixture();
  const config = loadConfig({ HERMES_DASHBOARD_URL: upstream.origin, PUBLIC_ORIGIN: 'http://127.0.0.1:1', WORKSPACE_ROOTS: project });
  config.staticDir = assets;
  const app = createApp(config, () => {});
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  config.publicOrigin = new URL(`http://127.0.0.1:${address.port}`);
  const close = async () => {
    await page.goto('about:blank').catch(() => {});
    await app.close(); await upstream.close(); await rm(base, { recursive: true, force: true });
  };
  try {
    await page.goto(config.publicOrigin.origin);
    const login = await page.evaluate(async () => (await fetch('/__hermes/auth/password-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fixture', password: 'fixture-password' }),
    })).status);
    expect(login).toBe(200);
    return { origin: config.publicOrigin.origin, close };
  } catch (error) { await close(); throw error; }
}
const readPath = `${WORKSPACE_ALIAS}files/read?root=workspace&path=hello.html`;

test('the local alias uses the existing scoped login cookie without widening it', async ({ page, context }) => {
  const network = await fixture(page);
  try {
    const cookies = await context.cookies(network.origin + WORKSPACE_ALIAS);
    expect(cookies.some(cookie => cookie.path === '/__hermes/' && cookie.httpOnly)).toBe(true);
    expect(cookies.some(cookie => cookie.path === '/')).toBe(false);
    expect(await page.evaluate(async () => (await fetch('/api/webui/workspaces')).status)).toBe(401);
    const result = await page.evaluate(async url => {
      const response = await fetch(url); return { status: response.status, body: await response.json() };
    }, readPath);
    expect(result.status).toBe(200); expect(result.body.text).toContain('WORKSPACE_CANARY');
    expect(await page.evaluate(() => 'WORKSPACE_CANARY' in window)).toBe(false);
    await page.evaluate(async () => { await fetch('/__hermes/auth/logout', { method: 'POST' }); });
    expect(await page.evaluate(async url => (await fetch(url)).status, readPath)).toBe(401);
  } finally { await network.close(); }
});

test('workspace reads bypass the real worker cache and active files download as attachments', async ({ page }) => {
  const network = await fixture(page);
  try {
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    for (const path of [WORKSPACE_ALIAS + 'workspaces', WORKSPACE_ALIAS + 'files/tree?root=workspace', readPath]) {
      const result = await page.evaluate(async url => {
        const response = await fetch(url); await response.text();
        return { status: response.status, cache: response.headers.get('cache-control'), static: response.headers.get('x-webui-static') };
      }, path);
      expect(result).toEqual({ status: 200, cache: 'no-store', static: null });
    }
    const stored = await page.evaluate(async () => {
      const rows: { url: string; body: string }[] = [];
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        for (const request of await cache.keys()) rows.push({ url: request.url, body: await (await cache.match(request))!.text() });
      }
      return rows;
    });
    expect(stored.map(row => new URL(row.url).pathname)).toEqual(['/']);
    expect(stored.every(row => !row.body.includes('WORKSPACE_CANARY'))).toBe(true);
    const download = page.waitForEvent('download');
    await page.evaluate(url => { const link = document.createElement('a'); link.href = url; document.body.append(link); link.click(); link.remove(); },
      `${WORKSPACE_ALIAS}files/download?root=workspace&path=hello.html`);
    expect((await download).suggestedFilename()).toBe('hello.html');
    expect(await page.evaluate(() => 'WORKSPACE_CANARY' in window)).toBe(false);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  } finally { await network.close(); }
});
