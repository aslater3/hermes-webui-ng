import { test, expect, type Page } from '@playwright/test';
async function signIn(page: Page) {
  await page.goto('/'); await expect(page.locator('#auth-state')).toHaveText('auth-required');
  await page.getByLabel('Username', { exact: true }).fill('fixture');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function chat(page: Page) {
  await signIn(page); await expect(page.locator('#gateway-state')).toHaveText('ready');
  await page.getByRole('button', { name: 'New session' }).click(); await expect(page.locator('#session-state')).toHaveText('idle');
  await page.getByLabel('Prompt', { exact: true }).fill('private-foundation-prompt');
  await page.getByRole('button', { name: 'Send prompt' }).click();
  await expect(page.locator('#transcript')).toContainText('SYNTHETIC_RESPONSE'); await expect(page.locator('#session-state')).toHaveText('idle');
}
async function lifecycle(page: Page) { await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow'))); }
test('automatic reconnect stops if another tab changed the authenticated account', async ({ page }) => {
  let drop: (() => void) | undefined;
  await page.routeWebSocket('**/__hermes/api/ws', (socket) => { socket.connectToServer(); drop = () => socket.close({ code: 1012 }); });
  await chat(page); let tickets = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/auth/ws-ticket')) tickets++; });
  await page.route('**/__hermes/api/auth/me', (route) => route.fulfill({ json: { user_id: 'different-private-user', provider: 'basic' } }));
  drop!(); await expect(page.locator('#auth-state')).toHaveText('auth-required');
  await expect(page.locator('#session-key')).toHaveValue('');
  await expect(page.locator('#transcript')).not.toContainText('private-foundation-prompt'); expect(tickets).toBe(0);
});
for (const status of [401, 403]) {
  test(`ticket HTTP ${status} is terminal and accurately displayed`, async ({ page }) => {
    let tickets = 0;
    await page.route('**/__hermes/api/auth/ws-ticket', (route) => {
      tickets++; return route.fulfill({ status, json: { error: 'private-rejection-detail' } });
    });
    await signIn(page); await expect(page.locator('#gateway-state')).toHaveText(status === 401 ? 'auth-required' : 'error');
    await expect(page.locator('#rest-state')).toHaveText('healthy');
    await expect(page.locator('#connection-banner')).toContainText(status === 401 ? 'Authentication required' : 'access denied');
    await lifecycle(page); await expect(page.getByRole('button', { name: 'New session' })).toBeDisabled(); expect(tickets).toBe(1);
    await expect(page.getByRole('alert')).not.toContainText('private-rejection-detail');
  });
}
