import { test, expect } from '@playwright/test';
import { login, send, idle } from './shell-fixture.js';
test.use({ baseURL: 'http://127.0.0.1:8787' });
test('immediate reload after turn completion leaves no delayed request in the departing document', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page);
  for (let turn = 1; turn <= 3; turn++) {
    await send(page, `Departure regression ${turn}`);
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(turn); await idle(page);
    await page.reload(); await expect(page.locator('[data-role="assistant"]')).toHaveCount(turn); await idle(page);
  }
  expect(errors).toEqual([]);
});
