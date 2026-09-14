import { test, expect } from '@playwright/test';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });

test('reasoning cards remain collapsed and interleave chronologically with tools', async ({ page }) => {
  await login(page);
  await send(page, '[agent-test] approval reasoning timeline');

  const timeline = page.locator('.agent-timeline');
  const reasoning = timeline.locator('.agent-reasoning-card');
  await expect(timeline.locator('.agent-tool')).toHaveCount(1);
  await expect(reasoning).toHaveCount(2);
  await expect(reasoning.first()).not.toHaveAttribute('open', '');
  await expect(reasoning.nth(1)).not.toHaveAttribute('open', '');
  await expect(reasoning.first().locator('summary')).toContainText('Testing an explicit, controlled interaction.');
  await expect(reasoning.nth(1).locator('summary')).toContainText('Reviewing the tool activity before continuing.');

  expect(await timeline.locator(':scope > .agent-reasoning-card, :scope > .agent-tool').evaluateAll(nodes =>
    nodes.map(node => node.classList.contains('agent-reasoning-card') ? 'reasoning' : 'tool'))).toEqual(['reasoning', 'tool', 'reasoning']);

  await reasoning.first().locator('summary').click();
  await expect(reasoning.first()).toHaveAttribute('open', '');
  await expect(reasoning.first()).toContainText('<img src=x onerror=alert(1)>');
  await expect(reasoning.locator('img')).toHaveCount(0);

  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await idle(page);
  await expect(reasoning.first()).toHaveAttribute('open', '');
});
