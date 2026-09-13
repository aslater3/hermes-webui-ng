import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle, newChat, conversations, closeConversations, settings, richFixture } from './shell-fixture.js';
// These cases exercise the actual new landing page. Existing diagnostic tests use :8788.
test.use({ baseURL: 'http://127.0.0.1:8787' });

test('modern shell signs in, completes repeated turns and reloads authoritative history', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page); await expect(page.getByRole('heading', { name: 'What are we working on?' })).toBeVisible();
  await send(page, 'Shell first conversation'); await expect(page.locator('[data-role="assistant"]')).toContainText('SYNTHETIC_RESPONSE'); await idle(page);
  const hash = new URL(page.url()).hash; expect(hash).toContain('session=');
  await send(page, 'A second turn without a reload'); await expect(page.locator('[data-role="assistant"]')).toHaveCount(2); await idle(page);
  await page.reload(); await expect(page.locator('[data-role="assistant"]')).toHaveCount(2); await idle(page);
  expect(new URL(page.url()).hash).toBe(hash);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test('modern rich messages show GFM, safe highlighted code and working copy and wrap controls', async ({ page }, info) => {
  const outside: string[] = []; page.on('request', req => { if (new URL(req.url()).hostname === 'tracker.invalid') outside.push(req.url()); });
  await richFixture(page); await page.emulateMedia({ colorScheme: 'dark' }); await login(page);
  await page.screenshot({ path: info.outputPath('shell-dark-empty.png') });
  await send(page, 'Help me plan a safer network migration.'); await expect(page.locator('.message-content table')).toBeVisible(); await idle(page);
  await expect(page.locator('code.language-python .hljs-keyword').first()).toBeVisible();
  await expect(page.locator('.message-content img,.message-content script')).toHaveCount(0);
  await expect(page.locator('.message-content a[href^="javascript:"]')).toHaveCount(0);
  expect(outside).toEqual([]);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { document.documentElement.dataset.copiedFixture = text; } } }));
  await page.getByRole('button', { name: 'Copy code', exact: true }).click();
  expect(await page.locator('html').getAttribute('data-copied-fixture')).toContain('capture_baseline');
  await page.getByRole('button', { name: 'Wrap code', exact: true }).click(); await expect(page.locator('.code-block')).toHaveClass(/wrap/);
  await page.locator('#conversation-scroll').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('shell-dark-conversation.png') });
  await settings(page); await page.getByRole('tab', { name: 'Appearance' }).click(); await page.getByRole('button', { name: 'Light', exact: true }).click(); await page.getByRole('button', { name: 'Close settings' }).click();
  await page.screenshot({ path: info.outputPath('shell-light-conversation.png') });
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['hermes-ng-theme']);
});

test('modern navigation keeps independent drafts and clears private views on sign-out', async ({ page }, info) => {
  await login(page); await send(page, `Shell A ${info.project.name}`); await idle(page); const a = new URL(page.url()).hash;
  await page.locator('#shell-prompt').fill('Private draft A'); await newChat(page); await send(page, `Shell B ${info.project.name}`); await idle(page); const b = new URL(page.url()).hash;
  await page.locator('#shell-prompt').fill('Private draft B'); await page.goBack(); await idle(page); await expect(page.locator('#shell-prompt')).toHaveValue('Private draft A'); expect(new URL(page.url()).hash).toBe(a);
  await page.goForward(); await idle(page); await expect(page.locator('#shell-prompt')).toHaveValue('Private draft B'); expect(new URL(page.url()).hash).toBe(b);
  await conversations(page); await page.getByRole('searchbox', { name: 'Search conversations' }).fill(`Shell A ${info.project.name}`);
  await page.getByRole('button', { name: `Open conversation: Shell A ${info.project.name}`, exact: true }).click(); await idle(page); await expect(page.locator('#shell-prompt')).toHaveValue('Private draft A');
  await settings(page); await page.getByRole('button', { name: 'Sign out of Hermes' }).click(); await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
  await expect(page.locator('[data-role],.agent-card')).toHaveCount(0); expect(new URL(page.url()).hash).toBe('');
});

test('modern composer stays onscreen at reduced height without overlapping messages', async ({ page }, info) => {
  await login(page); await send(page, 'Composer geometry'); await idle(page);
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 420 }); await page.locator('#shell-prompt').fill('Focused draft\nAnother line');
  const bounds = await page.evaluate(() => {
    const transcript = document.getElementById('conversation-scroll')!.getBoundingClientRect(), composer = document.getElementById('shell-composer')!.getBoundingClientRect();
    return { transcriptBottom: transcript.bottom, composerTop: composer.top, composerBottom: composer.bottom, height: innerHeight, width: innerWidth, scrollWidth: document.documentElement.scrollWidth };
  });
  expect(bounds.transcriptBottom).toBeLessThanOrEqual(bounds.composerTop); expect(bounds.composerBottom).toBeLessThanOrEqual(bounds.height);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
  await page.screenshot({ path: info.outputPath('shell-reduced-height.png') });
});

test('modern streaming preserves scroll-up position and stop allows a subsequent turn', async ({ page }) => {
  await login(page); await send(page, '[stream-test] shell');
  // A scroll-up is meaningful only once the content exceeds this viewport.
  await expect.poll(() => page.locator('#conversation-scroll').evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(140);
  await page.locator('#conversation-scroll').evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('.streaming')).toContainText('Streaming line 20');
  expect(await page.locator('#conversation-scroll').evaluate(node => node.scrollTop)).toBeLessThan(30);
  await page.getByRole('button', { name: 'Jump to latest', exact: true }).click();
  await idle(page); await send(page, '[slow-test] stop this turn'); await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop response', exact: true }).click(); await idle(page);
  await send(page, 'Continue after stopping'); await idle(page); await expect(page.locator('[data-role="assistant"]').last()).toContainText('SYNTHETIC_RESPONSE');
});

test('modern all-four interaction flow retains partial answers and never persists secrets', async ({ page }) => {
  await login(page); await send(page, '[agent-test]');
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  const clarify = page.getByRole('article', { name: 'Question from Hermes' });
  await clarify.getByLabel('Blue', { exact: true }).check(); await clarify.getByLabel('Green', { exact: true }).check();
  await clarify.getByLabel('Your answer', { exact: true }).fill('Keep this answer'); await clarify.getByRole('button', { name: 'Confirm answer' }).first().click();
  await expect(clarify.getByLabel('Your answer', { exact: true })).toHaveValue('Keep this answer'); await clarify.getByRole('button', { name: 'Confirm answer' }).last().click();
  await page.getByLabel('Sudo password', { exact: true }).fill('SHELL_TEST_PASSWORD'); await page.getByRole('button', { name: 'Send password' }).click(); await expect(page.getByLabel('Sudo password', { exact: true })).toHaveValue('');
  await page.getByLabel('Secret value', { exact: true }).fill('SHELL_TEST_SECRET'); await page.getByRole('button', { name: 'Save in Hermes' }).click(); await idle(page);
  await expect(page.locator('[data-role="assistant"]').last()).toContainText('SYNTHETIC_AGENT_COMPLETE');
  await expect(page.locator('#conversation-scroll')).not.toContainText('SHELL_TEST_');
  await settings(page); await page.getByRole('tab', { name: 'Diagnostics' }).click(); const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).click();
  const stream = await (await downloadEvent).createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const report = Buffer.concat(chunks).toString(); expect(report).not.toContain('SHELL_TEST_'); expect(report).not.toContain('fixture-password'); expect(report).not.toContain('SYNTHETIC_AGENT_COMPLETE');
});

test('modern disconnect clears pending credentials and retains explicit reconnect semantics', async ({ page }) => {
  await login(page); await send(page, '[agent-test] secret'); await page.getByLabel('Secret value', { exact: true }).fill('DO_NOT_RETAIN_SHELL');
  await settings(page); await page.getByRole('button', { name: 'Disconnect', exact: true }).click(); await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByLabel('Secret value', { exact: true })).toHaveValue(''); await expect(page.getByRole('button', { name: 'Save in Hermes' })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow'))); await expect(page.locator('.connection-pill')).toContainText('Disconnected');
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click(); await expect(page.locator('.connection-pill')).toContainText('Connected');
  await expect(page.locator('.agent-warning')).toContainText('cannot recover'); await expect(page.getByRole('button', { name: 'Save in Hermes' })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop response' }).click(); await idle(page);
});

test('modern saved history is readable while disconnected and historical mode cannot send', async ({ page }) => {
  await login(page); await settings(page); await page.getByRole('button', { name: 'Disconnect', exact: true }).click(); await page.getByRole('button', { name: 'Close settings' }).click();
  await conversations(page); await page.getByRole('searchbox', { name: 'Search conversations' }).fill('Seed 0'); await page.getByRole('button', { name: 'Open conversation: Seed 0 entry 0', exact: true }).click();
  await expect(page.locator('#conversation-scroll')).toContainText('Seed 0 entry 109'); await expect(page.locator('#shell-prompt')).toBeDisabled();
  await page.getByRole('button', { name: 'Load earlier messages' }).click(); await expect(page.locator('#conversation-scroll')).toContainText('Seed 0 entry 0'); await expect(page.locator('#shell-prompt')).toBeDisabled();
  await page.getByRole('button', { name: 'Return to latest' }).click(); await expect(page.locator('#conversation-scroll')).toContainText('Seed 0 entry 109');
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click(); await idle(page);
});

test('modern drawer, collapse and command palette remain keyboard and touch accessible', async ({ page }) => {
  await login(page);
  const mobile = await page.getByRole('button', { name: 'Open conversations' }).isVisible();
  if (mobile) { const open = page.getByRole('button', { name: 'Open conversations' }); await open.click(); await expect(page.getByRole('dialog', { name: 'Conversations', exact: true })).toBeVisible(); await closeConversations(page); await expect(open).toBeFocused(); }
  else { await page.getByRole('button', { name: 'Collapse sidebar' }).click(); await expect(page.locator('.workspace')).toHaveClass(/rail-collapsed/); await page.getByRole('button', { name: 'Expand sidebar' }).click(); }
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click(); await page.getByRole('button', { name: 'Quick actions', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Find an action' })).toBeFocused(); await page.getByRole('textbox', { name: 'Find an action' }).fill('dark'); await page.keyboard.press('Enter'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Control+k'); await expect(page.getByRole('dialog', { name: 'Quick actions' })).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('modern authentication expiry erases selected content before another admission', async ({ page }) => {
  await login(page); await send(page, 'Private shell conversation'); await idle(page); await page.locator('#shell-prompt').fill('Private unsent draft');
  await page.route('**/__hermes/api/auth/me', route => route.fulfill({ status: 401, json: {} }));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await expect(page.getByLabel('Username', { exact: true })).toBeVisible(); await expect(page.locator('[data-role],#shell-prompt')).toHaveCount(0); expect(new URL(page.url()).hash).toBe('');
});

test('modern theme and primary surfaces pass automated accessibility checks', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await login(page);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
  await settings(page); expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('modern composer respects desktop, touch and composition key input', async ({ page }, info) => {
  await login(page); const input = page.locator('#shell-prompt'); await input.fill('Keyboard draft');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true }); await expect(page.locator('[data-role="user"]')).toHaveCount(0);
  await input.press('Shift+Enter'); await expect(input).toHaveValue('Keyboard draft\n');
  if (info.project.use.isMobile) { await input.press('Enter'); await expect(page.locator('[data-role="user"]')).toHaveCount(0); await page.getByRole('button', { name: 'Send message' }).click(); }
  else await input.press('Enter');
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(1); await idle(page);
});
