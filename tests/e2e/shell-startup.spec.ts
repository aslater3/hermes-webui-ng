import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:8787' });
test('production shell mounts without a global React dependency', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled({ timeout: 10_000 });
  expect(errors).toEqual([]);
  await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
});
