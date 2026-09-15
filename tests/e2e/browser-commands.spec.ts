import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
const field = (page: Page) => page.locator('#shell-prompt');
const modal = (page: Page) => page.getByRole('dialog', { name: 'Browser command', exact: true });
const names = ['/new', '/clear', '/sessions', '/resume', '/copy', '/prompt', '/redraw'];
async function fixture(page: Page) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let copyHistory: unknown;
  // Synthetic native catalogue/optional title/history shapes, not live-Hermes certification.
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer(), requests = new Map<unknown, string>();
    socket.onMessage(raw => {
      const frame = JSON.parse(String(raw)); calls.push({ method: frame.method, params: frame.params ?? {} });
      const result = (value: unknown) => socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: value }));
      if (frame.method === 'session.title') { result({ title: frame.params.title, pending: false }); return; }
      if (frame.method === 'session.history' && copyHistory) { result(copyHistory); return; }
      requests.set(frame.id, frame.method); server.send(raw);
    });
    server.onMessage(raw => {
      const frame = JSON.parse(String(raw));
      if (requests.get(frame.id) === 'commands.catalog' && frame.result?.pairs) {
        frame.result.pairs.push(...names.map(name => [name, `Browser command ${name}`]));
        frame.result.canon = { ...frame.result.canon, '/compose': '/prompt', '/reset': '/new' };
      }
      requests.delete(frame.id); socket.send(JSON.stringify(frame));
    });
  });
  return { calls, history: (value: unknown) => { copyHistory = value; }, count: (method: string) => calls.filter(call => call.method === method).length };
}
async function openCommand(page: Page, text: string) {
  await field(page).fill(text); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(modal(page)).toBeVisible();
}

test('clear creates a real new conversation without erasing the previous native transcript', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Old conversation must survive'); await idle(page);
  const old = page.url(), before = rpc.count('session.create');
  await openCommand(page, '/clear'); expect(rpc.count('session.create')).toBe(before);
  await modal(page).getByRole('button', { name: 'Done', exact: true }).click(); await expect(field(page)).toHaveValue('/clear');
  await openCommand(page, '/clear'); await modal(page).getByRole('button', { name: 'Start new conversation', exact: true }).click();
  await idle(page); await expect.poll(() => rpc.count('session.create')).toBe(before + 1);
  await expect(page.locator('[data-role="user"]')).toHaveCount(0); await expect(field(page)).toHaveValue('');
  await page.goto(old); await idle(page); await expect(page.locator('[data-role="user"]').last()).toContainText('Old conversation must survive');
  expect(rpc.count('slash.exec')).toBe(0); expect(rpc.count('command.dispatch')).toBe(0); expect(rpc.count('prompt.submit')).toBe(1);
});

test('new uses the selected profile and applies an optional title only to the newly created runtime', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Default owner'); await idle(page);
  await page.getByRole('button', { name: 'Profile: default', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation with Work', exact: true }).click(); await idle(page);
  await openCommand(page, '/new Project notes'); await modal(page).getByRole('button', { name: 'Start new conversation', exact: true }).click(); await idle(page);
  await expect.poll(() => rpc.count('session.title')).toBe(1);
  expect(rpc.calls.filter(call => call.method === 'session.create').at(-1)?.params.profile).toBe('work');
  expect(rpc.calls.find(call => call.method === 'session.title')?.params).toEqual({ session_id: expect.any(String), title: 'Project notes' });
  await expect(page.getByRole('button', { name: 'Profile: work', exact: true })).toBeVisible();
  expect(rpc.count('command.dispatch')).toBe(0); expect(rpc.count('slash.exec')).toBe(0);
});

test('resume searches native saved conversations and waits for an explicit selected result', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Find this exact conversation'); await idle(page);
  const old = page.url();
  await openCommand(page, '/new'); await modal(page).getByRole('button', { name: 'Start new conversation', exact: true }).click(); await idle(page);
  await send(page, 'Second conversation'); await idle(page);
  const count = rpc.count('session.resume'); await openCommand(page, '/resume Find this exact');
  await expect(modal(page).getByLabel('Search saved conversations', { exact: true })).toHaveValue('Find this exact');
  const matches = modal(page).getByRole('region', { name: 'Matching saved conversations', exact: true });
  const row = matches.getByRole('button').filter({ hasText: 'Find this exact conversation' });
  await expect(row).toBeVisible(); expect(rpc.count('session.resume')).toBe(count);
  await row.click(); await idle(page); await expect(page).toHaveURL(old);
  await expect(page.locator('[data-role="user"]').last()).toContainText('Find this exact conversation');
  expect(rpc.count('slash.exec')).toBe(0); expect(rpc.count('command.dispatch')).toBe(0);
});

test('expanded browser prompt preserves cancellation, applies literal input deliberately and meets mobile accessibility', async ({ page }, info) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Expanded editor setup'); await idle(page);
  await openCommand(page, '/compose Initial text'); await expect(field(page)).toHaveValue('/compose Initial text'); await expect(field(page)).toBeDisabled();
  const editor = modal(page).getByLabel('Expanded prompt editor', { exact: true }); await expect(editor).toHaveValue('Initial text');
  await editor.fill('/literal edited prompt');
  expect((await new AxeBuilder({ page }).include('.modal-commands').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('browser-prompt-editor.png') });
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 360 });
  const apply = modal(page).getByRole('button', { name: 'Use edited prompt as draft', exact: true });
  await apply.scrollIntoViewIfNeeded(); const box = await apply.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
  await modal(page).getByRole('button', { name: 'Done', exact: true }).click(); await expect(field(page)).toHaveValue('/compose Initial text');
  await openCommand(page, '/prompt Initial text'); await modal(page).getByLabel('Expanded prompt editor', { exact: true }).fill('/literal edited prompt');
  await modal(page).getByRole('button', { name: 'Use edited prompt as draft', exact: true }).click();
  await expect(field(page)).toHaveValue('//literal edited prompt'); expect(rpc.count('prompt.submit')).toBe(1); expect(rpc.count('slash.exec')).toBe(0);
});

test('copy uses this device clipboard on a deliberate gesture and does not run a host clipboard command', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (text: string) => { Reflect.set(window, '__browserClipboardTest', text); },
  } }));
  const rpc = await fixture(page); await login(page); await send(page, 'Clipboard setup'); await idle(page);
  rpc.history({ messages: [{ role: 'assistant', content: 'First native answer' }, { role: 'tool', content: 'PRIVATE TOOL' }, { role: 'assistant', content: 'Last native answer' }] });
  await openCommand(page, '/copy 1');
  await expect(modal(page).getByLabel('Assistant text to copy', { exact: true })).toHaveValue('First native answer');
  expect(await page.evaluate(() => Reflect.get(window, '__browserClipboardTest'))).toBeUndefined();
  await modal(page).getByRole('button', { name: 'Copy response to this device', exact: true }).click();
  await expect(modal(page).getByRole('status')).toContainText('Response copied.');
  expect(await page.evaluate(() => Reflect.get(window, '__browserClipboardTest'))).toBe('First native answer');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('native answer');
  await modal(page).getByRole('button', { name: 'Done', exact: true }).click(); await expect(field(page)).toHaveValue('');
  expect(rpc.count('slash.exec')).toBe(0); expect(rpc.count('command.dispatch')).toBe(0);
});

test('redraw reads native state without sending another prompt or losing an unrelated catalogue draft', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Redraw setup'); await idle(page);
  await field(page).fill('Unsent draft to keep'); await page.getByRole('button', { name: 'Browse Hermes commands', exact: true }).click();
  await page.getByRole('button', { name: 'Use /redraw', exact: true }).click(); await expect(modal(page)).toBeVisible();
  const before = rpc.count('session.history'); await modal(page).getByRole('button', { name: 'Refresh conversation view', exact: true }).click();
  await expect(modal(page)).toHaveCount(0); await expect(field(page)).toHaveValue('Unsent draft to keep');
  expect(rpc.count('session.history')).toBeGreaterThan(before); expect(rpc.count('prompt.submit')).toBe(1); expect(rpc.count('slash.exec')).toBe(0);
});


test('revoked session-search admission closes private command views instead of retaining stale search results', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Private session search setup'); await idle(page);
  await page.route('**/__hermes/api/sessions/search?**', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await openCommand(page, '/sessions');
  await modal(page).getByLabel('Search saved conversations', { exact: true }).fill('revoked-admission');
  await expect(modal(page)).toHaveCount(0);
  expect(rpc.count('command.dispatch')).toBe(0); expect(rpc.count('slash.exec')).toBe(0); expect(rpc.count('prompt.submit')).toBe(1);
});
