import { test, expect } from '@playwright/test';

test('completion settles and permits a second deliberate prompt without reload on every viewport', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('fixture');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#gateway-state')).toHaveText('ready');
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.locator('#session-state')).toHaveText('idle');
  const sessionKey = await page.locator('#session-key').inputValue();

  for (const [index, text] of ['first deliberate turn', 'second deliberate turn'].entries()) {
    await page.getByLabel('Prompt', { exact: true }).fill(text);
    await page.getByRole('button', { name: 'Send prompt', exact: true }).click();
    await expect(page.locator('#transcript .message').filter({ hasText: 'SYNTHETIC_RESPONSE' })).toHaveCount(
      index + 1,
    );
    // Vanilla Hermes emits completion before cleanup. Re-enable only after authoritative settlement.
    await expect(page.locator('#session-state')).toHaveText('idle');
    await expect(page.getByRole('button', { name: 'Send prompt', exact: true })).toBeEnabled();
    await expect(page.locator('#session-key')).toHaveValue(sessionKey);
  }

  await expect(page.locator('#transcript .message')).toHaveCount(4);
  await expect(page.getByRole('alert')).not.toBeVisible();
});
