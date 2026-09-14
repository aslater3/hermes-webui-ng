import { test, expect } from '@playwright/test';
import { login } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
test('composer controls have usable hit areas on desktop and phones', async ({ page }) => {
  await login(page);
  for (const control of ['Profile:', 'Model:', 'Reasoning:']) {
    const button = page.getByRole('button', { name: new RegExp(`^${control}`) });
    await expect(button).toBeEnabled();
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  const yolo = page.getByRole('switch', { name: 'YOLO mode for this conversation', exact: true });
  await expect(yolo).toBeEnabled();
  const yoloBox = await yolo.locator('xpath=..').boundingBox();
  expect(yoloBox?.height).toBeGreaterThanOrEqual(44);
  expect(yoloBox?.width).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
