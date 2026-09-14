import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
const prompt = (page: Page) => page.locator('#shell-prompt');
const browse = (page: Page) => page.getByRole('button', { name: 'Browse Hermes commands', exact: true });
const catalogue = (page: Page) => page.getByRole('dialog', { name: 'Hermes commands', exact: true });
const output = (page: Page, command = '/usage') => page.getByRole('dialog', { name: `Command ${command}`, exact: true });

/** SYNTHETIC browser transport inspection. Actual vanilla-Hermes assertions run in phase4b.ts. */
async function inspect(page: Page) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let missing = '', text: string | undefined, hold = false, release: (() => void) | undefined;
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer();
    socket.onMessage(raw => {
      const frame = JSON.parse(String(raw));
      if (typeof frame.method === 'string') calls.push({ method: frame.method, params: frame.params ?? {} });
      if (frame.method === missing) socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'PRIVATE_UPSTREAM_DETAILS' } }));
      else if (frame.method === 'slash.exec' && (text !== undefined || hold)) {
        const respond = () => socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { output: text ?? 'Delayed native read' } }));
        if (hold) release = respond; else respond();
      } else server.send(raw);
    });
    server.onMessage(raw => socket.send(raw));
  });
  return { calls, fail: (method: string) => { missing = method; }, text: (value: string) => { text = value; },
    hold: () => { hold = true; }, release: () => { hold = false; release?.(); },
    count: (method: string) => calls.filter(call => call.method === method).length };
}
async function submitCommand(page: Page, text: string) {
  await expect(prompt(page)).toBeEnabled(); await prompt(page).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}

test('slash completion is accessible, preserves IME input, and never executes until a deliberate send', async ({ page }, info) => {
  const rpc = await inspect(page); await login(page); await send(page, 'Command completion setup'); await idle(page);
  const prompts = rpc.count('prompt.submit');
  await prompt(page).fill('/us');
  const suggestions = page.getByRole('listbox', { name: 'Slash command suggestions' });
  await expect(suggestions).toBeVisible();
  const option = suggestions.getByRole('option', { name: /^\/usage/ });
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await prompt(page).dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await expect(prompt(page)).toHaveValue('/us'); expect(rpc.count('slash.exec')).toBe(0);
  await prompt(page).press('Escape'); await expect(suggestions).toHaveCount(0);
  await prompt(page).fill('/sta'); await expect(suggestions).toBeVisible();
  await prompt(page).press('Tab'); await expect(prompt(page)).toHaveValue('/status ');
  expect(rpc.count('slash.exec')).toBe(0); expect(rpc.count('prompt.submit')).toBe(prompts);
  await prompt(page).fill('/us'); await expect(option).toBeVisible();
  expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await new AxeBuilder({ page }).include('#shell-composer').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('slash-completion.png') });
  await option.click(); await expect(prompt(page)).toHaveValue('/usage ');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(output(page)).toContainText('Native default /usage');
  expect(rpc.count('slash.exec')).toBe(1); expect(rpc.count('prompt.submit')).toBe(prompts);
  await output(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(prompt(page)).toHaveValue(''); await expect(browse(page)).toBeFocused();
});

test('searchable catalogue and native readout preserve a first-message draft at mobile keyboard height', async ({ page }, info) => {
  const rpc = await inspect(page); await login(page); await prompt(page).fill('An unsent draft that must survive');
  expect((await browse(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await browse(page).click();
  await expect(catalogue(page).getByRole('button', { name: 'Use /undo', exact: true })).toBeDisabled();
  await expect(catalogue(page).getByRole('button', { name: 'Use /default-skill', exact: true })).toBeDisabled();
  expect((await new AxeBuilder({ page }).include('.modal-commands').analyze()).violations).toEqual([]);
  await page.getByLabel('Search Hermes commands', { exact: true }).fill('token');
  await expect(catalogue(page).locator('.command-catalogue-row')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('command-catalogue.png') });
  await catalogue(page).getByRole('button', { name: 'Use /usage', exact: true }).click();
  await expect(output(page)).toContainText('Native default /usage'); expect(rpc.count('prompt.submit')).toBe(0);
  expect((await new AxeBuilder({ page }).include('.modal-commands').analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 360 });
  await expect(output(page).getByRole('button', { name: 'Close command /usage', exact: true })).toBeInViewport();
  await output(page).getByRole('button', { name: 'Close command /usage', exact: true }).click();
  await expect(prompt(page)).toHaveValue('An unsent draft that must survive'); await expect(browse(page)).toBeFocused();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('Native default');
});

test('unknown and mutating slash forms fail closed while the explicit literal escape sends ordinary text', async ({ page }) => {
  const rpc = await inspect(page); await login(page); await send(page, 'Command rejection setup'); await idle(page);
  const prompts = rpc.count('prompt.submit');
  for (const command of ['/unknown', '/undo', '/usage reset', '/model other --global', '/unsafe']) {
    await submitCommand(page, command);
    await expect(page.locator('.conversation-content')).toContainText(/not available|takes no arguments/);
    await expect(prompt(page)).toBeEnabled(); await expect(prompt(page)).toHaveValue(command);
    expect(rpc.count('prompt.submit')).toBe(prompts); expect(rpc.count('slash.exec')).toBe(0);
  }
  await submitCommand(page, '//usage');
  await expect(page.locator('[data-role="user"]').last().locator('.user-text')).toHaveText('/usage'); await idle(page);
  const admitted = rpc.calls.filter(call => call.method === 'prompt.submit');
  expect(admitted).toHaveLength(prompts + 1);
  expect(admitted.at(-1)!.params).toEqual({ session_id: expect.any(String), text: '/usage' });
  expect(rpc.count('command.dispatch')).toBe(0); expect(rpc.count('config.set')).toBe(0);
});

test('advertised picker shortcuts retain official model, reasoning and context controls without implicit mutations', async ({ page }) => {
  const rpc = await inspect(page); await login(page); await send(page, 'Picker shortcut setup'); await idle(page);
  await submitCommand(page, '/model'); await expect(page.getByLabel('Search models', { exact: true })).toBeVisible();
  expect(rpc.count('config.set')).toBe(0);
  await page.getByRole('button', { name: 'Use fixture-beta from Fixture provider', exact: true }).click();
  await expect(page.getByText('Current: fixture-beta', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await submitCommand(page, '/reasoning'); await expect(page.getByRole('button', { name: 'Set reasoning high', exact: true })).toBeVisible();
  expect(rpc.count('config.set')).toBe(1);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await submitCommand(page, '/context'); await expect(page.getByRole('dialog', { name: 'Usage & context', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await submitCommand(page, '/h token'); await expect(page.getByLabel('Search Hermes commands', { exact: true })).toHaveValue('token');
  await expect(catalogue(page).locator('.command-catalogue-row')).toHaveCount(1);
  expect(rpc.count('prompt.submit')).toBe(1); expect(rpc.count('slash.exec')).toBe(0); expect(rpc.count('command.dispatch')).toBe(0);
});

test('profile shortcut replaces catalogue ownership and never carries command output or a draft across profiles', async ({ page }) => {
  const rpc = await inspect(page); await login(page); await send(page, 'Default profile command owner'); await idle(page);
  const oldUrl = page.url(); await prompt(page).fill('Default private draft');
  await browse(page).click(); await catalogue(page).getByRole('button', { name: 'Use /profile', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation with Work', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Profile: work', exact: true })).toBeVisible();
  await expect(prompt(page)).toHaveValue(''); await browse(page).click();
  await expect(catalogue(page).getByRole('button', { name: 'Use /work-skill', exact: true })).toBeDisabled();
  await expect(catalogue(page).getByRole('button', { name: 'Use /default-skill', exact: true })).toHaveCount(0);
  await catalogue(page).getByRole('button', { name: 'Use /status', exact: true }).click();
  await expect(output(page, '/status')).toContainText('Native work /status');
  await expect(output(page, '/status')).not.toContainText('Default private draft');
  await page.reload(); await expect(output(page, '/status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Profile: work', exact: true })).toBeVisible();
  await page.goto(oldUrl); await expect(page.getByRole('button', { name: 'Profile: default', exact: true })).toBeVisible();
  await browse(page).click(); await expect(catalogue(page).getByRole('button', { name: 'Use /default-skill', exact: true })).toBeDisabled();
  expect(rpc.calls.filter(call => call.method === 'slash.exec').map(call => call.params.profile)).toEqual(['work']);
  expect(rpc.count('prompt.submit')).toBe(1);
});

for (const method of ['commands.catalog', 'slash.exec']) test(`missing ${method} is explicit without generic dispatch or model fallback`, async ({ page }) => {
  const rpc = await inspect(page); rpc.fail(method); await login(page); await send(page, 'Missing command capability'); await idle(page);
  await submitCommand(page, '/usage'); await expect(prompt(page)).toBeEnabled();
  await expect(prompt(page)).toHaveValue('/usage');
  await expect(page.locator('body')).toContainText('Not supported by this Hermes version.');
  await expect(page.locator('body')).not.toContainText('PRIVATE_UPSTREAM_DETAILS');
  expect(rpc.count('prompt.submit')).toBe(1); expect(rpc.count('command.dispatch')).toBe(0);
  expect(rpc.count('slash.exec')).toBe(method === 'commands.catalog' ? 0 : 1);
});

test('native results are bounded inert text and disappear on document hiding without replay', async ({ page }, info) => {
  const rpc = await inspect(page); rpc.text('<script>window.phase7Injected=true</script>\n' + 'PRIVATE_READOUT_'.repeat(3000));
  await login(page); await send(page, 'Inert command result setup'); await idle(page);
  await submitCommand(page, '/history'); const readout = output(page, '/history');
  await expect(readout).toContainText('Output limited to 32,768 characters.');
  expect((await readout.getByRole('region', { name: 'Native command output' }).textContent())!.length).toBe(32768);
  expect(await page.evaluate(() => 'phase7Injected' in window)).toBe(false);
  await expect(readout.locator('script')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('PRIVATE_READOUT');
  await page.screenshot({ path: info.outputPath('bounded-command-output.png') });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(readout).toHaveCount(0);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(browse(page)).toBeEnabled(); await expect(readout).toHaveCount(0);
  expect(rpc.count('slash.exec')).toBe(1);
});

test('a pending native read locks mutations and discards its result when another conversation is selected', async ({ page }) => {
  const rpc = await inspect(page); await login(page); await send(page, 'Pending command owner'); await idle(page);
  rpc.hold(); await submitCommand(page, '/usage');
  await expect.poll(() => rpc.count('slash.exec')).toBe(1);
  await expect(prompt(page)).toBeDisabled(); await expect(page.getByRole('button', { name: /^Model:/ })).toBeDisabled();
  await expect(page.getByRole('switch', { name: 'YOLO mode for this conversation', exact: true })).toBeDisabled();
  await page.evaluate(() => { history.pushState(null, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(prompt(page)).toBeEnabled();
  await prompt(page).fill('New view draft'); rpc.release();
  await expect(output(page)).toHaveCount(0); await expect(prompt(page)).toHaveValue('New view draft');
  expect(rpc.count('slash.exec')).toBe(1); expect(rpc.count('config.set')).toBe(0);
});
