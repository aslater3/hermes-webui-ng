import { test, expect } from '@playwright/test';

test('connection details have touch-sized controls and remain usable in a reduced-height viewport', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('#auth-state')).toHaveText('auth-required');
  await page.getByLabel('Username', { exact: true }).fill('fixture');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#gateway-state')).toHaveText('ready');
  await page.locator('#diagnostics-panel summary').click();
  await expect(page.locator('#cap-sessionsList')).toContainText('available');
  await page.screenshot({ path: info.outputPath('connection-foundation.png'), fullPage: true });
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: 360 });
  const copy = page.getByRole('button', { name: 'Copy diagnostics' });
  await copy.scrollIntoViewIfNeeded();
  const box = await copy.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const report = page.locator('#diagnostic-report');
  await report.focus();
  expect(await report.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  await expect(report).toBeFocused();
});
