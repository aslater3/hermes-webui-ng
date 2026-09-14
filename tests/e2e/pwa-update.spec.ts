import { test, expect } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { startFixture } from '../fixtures/dashboard.js';
import { send, idle, settings } from './shell-fixture.js';

test.use({ serviceWorkers: 'allow' });
test('a real waiting worker protects drafts and other tabs, then deliberately reloads once', async ({ page, context }) => {
  const root = await mkdtemp(join(tmpdir(), 'ng-update-')); await cp('dist', root, { recursive: true });
  const fixture = await startFixture();
  const config = loadConfig({ HERMES_DASHBOARD_URL: fixture.origin, PUBLIC_ORIGIN: 'http://127.0.0.1:1' }); config.staticDir = root;
  const app = createApp(config, () => {});
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const addr = app.server.address(); if (!addr || typeof addr === 'string') throw new Error('No test listener');
  config.publicOrigin = new URL(`http://127.0.0.1:${addr.port}`);
  try {
    await page.goto(config.publicOrigin.origin);
    await page.getByLabel('Username', { exact: true }).fill('fixture');
    await page.getByLabel('Password', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await send(page, 'One upstream turn before updating'); await idle(page);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const second = await context.newPage(); await second.goto(page.url());
    await expect(second.locator('#shell-prompt')).toBeEnabled();
    await page.locator('#shell-prompt').fill('Do not discard this draft');
    const worker = await readFile(join(root, 'sw.js'), 'utf8');
    await writeFile(join(root, 'sw.js'), worker.replace(/const VERSION = '[^']+';/, "const VERSION = 'next-build-test';"));
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);
    await settings(page); await page.getByRole('tab', { name: 'App', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Update and reload' })).toBeDisabled();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(page.locator('#shell-prompt')).toHaveValue('Do not discard this draft');
    await page.locator('#shell-prompt').fill('');
    await settings(page); await page.getByRole('tab', { name: 'App', exact: true }).click();
    await page.getByRole('button', { name: 'Update and reload' }).click();
    await expect(page.getByText('Close other HermesUI tabs/windows, then try again. They have not been reloaded.', { exact: true })).toBeVisible();
    await expect(second.locator('[data-role="user"]')).toHaveCount(1);
    await second.close();
    const changed = page.waitForEvent('load');
    await page.getByRole('button', { name: 'Update and reload' }).click(); await changed;
    await idle(page); await expect(page.locator('[data-role="user"]')).toHaveCount(1);
    await expect.poll(() => page.evaluate(async () => {
      const channel = new MessageChannel();
      return await new Promise(resolve => { channel.port1.onmessage = event => { resolve(event.data.version); channel.port1.close(); }; navigator.serviceWorker.controller!.postMessage({ type: 'HERMES_VERSION' }, [channel.port2]); });
    })).toBe('next-build-test');
  } finally { await page.goto('about:blank'); await app.close(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
