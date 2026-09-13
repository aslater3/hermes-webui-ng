import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { send, idle, settings } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8789' });
const TOKEN = 'LOCAL_BROWSER_FIXTURE_NOT_A_REAL_SECRET';

test('trusted-local shell uses native chat without a fabricated login or browser token', async ({ page }, info) => {
  const requests: string[] = [], sockets: string[] = [], errors: string[] = [];
  page.on('request', request => requests.push(request.url()));
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Connection status: Connected' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('Trusted LAN · No login');
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await send(page, 'Local shell conversation'); await idle(page);
  await expect(page.locator('[data-role="assistant"]').last()).toContainText('SYNTHETIC_RESPONSE');
  const selection = new URL(page.url()).hash;
  await page.reload(); await idle(page); expect(new URL(page.url()).hash).toBe(selection);
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(1);
  await settings(page);
  await expect(page.getByTestId('auth-state')).toHaveText('local-access');
  await expect(page.getByRole('button', { name: 'Sign out of Hermes' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await expect(page.locator('.connection-pill')).toContainText('Disconnected');
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click(); await idle(page);
  expect(sockets.length).toBeGreaterThanOrEqual(3);
  expect(sockets.every(url => url === 'ws://127.0.0.1:8789/__hermes/api/ws')).toBe(true);
  expect(requests.some(url => url.includes(TOKEN) || url.includes('/api/auth/') || url.includes('/auth/'))).toBe(false);
  expect(await page.context().cookies()).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(errors).toEqual([]);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('shell-trusted-local.png') });
});

test('invalidated local access clears conversation and draft instead of pretending to sign out', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.connection-pill')).toContainText('Connected');
  await send(page, 'Private local projection'); await idle(page);
  await page.locator('#shell-prompt').fill('Private local draft');
  await page.route('**/api/webui/access', route => route.fulfill({ status: 503, json: { error: { code: 'LOCAL_ACCESS_UNAVAILABLE' } } }));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await expect(page.getByRole('button', { name: 'Retry local connection' })).toBeVisible();
  await expect(page.locator('[data-role],#shell-prompt')).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByLabel('Username', { exact: true })).toHaveCount(0);
});
