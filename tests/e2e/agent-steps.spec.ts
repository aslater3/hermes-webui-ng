import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle, conversations } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
// SYNTHETIC fixture rows shaped like Hermes REST history (see tests/fixtures/dashboard.ts agentLoopRows). Not vanilla-Hermes evidence.
const TITLE = 'Refactor the radar math helpers and verify them.';

async function openAgentLoop(page: Page) {
  await login(page);
  await conversations(page);
  await page.getByRole('searchbox', { name: 'Search conversations' }).fill('Refactor the radar');
  await page.getByRole('button', { name: `Open conversation: ${TITLE}`, exact: true }).click();
  await expect(page.locator('[data-role="steps"]')).toHaveCount(2);
}

test('a long agent loop renders as grouped steps with readable summaries, failures marked, and expandable rows', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openAgentLoop(page);
  const first = page.locator('[data-role="steps"]').nth(0), second = page.locator('[data-role="steps"]').nth(1);
  // One Hermes header and one count per block, with the reply text between the blocks in order.
  await expect(first.locator('.agent-steps-block')).toHaveAttribute('aria-label', 'Agent steps (6)');
  await expect(second.locator('.agent-steps-block')).toHaveAttribute('aria-label', 'Agent steps (18)');
  await expect(page.locator('#conversation-scroll')).toContainText('The rounding case fails because round() uses banker rounding');
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: 'The rounding case fails' })).toHaveCount(1);
  // Collapsed rows already say what ran and how it ended.
  await expect(first).toContainText('make test');
  await expect(first).toContainText('tools/radar_math.py:1–40');
  await expect(first.locator('.step-outcome[data-outcome="failed"]')).toContainText('exit 1 · failed');
  await expect(first.locator('.agent-steps-failed')).toContainText('1 failed');
  await expect(first.locator('.step-reasoning').first()).toContainText('Reading the helper module before changing anything.');
  // Long run: the last six rows by default, with an explicit control for the rest (>= 44px).
  await expect(second.locator('.agent-step-list > li')).toHaveCount(6);
  const more = second.getByRole('button', { name: 'Show 12 earlier steps', exact: true });
  expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(second).not.toContainText('make verify');
  await more.click();
  await expect(second.locator('.agent-step-list > li')).toHaveCount(18);
  await expect(second).toContainText('OPENAI_API_KEY=[redacted] make verify');
  await expect(second.getByRole('button', { name: 'Show only the last 6 steps', exact: true })).toBeVisible();
  // Redaction: the credential-looking value never appears on the page.
  await expect(page.locator('#conversation-scroll')).not.toContainText('sk-fixture0123456789abcdef');
  // Expanding a row shows the full arguments and output, by keyboard as well as pointer.
  const diff = second.locator('.step-tool', { hasText: 'git diff --stat' });
  await diff.locator('summary').focus(); await page.keyboard.press('Enter');
  await expect(diff).toHaveAttribute('open', '');
  await expect(diff.locator('pre').nth(1)).toContainText('tools/radar_math.py | 9 +-');
  await expect(diff).toHaveAttribute('data-outcome', 'ok'); await expect(diff.locator('.step-outcome')).toHaveText('exit 0');
  // Layout, accessibility and no sideways scrolling at the narrowest width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('#conversation-scroll').analyze()).violations).toEqual([]);
  await page.screenshot({ path: `test-results/agent-steps-${info.project.name}.png`, fullPage: false });
  expect(errors).toEqual([]);
});

test('a running turn shows what it is doing now, ticks elapsed time, and clears when idle', async ({ page }, info) => {
  await login(page);
  await send(page, '[now-test] check the radar');
  const now = page.locator('.now-line');
  await expect(now).toHaveAttribute('role', 'status');
  await expect(now.locator('.now-label')).toHaveText('Running terminal: make radar-check');
  await expect(now.locator('.now-time')).toHaveText(/^\d+:\d\d$/);
  await expect(now).toHaveAttribute('data-kind', 'tool');
  // The tool finishes and the reply starts: the Now line follows the change.
  await expect(now).toHaveAttribute('data-kind', 'writing', { timeout: 10_000 });
  await expect(now.locator('.now-label')).toHaveText('Writing reply…');
  expect((await new AxeBuilder({ page }).include('.now-line').analyze()).violations).toEqual([]);
  await page.screenshot({ path: `test-results/agent-now-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Stop response' }).click();
  await idle(page);
  await expect(page.locator('.now-line')).toHaveCount(0);
});
