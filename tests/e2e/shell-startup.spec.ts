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

test('identity discovery completes before credentials become editable', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__hermes/api/auth/me', async route => {
    await pending;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByLabel('Username', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Password', { exact: true })).toBeDisabled();
  release();
  await expect(page.getByLabel('Username', { exact: true })).toBeEnabled();
  await page.getByLabel('Username', { exact: true }).fill('fixture');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connection status: Connected' })).toBeVisible();
});
