import { test, expect } from '@playwright/test';
test.use({ baseURL: 'http://127.0.0.1:8789' });

test('explicit legacy diagnostic route respects the same local access state', async ({ page }) => {
  await page.goto('/diagnostic');
  await expect(page.locator('#auth-state')).toHaveText('local-access');
  await expect(page.locator('#gateway-state')).toHaveText('ready');
  await expect(page.locator('#login-form')).toBeHidden();
  await expect(page.locator('#signout')).toBeHidden();
  await page.locator('#create').click();
  await expect(page.locator('#session-state')).toHaveText('idle');
  await page.locator('#prompt').fill('Local diagnostic parity'); await page.locator('#send').click();
  await expect(page.locator('#transcript')).toContainText('SYNTHETIC_RESPONSE');
});
