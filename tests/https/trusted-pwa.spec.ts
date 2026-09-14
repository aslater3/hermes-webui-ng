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
  await expect.poll(() => websocketUrls.length, { message: 'Observe the admitted browser WSS connection' }).toBeGreaterThan(0);
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

// Regression: service-worker control is intentionally established BEFORE WS admission.
// There are no browser-network routes or substitute WebSockets in this scenario.
test('PWA sign-in waits for native readiness even when the worker controls the page first', async ({ page }) => {
  let release!: () => void;
  const permit = new Promise<void>(resolve => { release = resolve; });
  let requested = false, resolved = false;
  const network = await pwaNetwork(true, { beforeWsTicket: () => { requested = true; return permit; } });
  const websocketUrls: string[] = [];
  page.on('websocket', socket => websocketUrls.push(socket.url()));
  const signedIn = loginPwa(page, network.origin).then(() => { resolved = true; });
  // Register rejection immediately; assertions below still await the original promise.
  void signedIn.catch(() => {});
  try {
    await expect.poll(() => requested).toBe(true);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    expect(await page.evaluate(() => isSecureContext)).toBe(true);
    expect(resolved).toBe(false);
    expect(network.metrics.upgrades).toBe(0);
    expect(network.metrics.tickets).toBe(0);
    await expect(page.locator('#shell-prompt')).toBeDisabled();
    release();
    await signedIn;
    await expect.poll(() => websocketUrls.length).toBeGreaterThan(0);
    expect(websocketUrls.every(url => url.startsWith(network.origin.replace('https:', 'wss:') + '/') && !url.includes('?'))).toBe(true);
    expect(network.metrics.upgrades).toBe(1);
    expect(network.metrics.tickets).toBe(1);
    await send(page, 'One deliberate prompt after delayed secure admission');
    await idle(page);
    expect(network.metrics.submits).toBe(1);
  } finally {
    release();
    await signedIn.catch(() => {});
    await page.goto('about:blank');
    await network.close();
  }
});
