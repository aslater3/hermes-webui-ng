import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
const sample = { input: 300, output: 50, reasoning: 10, total: 350, calls: 2,
  context_used: 6400, context_max: 128000, context_percent: 5, context_estimated: true, compressions: 0 };

/** Synthetic native shape injection, not evidence of running vanilla Hermes. */
async function usageFixture(page: Page) {
  let usage: unknown = sample, runtime = '', emit: (raw: string) => void = () => {};
  const calls: string[] = [];
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer(), requests = new Map<unknown, string>();
    emit = raw => socket.send(raw);
    socket.onMessage(raw => {
      const frame = JSON.parse(String(raw)); requests.set(frame.id, frame.method); calls.push(frame.method); server.send(raw);
    });
    server.onMessage(raw => {
      const frame = JSON.parse(String(raw));
      if (['session.create', 'session.resume', 'session.activate'].includes(requests.get(frame.id) ?? '') && frame.result?.info) {
        frame.result.info.usage = frame.result.info.profile_name === 'work' ? { total: 7, calls: 1 } : usage;
        if (frame.result.session_id) runtime = frame.result.session_id;
      }
      if (frame.id !== undefined) requests.delete(frame.id);
      socket.send(JSON.stringify(frame));
    });
  });
  return { calls, runtime: () => runtime,
    update: (value: unknown, session_id = runtime) => {
      usage = value;
      emit(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'session.usage', session_id, payload: { usage: value } } }));
    } };
}
const inspector = (page: Page) => page.getByRole('button', { name: 'View session usage and context', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Usage & context', exact: true });
const counter = (page: Page, label: string) => dialog(page).locator('.usage-counters > div').filter({ has: page.getByText(label, { exact: true }) });

test('usage/context inspector is accessible on desktop and mobile, preserves draft and works at keyboard height', async ({ page }, info) => {
  await usageFixture(page); await login(page); await send(page, 'Controlled usage example'); await idle(page);
  await page.locator('#shell-prompt').fill('Keep this unsent draft');
  await expect(inspector(page)).toContainText('Context 5%');
  const target = await inspector(page).boundingBox(); expect(target!.height).toBeGreaterThanOrEqual(44);
  await inspector(page).click(); await expect(dialog(page)).toContainText('Estimated by Hermes');
  await expect(counter(page, 'Total tokens')).toContainText('350');
  await expect(dialog(page).getByRole('progressbar', { name: 'Context window used' })).toHaveAttribute('value', '5');
  expect((await new AxeBuilder({ page }).include('.modal-usage').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('session-usage.png') });
  const width = page.viewportSize()!.width; await page.setViewportSize({ width, height: 360 });
  await expect(page.getByRole('button', { name: 'Close usage & context', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Close usage & context', exact: true }).click();
  await expect(page.locator('#shell-prompt')).toHaveValue('Keep this unsent draft');
  await expect(inspector(page)).toBeFocused();
});

test('live usage updates do not refetch transcripts or change the saved draft; missing values are explicit', async ({ page }) => {
  const fixture = await usageFixture(page); await login(page); await send(page, 'Live usage example'); await idle(page);
  await inspector(page).click();
  const histories = fixture.calls.filter(method => method === 'session.history').length;
  fixture.update({ ...sample, total: 400, context_percent: 110 });
  await expect(counter(page, 'Total tokens')).toContainText('400');
  await expect(dialog(page)).toContainText('110%');
  await expect(dialog(page).getByRole('progressbar')).toHaveAttribute('value', '100');
  expect(fixture.calls.filter(method => method === 'session.history').length).toBe(histories);
  fixture.update({ total: 0, calls: 0, context_max: 0 });
  await expect(counter(page, 'Total tokens').locator('dd')).toHaveText('0');
  await expect(counter(page, 'Input tokens')).toContainText('Not reported');
  await expect(dialog(page).getByRole('progressbar')).toHaveCount(0);
  fixture.update({ total: 'private-invalid-metadata', credits_lines: ['DO_NOT_RENDER'] });
  await expect(dialog(page)).toContainText('Usage is not reported');
  await expect(dialog(page)).not.toContainText('DO_NOT_RENDER');
  expect(fixture.calls.filter(method => method === 'prompt.submit')).toHaveLength(1);
});

test('profile selection cannot inherit another session usage and reload recovers native counters', async ({ page }) => {
  const fixture = await usageFixture(page); await login(page); await send(page, 'Default usage owner'); await idle(page);
  const oldUrl = page.url(), oldRuntime = fixture.runtime();
  await page.getByRole('button', { name: 'Profile: default', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation with Work', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Profile: work', exact: true })).toBeVisible();
  await inspector(page).click(); await expect(counter(page, 'Total tokens').locator('dd')).toHaveText('7');
  fixture.update({ total: 999999 }, oldRuntime);
  await expect(counter(page, 'Total tokens').locator('dd')).toHaveText('7');
  await page.getByRole('button', { name: 'Close usage & context', exact: true }).click();
  await send(page, 'Work usage owner'); await idle(page); await page.reload();
  await expect(inspector(page)).toBeVisible(); await inspector(page).click();
  await expect(counter(page, 'Total tokens').locator('dd')).toHaveText('7');
  await page.getByRole('button', { name: 'Close usage & context', exact: true }).click();
  await page.goto(oldUrl); await expect(inspector(page)).toBeVisible(); await inspector(page).click();
  await expect(counter(page, 'Total tokens').locator('dd')).toHaveText('999,999');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('999999');
});

test('usage-only events do not move a reader or create a false new-message indicator', async ({ page }) => {
  const fixture = await usageFixture(page); await login(page);
  await send(page, 'Usage scroll example'); await idle(page);
  await page.setViewportSize({ width: 390, height: 360 });
  // A real message makes the transcript overflow at keyboard height.
  await send(page, Array.from({ length: 60 }, (_, i) => `Synthetic line ${i}`).join('\n')); await idle(page);
  await page.locator('#conversation-scroll').evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('#conversation-scroll')).toHaveAttribute('data-following', 'false');
  const top = await page.locator('#conversation-scroll').evaluate(node => node.scrollTop);
  fixture.update({ ...sample, total: 401, context_percent: 6 }); await expect(inspector(page)).toContainText('Context 6%');
  await expect(page.getByRole('button', { name: 'Jump to latest', exact: true })).toHaveCount(0);
  expect(await page.locator('#conversation-scroll').evaluate(node => node.scrollTop)).toBe(top);
});
