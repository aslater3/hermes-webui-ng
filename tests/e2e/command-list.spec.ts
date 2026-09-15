import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { commandFixture } from '../fixtures/commands.js';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
const prompt = (page: Page) => page.locator('#shell-prompt');
const catalogueCount = commandFixture().pairs.length + 100;
const suggestions = (page: Page) => page.getByRole('listbox', { name: 'Slash command suggestions' });

/** Synthetic larger inventory; browsing must not turn additional metadata into execution permission. */
async function largeCatalogue(page: Page) {
  const data = commandFixture();
  data.pairs.push(...Array.from({ length: 100 }, (_, i) => [`/extra-${String(i).padStart(3, '0')}`, `Additional fixture command ${i}`]));
  data.canon['/latealias'] = '/extra-099';
  const calls: string[] = [];
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer();
    socket.onMessage(raw => {
      const frame = JSON.parse(String(raw)); calls.push(frame.method);
      if (frame.method === 'commands.catalog') socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: data }));
      else server.send(raw);
    });
    server.onMessage(raw => socket.send(raw));
  });
  return calls;
}

test('the full command list scrolls past eight and every name stays left aligned', async ({ page }, info) => {
  const calls = await largeCatalogue(page); await login(page); await send(page, 'Scrollable command list'); await idle(page);
  await prompt(page).fill('/');
  const list = suggestions(page), options = list.getByRole('option');
  await expect(options).toHaveCount(catalogueCount);
  const geometry = await options.evaluateAll(nodes => nodes.map(node => {
    const row = node.getBoundingClientRect(), name = node.querySelector('strong')!.getBoundingClientRect();
    return { inset: name.left - row.left, height: row.height, alignment: getComputedStyle(node).textAlign };
  }));
  expect(geometry.every(row => row.inset >= 7 && row.inset <= 9 && row.height >= 44 && row.alignment === 'left')).toBe(true);
  expect(await list.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(options.last()).toBeInViewport();
  await expect(options.last()).toBeEnabled();
  await expect(options.last()).toHaveAttribute('aria-disabled', 'false');
  expect(await list.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('commands-full-scroll.png') });
  expect(calls.filter(method => ['slash.exec', 'command.dispatch'].includes(method))).toEqual([]);
});

test('typing filters the entire inventory immediately and resets the scrolled list', async ({ page }) => {
  await largeCatalogue(page); await login(page); await send(page, 'Command filter setup'); await idle(page);
  await prompt(page).fill('/'); const list = suggestions(page);
  await expect(list.getByRole('option')).toHaveCount(catalogueCount);
  await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await prompt(page).fill('/extra-09'); await expect(list.getByRole('option')).toHaveCount(10);
  await expect.poll(() => list.evaluate(node => node.scrollTop)).toBe(0);
  await prompt(page).press('9'); await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option')).toContainText('/extra-099');
  await prompt(page).fill('/LATEALIAS'); await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option')).toContainText('/extra-099');
  await expect(list.getByRole('option')).toBeEnabled();
  await prompt(page).fill('/no-such-command'); await expect(list).toHaveCount(0);
  await expect(page.locator('.command-suggestions')).toContainText('No matching command');
  await prompt(page).fill('/'); await expect(list.getByRole('option')).toHaveCount(catalogueCount);
  await expect.poll(() => list.evaluate(node => node.scrollTop)).toBe(0);
  await prompt(page).fill('/sta'); await prompt(page).press('Tab');
  await expect(prompt(page)).toHaveValue('/status ');
});

test('catalogue scrolls all matches, explains native review requirements and filters without losing the draft', async ({ page }, info) => {
  await largeCatalogue(page); await login(page); await prompt(page).fill('Keep my unsent draft');
  await page.getByRole('button', { name: 'Browse Hermes commands', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Hermes commands', exact: true });
  const list = dialog.getByRole('region', { name: 'Matching Hermes commands', exact: true });
  await expect(list.locator('.command-catalogue-row')).toHaveCount(catalogueCount);
  await expect(dialog).toContainText('Native commands require review');
  await expect(dialog).toContainText(`${catalogueCount} matching · ${catalogueCount} selectable`);
  expect(await list.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await list.locator('.command-catalogue-row').last().scrollIntoViewIfNeeded();
  await expect(list.locator('.command-catalogue-row').last()).toBeInViewport();
  await dialog.getByLabel('Search Hermes commands', { exact: true }).fill('EXTRA-099');
  await expect(list.locator('.command-catalogue-row')).toHaveCount(1);
  await expect(list.getByRole('button', { name: 'Use /extra-099', exact: true })).toBeEnabled();
  await expect(list).toContainText('review native effects before confirming');
  await dialog.getByLabel('Search Hermes commands', { exact: true }).fill('SESSION token');
  await expect(list.locator('.command-catalogue-row')).toHaveCount(1);
  await expect(list.getByRole('button', { name: 'Use /usage', exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page }).include('.modal-commands').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('command-catalogue-filtered.png') });
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 360 });
  await expect(dialog.getByRole('button', { name: 'Close hermes commands', exact: true })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Close hermes commands', exact: true }).click();
  await expect(prompt(page)).toHaveValue('Keep my unsent draft');
});
