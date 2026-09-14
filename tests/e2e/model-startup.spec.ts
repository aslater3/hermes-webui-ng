import { test, expect } from '@playwright/test';
import { login } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
test('a first model selection waits for native construction and sends one setter', async ({ page }) => {
  let startingSnapshots = 3, setters = 0;
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer(), methods = new Map<string | number, string>();
    socket.onMessage(raw => {
      const request = JSON.parse(String(raw)); methods.set(request.id, request.method);
      if (request.method === 'config.set') { expect(startingSnapshots).toBe(0); setters++; }
      server.send(raw);
    });
    server.onMessage(raw => {
      const frame = JSON.parse(String(raw));
      if (methods.get(frame.id) === 'session.activate' && frame.result && startingSnapshots > 0) {
        frame.result.status = 'starting'; frame.result.info = { ...frame.result.info, lazy: true }; startingSnapshots--;
      }
      socket.send(JSON.stringify(frame));
    });
  });
  await login(page);
  await page.locator('#shell-prompt').fill('Preserve this draft while the native agent starts');
  await page.getByRole('button', { name: 'Model: fixture-alpha', exact: true }).click();
  await page.getByRole('button', { name: 'Use fixture-beta from Fixture provider', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Model: fixture-beta', exact: true })).toBeVisible();
  await expect(page.locator('#shell-prompt')).toHaveValue('Preserve this draft while the native agent starts');
  expect(setters).toBe(1);
  await expect(page.locator('[data-role="user"]')).toHaveCount(0);
});
