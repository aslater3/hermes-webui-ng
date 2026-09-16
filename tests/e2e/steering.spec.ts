import { test, expect, type Page } from '@playwright/test';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });

async function steeringFixture(page: Page, status: 'queued' | 'rejected' = 'queued') {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const upstream = socket.connectToServer();
    socket.onMessage(raw => {
      const frame = JSON.parse(String(raw));
      calls.push({ method: String(frame.method || ''), params: frame.params ?? {} });
      if (frame.method === 'session.steer') {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { status, text: String(frame.params?.text ?? '') } }));
      } else upstream.send(raw);
    });
    upstream.onMessage(raw => socket.send(raw));
  });
  return calls;
}

test('ordinary text stays editable while Hermes works and sends exactly one native steer', async ({ page }) => {
  const calls = await steeringFixture(page);
  await login(page);
  await send(page, '[slow-test] keep this turn running for steering');
  const field = page.locator('#shell-prompt');
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toBeEnabled();
  await expect(field).toBeEnabled();
  await expect(field).toHaveAttribute('placeholder', 'Steer Hermes while it works…');

  const userCount = await page.locator('[data-role="user"]').count();
  await field.fill('Keep the API contract unchanged and fix the tests first');
  const steer = page.getByRole('button', { name: 'Steer current response', exact: true });
  await expect(steer).toBeEnabled();
  expect((await steer.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await steer.click();

  await expect(field).toHaveValue('');
  await expect(page.getByRole('status').filter({ hasText: 'Steered into current turn' })).toBeVisible();
  expect(calls.filter(call => call.method === 'prompt.submit')).toHaveLength(1);
  expect(calls.filter(call => call.method === 'session.steer').map(call => call.params)).toEqual([
    { session_id: expect.any(String), text: 'Keep the API contract unchanged and fix the tests first' },
  ]);
  expect(await page.locator('[data-role="user"]').count()).toBe(userCount);
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop response', exact: true }).click();
  await idle(page);
});

test('a rejected native steer keeps the draft so the user can retry or stop', async ({ page }) => {
  const calls = await steeringFixture(page, 'rejected');
  await login(page);
  await send(page, '[slow-test] reject a steering instruction');
  const field = page.locator('#shell-prompt');
  await expect(field).toBeEnabled();
  await field.fill('Do not lose this steering draft');
  await page.getByRole('button', { name: 'Steer current response', exact: true }).click();
  await expect(field).toHaveValue('Do not lose this steering draft');
  expect(calls.filter(call => call.method === 'session.steer')).toHaveLength(1);
  expect(calls.filter(call => call.method === 'prompt.submit')).toHaveLength(1);
  await page.getByRole('button', { name: 'Stop response', exact: true }).click();
  await idle(page);
});
