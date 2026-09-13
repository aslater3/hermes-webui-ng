import { test, expect } from '@playwright/test';
import { login, send, idle, settings } from './shell-fixture.js';
test.use({ baseURL: 'http://127.0.0.1:8787' });

test('stale visual viewport measurements cannot push the composer below the CSS viewport', async ({ page }) => {
  await login(page); await send(page, 'Viewport regression'); await idle(page);
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 420 });
  // Deliberately emulate a delayed callback, rather than waiting for it to fix itself.
  await page.evaluate(() => document.documentElement.style.setProperty('--app-height', '900px'));
  const bounds = await page.evaluate(() => {
    const composer = document.getElementById('shell-composer')!.getBoundingClientRect();
    const transcript = document.getElementById('conversation-scroll')!.getBoundingClientRect();
    return { composer: composer.bottom, transcript: transcript.bottom, top: composer.top, height: innerHeight };
  });
  expect(bounds.composer).toBeLessThanOrEqual(bounds.height);
  expect(bounds.transcript).toBeLessThanOrEqual(bounds.top);
  await settings(page);
  const modal = await page.getByRole('dialog', { name: 'Settings', exact: true }).boundingBox();
  expect(modal!.height).toBeLessThanOrEqual(420);
});
