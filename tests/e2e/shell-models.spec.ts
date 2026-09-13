import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle } from './shell-fixture.js';
test.use({ baseURL: 'http://127.0.0.1:8787' });
const modelButton = (page: Page, model: string) => page.getByRole('button', { name: `Model: ${model}`, exact: true });

test('choose an actual model before the first prompt without losing its draft; reload retains native setting', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page); await expect(modelButton(page, 'fixture-alpha')).toBeVisible();
  await page.locator('#shell-prompt').fill('Keep my unsent model-selection draft');
  await modelButton(page, 'fixture-alpha').click();
  await page.getByLabel('Search models').fill('beta');
  await page.getByLabel('Search models').press('Enter');
  await expect(page.locator('[data-role="user"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Use fixture-beta from Fixture provider', exact: true }).click();
  await expect(modelButton(page, 'fixture-beta')).toBeVisible();
  await expect(page.locator('#shell-prompt')).toHaveValue('Keep my unsent model-selection draft');
  await send(page, 'A turn with my selected model'); await idle(page); await page.reload();
  await expect(modelButton(page, 'fixture-beta')).toBeVisible();
  await modelButton(page, 'fixture-beta').click(); await expect(page.getByLabel('Search models')).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.modal-agent').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('model-picker.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('reasoning changes are session-scoped and the composer uses the confirmed native effort', async ({ page }, info) => {
  await login(page); await send(page, 'Reasoning setup'); await idle(page);
  await page.getByRole('button', { name: 'Reasoning: Medium', exact: true }).click();
  await expect(page.getByText('Avoid deleting this conversation in another client', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Set reasoning high', exact: true }).click();
  await expect(page.getByText('Current effort:', { exact: false })).toContainText('High');
  await page.screenshot({ path: info.outputPath('reasoning-picker.png') });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reasoning: High', exact: true })).toBeVisible();
  await send(page, 'Continue after reasoning change'); await idle(page);
  await page.reload(); await expect(page.getByRole('button', { name: 'Reasoning: High', exact: true })).toBeVisible();
});

test('a profile pick starts a separate conversation and keeps the old draft with its owner', async ({ page }) => {
  await login(page); await send(page, 'Default profile conversation'); await idle(page);
  const oldUrl = page.url(); await page.locator('#shell-prompt').fill('Private unsent default-profile draft');
  await page.getByRole('button', { name: 'Profile: default', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation with Work', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Profile: work', exact: true })).toBeVisible();
  await expect(modelButton(page, 'work-model')).toBeVisible(); await expect(page.locator('#shell-prompt')).toHaveValue('');
  await send(page, 'Work profile conversation'); await idle(page);
  await page.goBack(); await expect(page).toHaveURL(oldUrl);
  await expect(page.getByRole('button', { name: 'Profile: default', exact: true })).toBeVisible();
  await expect(page.locator('#shell-prompt')).toHaveValue('Private unsent default-profile draft');
  await expect(page.locator('[data-role="user"]')).not.toContainText('Work profile conversation');
});

test('costly model changes require a distinct confirmation and mandatory reasoning cannot be disabled', async ({ page }) => {
  await login(page); await send(page, 'Cost confirmation setup'); await idle(page);
  await modelButton(page, 'fixture-alpha').click();
  await page.getByRole('button', { name: 'Use fixture-premium from Fixture provider', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm model change' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel change' }).click();
  await expect(page.getByText('Current: fixture-alpha', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Use fixture-premium from Fixture provider', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm model change', exact: true }).click();
  await expect(page.getByText('Current: fixture-premium', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: /^Reasoning:/ }).click();
  await expect(page.getByRole('button', { name: 'Set reasoning none', exact: true })).toHaveCount(0);
});

test('unsupported inventory is honest, while chat remains usable', async ({ page }) => {
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer();
    socket.onMessage(raw => { const rpc = JSON.parse(String(raw));
      if (rpc.method === 'model.options') socket.send(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601 } }));
      else server.send(raw);
    });
    server.onMessage(raw => socket.send(raw));
  });
  await login(page); await page.getByRole('button', { name: 'Model: not reported', exact: true }).click();
  await expect(page.getByText('Not supported by this Hermes version.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await send(page, 'Chat still works without an inventory RPC'); await idle(page);
});

test('model and reasoning controls lock during a native turn and re-enable after interruption', async ({ page }) => {
  await login(page); await send(page, '[slow-test] control-lock regression');
  await expect(page.getByRole('button', { name: /^Model:/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Reasoning:/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop response' }).click(); await idle(page);
  await expect(page.getByRole('button', { name: /^Model:/ })).toBeEnabled();
});

test('trusted-local deployment uses the same working model and reasoning controls without fake login', async ({ page }) => {
  await page.goto('http://127.0.0.1:8789');
  await expect(modelButton(page, 'fixture-alpha')).toBeVisible();
  await expect(page.getByText('Trusted LAN · No login', { exact: true })).toBeVisible();
  await modelButton(page, 'fixture-alpha').click();
  await page.getByRole('button', { name: 'Use fixture-beta from Fixture provider', exact: true }).click();
  await expect(modelButton(page, 'fixture-beta')).toBeVisible();
  await page.getByRole('button', { name: /^Reasoning:/ }).click();
  await page.getByRole('button', { name: 'Set reasoning low', exact: true }).click();
  await expect(page.getByText('Current effort:', { exact: false })).toContainText('Low');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await send(page, 'A local-mode turn with the selected model'); await idle(page);
  expect(await page.evaluate(() => sessionStorage.length + localStorage.length)).toBe(0);
});
