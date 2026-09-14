import { test, expect } from '@playwright/test';
import { login, send, idle, settings } from '../e2e/shell-fixture.js';

test('trusted private-CA HTTPS supports secure WSS, service-worker registration and offline relaunch', async ({ page, context }, info) => {
  const websocketUrls: string[] = []; page.on('websocket', socket => websocketUrls.push(socket.url()));
  await login(page); expect(await page.evaluate(() => isSecureContext)).toBe(true);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  expect(websocketUrls.length).toBeGreaterThan(0);
  expect(websocketUrls.every(url => url.startsWith('wss://127.0.0.1:8791/') && !url.includes('?'))).toBe(true);
  await send(page, 'Verified HTTPS conversation'); await idle(page);
  const href = page.url(); await page.reload(); await idle(page);
  await expect(page.locator('[data-role="user"]')).toHaveCount(1);
  await settings(page); await page.getByRole('tab', { name: 'App', exact: true }).click();
  await expect(page.getByTestId('pwa-state')).toHaveText('ready');
  await page.screenshot({ path: info.outputPath('trusted-https-app.png') });
  await context.setOffline(true); await page.goto(href);
  await expect(page.getByRole('heading', { name: 'You’re offline.' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Verified HTTPS conversation');
  await context.setOffline(false); await expect(page.locator('#shell-prompt')).toBeEnabled();
  await expect(page.locator('[data-role="user"]')).toHaveCount(1);
});
