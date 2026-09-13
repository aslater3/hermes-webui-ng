import { test, expect } from '@playwright/test';

test('failed startup remains visible after page restore and sign-in stays disabled', async ({ page }) => {
  await page.route('**/__hermes/api/status', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('HTTP 503');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
});
