import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle, conversations } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
// SYNTHETIC fixture turns (tests/fixtures/dashboard.ts): live scenarios and their saved history. Not vanilla-Hermes evidence.
const SAVED_TITLE = 'Refactor the radar math helpers and verify them.';
const rowsOf = (turn: ReturnType<Page['locator']>) => turn.locator('.turn-rows > li').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.row));

test('a saved long turn reads as one CLI-style timeline with dividers, full command details and marked failures', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page); await conversations(page);
  await page.getByRole('searchbox', { name: 'Search conversations' }).fill('Refactor the radar');
  await page.getByRole('button', { name: `Open conversation: ${SAVED_TITLE}`, exact: true }).click();
  const turn = page.locator('[data-role="turn"]');
  await expect(turn).toHaveCount(1);
  await expect(turn.locator('.message-label')).toHaveCount(1);
  // Collapsed: eight rows, the reply last, and thin dividers between thought and tool rows (not around the prose).
  await expect(turn.locator('.turn-rows > li')).toHaveCount(8);
  await expect(turn.locator('[data-row="reply"]')).toContainText('The rounding fix is in');
  const divider = await turn.locator('.turn-rows > li').nth(1).evaluate(node => getComputedStyle(node).borderTopWidth);
  expect(divider).toBe('1px');
  // Reveal the rest; a failing call is marked by its verdict text.
  await turn.getByRole('button', { name: 'Show 18 earlier items', exact: true }).click();
  await expect(turn.locator('.turn-rows > li')).toHaveCount(26);
  const make = turn.locator('[data-row="tools"]', { hasText: 'make test' });
  await expect(make).toHaveAttribute('data-status', 'failed');
  await expect(make.locator('.turn-status')).toContainText('exit 1 · failed');
  // Expanding a group shows each call's full command and its output, and a failing call is marked inside.
  await make.locator('.turn-row-toggle').click();
  await expect(make.locator('.turn-call')).toHaveAttribute('data-status', 'failed');
  await expect(make.locator('.turn-command')).toHaveText('make test');
  await expect(make.locator('.turn-output')).toContainText('FAILED tests/test_radar_math.py');
  await expect(make.locator('.turn-call-state')).toContainText('exit 1 · failed');
  // Every row is a disclosure button of at least 44 px.
  for (const toggle of await turn.locator('.turn-row-toggle').all()) expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('[data-role="turn"]').analyze()).violations).toEqual([]);
  await turn.screenshot({ path: `test-results/turn-timeline-saved-${info.project.name}.png` });
  await page.screenshot({ path: `test-results/turn-timeline-saved-page-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test('a live turn shows a running row that ticks and becomes final in place, with no duplicate rows after history refreshes', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page);
  await send(page, '[timeline-test] check the timeline');
  const turn = page.locator('[data-role="turn"]');
  await expect(turn).toHaveCount(1);
  // The first tool row is pinned: a status filter would re-resolve to the next call once this one completes.
  const running = page.locator('[data-row="tools"]').first();
  await expect(running).toHaveAttribute('data-status', 'running');
  await expect(running.locator('.turn-status-text')).toHaveText(/^\d+:\d\d$/);
  // Open the running row now: the call shows its full command and "running", and stays open.
  await running.locator('.turn-row-toggle').click();
  await expect(running.locator('.turn-command')).toHaveText('cd /work && make timeline');
  await expect(running.locator('.turn-call')).toHaveAttribute('data-status', 'running');
  await running.evaluate(node => { (node as HTMLElement).dataset.marker = 'kept'; });
  // The call completes: the same row turns into its final state, with the duration and output.
  await expect(running).toHaveAttribute('data-status', 'ok', { timeout: 10_000 });
  await expect(page.locator('[data-marker="kept"]')).toHaveCount(1);
  await expect(running.locator('.turn-row-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(running.locator('.turn-status')).toContainText('2.2s');
  await expect(running.locator('.turn-output')).toContainText('timeline ok');
  // While running, the Now line stays away because the running row is on screen.
  await expect(page.locator('.now-line')).toHaveCount(0);
  const failed = page.locator('[data-row="tools"][data-status="failed"]');
  await expect(failed.locator('.turn-status')).toContainText('exit 2 · failed');
  await idle(page);
  // Turn complete and history refreshed: the same five rows, once each, and the open row is still the same node.
  await expect(turn).toHaveCount(1);
  await expect(turn.locator('.message-label')).toHaveCount(1);
  expect(await rowsOf(turn)).toEqual(['thought', 'tools', 'narration', 'tools', 'reply']);
  await expect(page.locator('[data-marker="kept"]')).toHaveCount(1);
  await expect(turn.locator('[data-row="thought"] .turn-preview')).toContainText('Planning the timeline check.');
  await expect(turn.locator('[data-row="reply"]')).toContainText('One check failed.');
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: 'One check failed.' })).toHaveCount(1);
  await expect(page.locator('.now-line')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('[data-role="turn"]').analyze()).violations).toEqual([]);
  await turn.screenshot({ path: `test-results/turn-timeline-live-${info.project.name}.png` });
  // A reload reads the same turn from Hermes history: the same rows, nothing added.
  await page.reload(); await idle(page);
  await expect(turn).toHaveCount(1);
  expect(await rowsOf(turn)).toEqual(['thought', 'tools', 'narration', 'tools', 'reply']);
  expect(errors).toEqual([]);
});

test('a running turn shows what it is doing in the Now line only while its row is scrolled out of view', async ({ page }, info) => {
  await login(page);
  await send(page, '[now-test] check the radar');
  // The running tool row is on screen: the Now line stays away.
  const running = page.locator('[data-row="tools"][data-status="running"]');
  await expect(running).toBeVisible();
  await expect(page.locator('.now-line')).toHaveCount(0);
  // A spacer below the row pushes it above the viewport: the Now line appears and names the step.
  await page.evaluate(() => {
    const spacer = document.createElement('div'); spacer.dataset.testSpacer = 'true'; spacer.style.height = '3000px';
    document.querySelector('.conversation-content')?.append(spacer);
    const scroller = document.querySelector<HTMLElement>('#conversation-scroll'); if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  const now = page.locator('.now-line');
  await expect(now).toHaveAttribute('role', 'status');
  await expect(now.locator('.now-label')).toHaveText('Running terminal: make radar-check');
  await expect(now.locator('.now-time')).toHaveText(/^\d+:\d\d$/);
  await expect(now).toHaveAttribute('data-kind', 'tool');
  expect((await new AxeBuilder({ page }).include('.now-line').analyze()).violations).toEqual([]);
  await page.screenshot({ path: `test-results/turn-timeline-now-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Activating it brings the running row back, and the line goes away.
  await now.locator('.now-jump').click();
  await expect(page.locator('.now-line')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop response' }).click();
  await idle(page);
  await expect(page.locator('.now-line')).toHaveCount(0);
});
