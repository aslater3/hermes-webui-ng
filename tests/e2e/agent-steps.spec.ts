import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, conversations } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
// SYNTHETIC fixture rows shaped like Hermes REST history (see tests/fixtures/dashboard.ts agentLoopRows). Not vanilla-Hermes evidence.
const TITLE = 'Refactor the radar math helpers and verify them.';

async function openAgentLoop(page: Page) {
  await login(page);
  await conversations(page);
  await page.getByRole('searchbox', { name: 'Search conversations' }).fill('Refactor the radar');
  await page.getByRole('button', { name: `Open conversation: ${TITLE}`, exact: true }).click();
  await expect(page.locator('[data-role="turn"]')).toHaveCount(1);
}

test('a long saved agent turn renders as one CLI-style timeline with failures marked and expandable rows', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openAgentLoop(page);
  const turn = page.locator('[data-role="turn"]');
  // One Hermes header for the whole long turn; the final reply is always visible at the bottom.
  await expect(turn.locator('.message-label')).toHaveCount(1);
  await expect(turn.locator('[data-row="reply"]')).toContainText('The rounding fix is in');
  // Long turn: the last eight rows by default, with an explicit control for the rest (>= 44px).
  await expect(turn.locator('.turn-rows > li')).toHaveCount(8);
  await expect(turn).not.toContainText('make verify');
  const more = turn.getByRole('button', { name: 'Show 18 earlier items', exact: true });
  expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await more.click();
  await expect(turn.locator('.turn-rows > li')).toHaveCount(26);
  // Collapsed rows say what ran and how it ended; the failing command is marked by text, not colour alone.
  await expect(turn.locator('[data-row="narration"]')).toContainText('The rounding case fails because round() uses banker rounding');
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: 'The rounding case fails' })).toHaveCount(1);
  const make = turn.locator('[data-row="tools"]', { hasText: 'make test' });
  await expect(make).toHaveAttribute('data-status', 'failed');
  await expect(make.locator('.turn-status')).toContainText('exit 1 · failed');
  await expect(turn.locator('[data-row="thought"]').first().locator('.turn-preview')).toContainText('Reading the helper module before changing anything.');
  await expect(turn.locator('[data-row="tools"]', { hasText: 'tools/radar_math.py:1–40' })).toHaveCount(1);
  await expect(turn).toContainText('OPENAI_API_KEY=[redacted] make verify');
  await expect(turn.getByRole('button', { name: 'Show only the last 8 items', exact: true })).toBeVisible();
  // Redaction: the credential-looking value never appears on the page.
  await expect(page.locator('#conversation-scroll')).not.toContainText('sk-fixture0123456789abcdef');
  // Expanding a row shows the full command and output, by keyboard as well as pointer.
  const diff = turn.locator('[data-row="tools"]', { hasText: 'git diff --stat' });
  await diff.locator('.turn-row-toggle').focus(); await page.keyboard.press('Enter');
  await expect(diff.locator('.turn-row-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(diff.locator('.turn-call .turn-command')).toContainText('git diff --stat');
  await expect(diff.locator('.turn-output')).toContainText('tools/radar_math.py | 9 +-');
  await expect(diff).toHaveAttribute('data-status', 'ok');
  await expect(diff.locator('.turn-status')).toContainText('exit 0');
  // Layout, accessibility and no sideways scrolling at the narrowest width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('#conversation-scroll').analyze()).violations).toEqual([]);
  await page.screenshot({ path: `test-results/agent-steps-${info.project.name}.png`, fullPage: false });
  expect(errors).toEqual([]);
});
