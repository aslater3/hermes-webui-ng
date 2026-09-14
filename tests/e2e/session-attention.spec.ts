import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle, newChat, conversations } from './shell-fixture.js';
test.use({ baseURL: 'http://127.0.0.1:8787' });

test('an unselected pending credential stays discoverable without keeping the entered value', async ({ page }, info) => {
  await login(page); await send(page, '[agent-test] secret attention');
  const field = page.getByLabel('Secret value', { exact: true }); await expect(field).toBeVisible();
  await field.fill('DO_NOT_RETAIN_DURING_SELECTION');
  await newChat(page); await send(page, 'Independent second conversation'); await idle(page);
  await expect(page.locator('.agent-secret')).toHaveCount(0);
  await conversations(page);
  const active = page.getByRole('region', { name: 'Active agent sessions' });
  await expect(active).toContainText('Needs your input');
  await page.getByRole('button', { name: 'Open active session: [agent-test] secret attention', exact: true }).click();
  await expect(field).toBeVisible(); await expect(field).toHaveValue('');
  await field.fill('SYNTHETIC_RESPONSE_VALUE'); await page.getByRole('button', { name: 'Save in Hermes', exact: true }).click();
  await idle(page); await expect(page.locator('[data-role="assistant"]').last()).toContainText('SYNTHETIC_AGENT_COMPLETE');
  await send(page, 'A normal turn after returning to the request'); await idle(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('session-attention.png') });
});

test('native completion in another conversation produces a review badge without interrupting current chat', async ({ page }) => {
  await login(page); await send(page, '[slow-test] background response');
  await newChat(page); await send(page, 'Current foreground response'); await idle(page);
  await conversations(page);
  const button = page.getByRole('button', { name: 'Open active session: [slow-test] background response', exact: true });
  await expect(button).toContainText('New activity');
  await button.click(); await idle(page);
  await expect(page.locator('[data-role="user"]').last()).toContainText('[slow-test] background response');
  await expect(page.locator('[data-role="user"]')).not.toContainText('Current foreground response');
});
