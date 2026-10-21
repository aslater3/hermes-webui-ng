import { test, expect } from '@playwright/test';
import { login, send, idle, settings } from './shell-fixture.js';
test.use({ baseURL: 'http://127.0.0.1:8787' });

test('answered approvals do not revive after a later turn, and earlier turns are not kept as a second copy', async ({ page }, info) => {
  await login(page);
  for (let n = 0; n < 2; n++) {
    await send(page, `[agent-test] approval archive ${n}`);
    await page.getByRole('button', { name: 'Allow once', exact: true }).click(); await idle(page);
  }
  await send(page, 'Normal turn following tool activity'); await idle(page);
  // The turn timeline is the only copy of tool activity; the old "Earlier activity" panel is gone.
  await expect(page.locator('.agent-earlier')).toHaveCount(0);
  await expect(page.locator('.agent-archive')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('earlier-activity.png') });
  await page.reload(); await idle(page);
  await expect(page.locator('.agent-earlier')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('lost credential admission supports stop and a fresh request without the original client', async ({ page }) => {
  await login(page); await send(page, '[agent-test] secret lost connection');
  await page.getByLabel('Secret value', { exact: true }).fill('DO_NOT_REPLAY');
  await settings(page); await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Reconnect', exact: true }).click();
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
        // A new seq: an identical-seq copy is a duplicate the client drops by design (event-replay.ts); a changed
        // request arriving as a distinct event must still trip the reused-ID guard.
        frame.params.payload.command = 'different operation under a reused ID';
        if (typeof frame.params.seq === 'number') frame.params.seq += 100000;
        socket.send(JSON.stringify(frame));
      }
    });
  });
  await login(page); await send(page, '[agent-test] approval changed details');
  await expect(page.locator('.agent-approval')).toContainText('Response disabled');
  await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop response', exact: true }).click(); await idle(page);
});
