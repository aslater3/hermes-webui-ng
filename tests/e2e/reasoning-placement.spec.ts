import { test, expect } from '@playwright/test';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });

test('thought rows stay collapsed and interleave chronologically with tool rows', async ({ page }) => {
  await login(page);
  await send(page, '[agent-test] approval reasoning timeline');

  const thoughts = page.locator('[data-row="thought"]');
  await expect(page.locator('[data-row="tools"]')).toHaveCount(1);
  await expect(thoughts).toHaveCount(2);
  await expect(thoughts.first().locator('.turn-row-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(thoughts.nth(1).locator('.turn-row-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(thoughts.first().locator('.turn-preview')).toContainText('Testing an explicit, controlled interaction.');
  await expect(thoughts.nth(1).locator('.turn-preview')).toContainText('Reviewing the tool activity before continuing.');

  expect(await page.locator('.turn-rows > li').evaluateAll(nodes => nodes.map(node => node.dataset.row).filter(row => row !== 'narration')))
    .toEqual(['thought', 'tools', 'thought']);

  await thoughts.first().locator('.turn-row-toggle').click();
  await expect(thoughts.first().locator('.turn-row-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(thoughts.first().locator('.turn-thought-text')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.turn-rows img')).toHaveCount(0);

  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await idle(page);
  // The row the user opened stays open after the turn settles.
  await expect(thoughts.first().locator('.turn-row-toggle')).toHaveAttribute('aria-expanded', 'true');
});
