import { test, expect } from '@playwright/test';
import { login, send, idle, settings } from './shell-fixture.js';
test.use({ baseURL: 'http://127.0.0.1:8787' });

test('earlier observed activity expands on demand without reviving answered forms', async ({ page }, info) => {
  await login(page);
  for (let n = 0; n < 2; n++) {
    await send(page, `[agent-test] approval archive ${n}`);
    await page.getByRole('button', { name: 'Allow once', exact: true }).click(); await idle(page);
  }
  await send(page, 'Normal turn following tool activity'); await idle(page);
  await expect(page.locator('.agent-earlier > summary')).toContainText('(2 turns)');
  await expect(page.locator('.agent-archive .agent-tool')).toHaveCount(0);
  await page.locator('.agent-earlier > summary').click();
  await expect(page.locator('.agent-archived-turn')).toHaveCount(2);
  await page.locator('.agent-archived-turn > summary').first().click();
  await expect(page.locator('.agent-archive .agent-tool')).toHaveCount(1);
  await page.locator('.agent-archive .agent-tool > summary').click();
  await expect(page.locator('.agent-archive')).toContainText('SYNTHETIC_AGENT_COMPLETE');
  await expect(page.locator('.agent-archive input, .agent-archive textarea, .agent-archive button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('earlier-activity.png') });
  await page.reload(); await idle(page);
  await expect(page.locator('.agent-earlier')).toBeHidden();
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('lost credential admission supports stop and a fresh request without the original client', async ({ page }) => {
  await login(page); await send(page, '[agent-test] secret lost connection');
  await page.getByLabel('Secret value', { exact: true }).fill('DO_NOT_REPLAY');
  await settings(page); await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.locator('.agent-warning')).toContainText('Use Stop response');
  await expect(page.getByLabel('Secret value', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Save in Hermes', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop response', exact: true }).click(); await idle(page);
  await send(page, '[agent-test] secret fresh request');
  await expect(page.getByRole('button', { name: 'Save in Hermes', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Skip credential request', exact: true }).click(); await idle(page);
  await send(page, 'Continue after recovery'); await idle(page);
});

test('changed approval details with the same ID block confirmation on every viewport', async ({ page }) => {
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer();
    server.onMessage(raw => {
      const frame = JSON.parse(String(raw)); socket.send(raw);
      if (frame.params?.type === 'approval.request') {
        frame.params.payload.command = 'different operation under a reused ID'; socket.send(JSON.stringify(frame));
      }
    });
  });
  await login(page); await send(page, '[agent-test] approval changed details');
  await expect(page.locator('.agent-approval')).toContainText('Response disabled');
  await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop response', exact: true }).click(); await idle(page);
});
