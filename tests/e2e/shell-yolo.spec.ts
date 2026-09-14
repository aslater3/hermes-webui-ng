import { test, expect } from '@playwright/test';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });

test('composer YOLO switch is session scoped and survives authoritative reload', async ({ page }) => {
  await login(page);
  const yolo = page.getByRole('switch', { name: 'YOLO mode for this conversation', exact: true });
  await expect(yolo).toBeEnabled();
  await expect(yolo).not.toBeChecked();

  await yolo.check();
  await expect(yolo).toBeChecked();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'YOLO mode for this conversation', exact: true })).toBeChecked();

  await page.getByRole('switch', { name: 'YOLO mode for this conversation', exact: true }).uncheck();
  await expect(page.getByRole('switch', { name: 'YOLO mode for this conversation', exact: true })).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'YOLO mode for this conversation', exact: true })).not.toBeChecked();
});

test('approval YOLO enables the session switch then resolves only the pending request', async ({ page }) => {
  await login(page);
  await send(page, '[agent-test] approval');

  const approval = page.getByRole('article', { name: 'Operation approval', exact: true });
  await expect(approval.getByRole('button', { name: 'Allow once', exact: true })).toBeEnabled();
  await expect(approval.getByRole('button', { name: 'Approve for session', exact: true })).toBeEnabled();
  await expect(approval.getByRole('button', { name: 'YOLO', exact: true })).toBeEnabled();
  await expect(approval.getByRole('button', { name: /Always/ })).toHaveCount(0);

  const yolo = page.getByRole('switch', { name: 'YOLO mode for this conversation', exact: true });
  await expect(yolo).toBeDisabled();
  await expect(yolo).not.toBeChecked();

  await approval.getByRole('button', { name: 'YOLO', exact: true }).click();
  await idle(page);
  await expect(yolo).toBeEnabled();
  await expect(yolo).toBeChecked();
  await expect(page.locator('[data-role="assistant"]').last()).toContainText('SYNTHETIC_AGENT_COMPLETE');

  await yolo.uncheck();
  await expect(yolo).not.toBeChecked();
});
