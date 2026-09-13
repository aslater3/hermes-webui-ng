import { test, expect } from '@playwright/test';
import { login } from './shell-fixture.js';
test.use({ baseURL: 'http://127.0.0.1:8787' });

test('theme switches never interpolate control colours against the new palette', async ({ page }) => {
  await login(page);
  for (const colorScheme of ['dark', 'light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    const transitions = await page.locator('.welcome-suggestions button').evaluateAll(nodes =>
      nodes.map(node => getComputedStyle(node).transitionDuration));
    expect(transitions.length).toBeGreaterThan(0);
    expect(transitions.every(value => value === '0s')).toBe(true);
  }
});
