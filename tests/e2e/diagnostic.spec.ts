import { test, expect } from '@playwright/test';

test('sign in, native prompt, reload recovery and mobile controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('fixture');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#gateway-state')).toHaveText('ready');
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.locator('#session-state')).toHaveText('idle');
  await page.getByLabel('Prompt', { exact: true }).fill('<img src=x onerror=alert(1)> ' + 'long'.repeat(200));
  await page.getByRole('button', { name: 'Send prompt' }).click();
  await expect(page.getByLabel('Conversation')).toContainText('SYNTHETIC_RESPONSE');
  await expect(page.locator('#transcript img')).toHaveCount(0);
  const key = await page.locator('#session-key').inputValue();
  await page.reload();
  await expect(page.locator('#session-state')).toHaveText('idle');
  await expect(page.locator('#session-key')).toHaveValue(key);
  await expect(page.getByLabel('Conversation')).toContainText('SYNTHETIC_RESPONSE');
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.locator('#gateway-state')).toHaveText('ready');
  await expect(page.getByLabel('Conversation')).toContainText('SYNTHETIC_RESPONSE');
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual(
    { local: 0, session: 0 },
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const name of ['New session', 'Send prompt', 'Reconnect']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(errors).toEqual([]);
});

test('wrong password remains gated and password is cleared', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('fixture');
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#password')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'New session' })).toBeDisabled();
});
