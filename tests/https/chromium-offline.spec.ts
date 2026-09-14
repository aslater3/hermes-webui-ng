import { test, expect } from '@playwright/test';
import { login, send, idle } from '../e2e/shell-fixture.js';
import { reloadPwa } from '../e2e/pwa-navigation.js';

// Uses the supported Chromium offline-emulation path; WebKit has the real listener-loss test.
test('browser-wide offline mode relaunches HTTPS shell and reconnects without replay', async ({ page, context }) => {
  await login(page); await send(page, 'PRIVATE_AIRPLANE_MODE_CANARY'); await idle(page);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true); await reloadPwa(page);
  await expect(page.getByRole('heading', { name: 'You’re offline.' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('PRIVATE_AIRPLANE_MODE_CANARY');
  await context.setOffline(false); await expect(page.locator('#shell-prompt')).toBeEnabled();
  await expect(page.locator('[data-role="user"]')).toHaveCount(1);
});
