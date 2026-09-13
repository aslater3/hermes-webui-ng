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

test('uses HermesUI NG branding and the supplied Hermes mark', async ({ page }) => {
  await page.goto('/');
  const brand = page.locator('.brand').first();
  await expect(brand.getByText('HermesUI', { exact: true })).toBeVisible();
  await expect(brand.getByText('NG', { exact: true })).toBeVisible();
  const mark = brand.locator('.hermes-mark');
  await expect(mark).toBeVisible();
  const maskImage = await mark.evaluate(element => {
    const style = getComputedStyle(element);
    return `${style.maskImage} ${style.getPropertyValue('-webkit-mask-image')}`;
  });
  expect(maskImage.replaceAll('none', '').trim()).not.toBe('');
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
  const welcomeMark = page.locator('.welcome-mark');
  await expect(welcomeMark).toBeVisible();
  await expect(welcomeMark.locator('.lucide-sparkles')).toBeHidden();
  const replacementMask = await welcomeMark.evaluate(element => {
    const style = getComputedStyle(element, '::before');
    return `${style.maskImage} ${style.getPropertyValue('-webkit-mask-image')}`;
  });
  expect(replacementMask.replaceAll('none', '').trim()).not.toBe('');
});
