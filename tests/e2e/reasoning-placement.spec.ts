import { test, expect } from '@playwright/test';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });

test('live reasoning stays expanded below current tool activity', async ({ page }) => {
  await login(page);
  await send(page, '[agent-test] approval live reasoning position');

  const reasoning = page.locator('.agent-reasoning');
  await expect(page.locator('.agent-tool')).toHaveCount(1);
  await expect(reasoning).toBeVisible();
  await expect(reasoning).toHaveAttribute('open', '');
  await expect(reasoning).toContainText('Testing an explicit, controlled interaction.');

  expect(await page.evaluate(() => {
    const tools = document.querySelector('.agent-tools');
    const liveReasoning = document.querySelector('.agent-reasoning');
    return !!tools && !!liveReasoning && !!(tools.compareDocumentPosition(liveReasoning) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);

  await reasoning.locator('summary').click();
  await expect(reasoning).not.toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await idle(page);
});
