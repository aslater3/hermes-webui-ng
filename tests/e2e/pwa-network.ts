import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { startFixture } from '../fixtures/dashboard.js';

/** Actual listener loss (not routed HTTP mocks); browser connectivity signal is controlled separately. */
export async function pwaNetwork(tls = false) {
  const upstream = await startFixture();
  const config = loadConfig({ HERMES_DASHBOARD_URL: upstream.origin, PUBLIC_ORIGIN: `${tls ? 'https' : 'http'}://127.0.0.1:1`,
    ...(tls ? { WEBUI_TLS_CERT: resolve('.local/tls/server/server.crt'), WEBUI_TLS_KEY: resolve('.local/tls/server/server.key') } : {}) });
  let app = createApp(config, () => {}), stopped = false;
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const addr = app.server.address(); assert.ok(addr && typeof addr !== 'string');
  config.publicOrigin = new URL(`${tls ? 'https' : 'http'}://127.0.0.1:${addr.port}`);
  return {
    origin: config.publicOrigin.origin,
    async stop(page: Page) {
      await app.close(); stopped = true;
      await assert.rejects(fetch(`${config.publicOrigin.origin}/healthz`, { signal: AbortSignal.timeout(2000) }));
      // Playwright's WebKit offline switch can prevent service-worker navigations entirely.
      // The socket is genuinely unavailable; this getter only models the browser's network signal.
      await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false }));
      await page.evaluate(() => { Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
    },
    async restore(page: Page) {
      app = createApp(config, () => {});
      await new Promise<void>(resolve => app.server.listen(addr.port, '127.0.0.1', resolve)); stopped = false;
      await page.evaluate(() => { Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online')); });
    },
    async close() { if (!stopped) await app.close(); await upstream.close(); },
  };
}
export async function loginPwa(page: Page, origin: string) {
  await page.goto(origin);
  await page.getByLabel('Username', { exact: true }).fill('fixture');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
