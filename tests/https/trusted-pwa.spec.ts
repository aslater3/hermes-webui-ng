import { pwaNetwork, loginPwa } from '../e2e/pwa-network.js';
import { reloadPwa } from '../e2e/pwa-navigation.js';
import { test, expect } from '@playwright/test';
import { send, idle, settings } from '../e2e/shell-fixture.js';

test('trusted private-CA HTTPS supports secure WSS, service-worker registration and offline relaunch', async ({ page }, info) => {
  const network = await pwaNetwork(true);
  try {
  const websocketUrls: string[] = []; page.on('websocket', socket => websocketUrls.push(socket.url()));
  await loginPwa(page, network.origin); expect(await page.evaluate(() => isSecureContext)).toBe(true);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  expect(websocketUrls.length).toBeGreaterThan(0);
  expect(websocketUrls.every(url => url.startsWith(network.origin.replace('https:', 'wss:') + '/') && !url.includes('?'))).toBe(true);
  await send(page, 'Verified HTTPS conversation'); await idle(page);
  await page.reload(); await idle(page);
  await expect(page.locator('[data-role="user"]')).toHaveCount(1);
  await settings(page); await page.getByRole('tab', { name: 'App', exact: true }).click();
  await expect(page.getByTestId('pwa-state')).toHaveText('ready');
  await page.screenshot({ path: info.outputPath('trusted-https-app.png') });
  await network.stop(page); await reloadPwa(page);
  await expect(page.getByRole('heading', { name: 'You’re offline.' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Verified HTTPS conversation');
  await network.restore(page); await expect(page.locator('#shell-prompt')).toBeEnabled();
  await expect(page.locator('[data-role="user"]')).toHaveCount(1);
  } finally { await page.goto('about:blank'); await network.close(); }
});
