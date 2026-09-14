import { test, expect } from '@playwright/test';
import { login, send } from './shell-fixture.js';

test('approval is visually prominent and explains the Hermes expiry boundary', async ({ page }, info) => {
  await login(page);
  await send(page, `[agent-test] approval prominence ${info.project.name}`);
  const approval = page.getByRole('article', { name: 'Operation approval', exact: true });
  await expect(approval).toBeVisible();
  await expect(approval.getByRole('heading', { name: 'Permission required', exact: true })).toBeVisible();
  await expect(approval).toContainText('Hermes is paused until you decide');
  await expect(approval).toContainText('defaults to five minutes');
  await expect(approval.locator('.agent-input-status')).toHaveText('Action paused — choose Allow once or Deny');
  await expect(page.locator('.attention-strip')).toContainText('request need your input');
  const style = await approval.evaluate(element => {
    const computed = getComputedStyle(element);
    return { borderWidth: parseFloat(computed.borderTopWidth), borderColor: computed.borderTopColor, background: computed.backgroundColor };
  });
  expect(style.borderWidth).toBeGreaterThanOrEqual(2);
  expect(style.borderColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
  for (const name of ['Allow once', 'Deny']) {
    const box = await approval.getByRole('button', { name, exact: true }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await approval.screenshot({ path: info.outputPath('permission-required.png') });
});
