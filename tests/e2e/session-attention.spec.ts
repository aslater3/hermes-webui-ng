import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle, newChat, conversations } from './shell-fixture.js';
import { pwaNetwork, loginPwa } from './pwa-network.js';
test.use({ baseURL: 'http://127.0.0.1:8787' });

test('an unselected pending credential stays discoverable without keeping the entered value', async ({ page }, info) => {
  const prompt = `[agent-test] secret attention ${info.project.name}`;
  await login(page); await send(page, prompt);
  const field = page.getByLabel('Secret value', { exact: true }); await expect(field).toBeVisible();
  await field.fill('DO_NOT_RETAIN_DURING_SELECTION');
  await newChat(page); await send(page, 'Independent second conversation'); await idle(page);
  await expect(page.locator('.agent-secret')).toHaveCount(0);
  await conversations(page);
  const active = page.getByRole('region', { name: 'Active agent sessions' });
  await expect(active).toContainText('Needs your input');
  const activeButton = page.getByRole('button', { name: `Open active session: ${prompt}`, exact: true });
  await expect(activeButton).toHaveAttribute('data-attention', 'required');
  const activeIcon = activeButton.locator('svg');
  // A waiting row uses the alert indicator; only working/starting children spin (covered by the nested test).
  await expect(activeIcon).not.toHaveCSS('animation-name', 'hermes-active-session-spin');
  expect(await activeButton.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
  const savedButton = page.getByRole('button', { name: `Open conversation: ${prompt}`, exact: true });
  await expect(savedButton).toHaveCount(0);
  await activeButton.click();
  await expect(field).toBeVisible(); await expect(field).toHaveValue('');
  await field.fill('SYNTHETIC_RESPONSE_VALUE'); await page.getByRole('button', { name: 'Save in Hermes', exact: true }).click();
  await idle(page); await expect(page.locator('[data-role="assistant"]').last()).toContainText('SYNTHETIC_AGENT_COMPLETE');
  await send(page, 'A normal turn after returning to the request'); await idle(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('session-attention.png') });
});

test('native completion in another conversation produces a review badge without interrupting current chat', async ({ page }, info) => {
  const prompt = `Held background response ${info.project.name}`;
  let release!: () => void;
  const permit = new Promise<void>(resolve => { release = resolve; });
  const network = await pwaNetwork(false, {
    beforePromptComplete: text => text === prompt ? permit : Promise.resolve(),
  });
  // Compare the exact content, not its article wrapper which also contains "You".
  const userMessages = page.locator('[data-role="user"] .user-text');
  try {
    await loginPwa(page, network.origin); await send(page, prompt);
    await newChat(page); await send(page, 'Current foreground response'); await idle(page);
    await conversations(page);
    const button = page.getByRole('button', { name: `Open active session: ${prompt}`, exact: true });
    const savedButton = page.getByRole('button', { name: `Open conversation: ${prompt}`, exact: true });
    // Prove the prerequisite: this native session is still working AND unselected.
    // A fixed 3.1s fixture timer can finish before a slower mobile UI switches away.
    await expect(button).toContainText('Working');
    await expect(button).not.toContainText('New activity');
    await expect(button).not.toHaveAttribute('data-attention', 'new');
    await expect(userMessages).toHaveText(['Current foreground response']);
    release();
    await expect(button).toContainText('New activity');
    await expect(button).toHaveAttribute('data-attention', 'new');
    expect(await button.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
    await expect(savedButton).toHaveAttribute('data-attention', 'new');
    expect(await savedButton.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
    await expect(userMessages).toHaveText(['Current foreground response']);
    await button.click(); await idle(page);
    await expect(userMessages).toHaveText([prompt]);
    await expect(userMessages).not.toContainText('Current foreground response');
    expect(network.metrics.submits).toBe(2);
    expect(network.metrics.creates).toBe(2);
  } finally {
    release(); await page.goto('about:blank'); await network.close();
  }
});

test('a running parent shows its child agents nested beneath it and clears them when they finish', async ({ page }, info) => {
  const prompt = `[subagent-test] nested child ${info.project.name}`;
  let release!: () => void;
  const permit = new Promise<void>(resolve => { release = resolve; });
  const network = await pwaNetwork(false, {
    beforePromptComplete: text => text === prompt ? permit : Promise.resolve(),
  });
  try {
    await loginPwa(page, network.origin); await send(page, prompt);
    await conversations(page);
    const active = page.getByRole('region', { name: 'Active agent sessions' });
    await expect(active.getByRole('button', { name: `Open active session: ${prompt}`, exact: true })).toContainText('Working');
    // The child is nested inside the parent's own list item, never a second top-level conversation row.
    const parentItem = active.locator('li').filter({ has: page.getByRole('button', { name: `Open active session: ${prompt}`, exact: true }) });
    await expect(parentItem.getByRole('list', { name: 'Subagents', exact: true })).toHaveCount(1);
    const child = parentItem.locator('.active-subagent');
    await expect(child).toHaveCount(1);
    await expect(child).toContainText('sa-0-1054fd14');
    await expect(child).toContainText('Running');
    await expect(child).toContainText('deepseek-v4.1-flash');
    await expect(child).toContainText('last tool: read_file');
    expect(await child.locator('svg').first().evaluate(element => getComputedStyle(element).animationName))
      .toBe('hermes-active-session-spin');
    expect(await active.getByRole('button', { name: `Open conversation: ${prompt}`, exact: true }).count()).toBe(0);
    // Terminal status, retention and pruning are covered deterministically by the unit store tests. A parent
    // that finishes while selected leaves this panel by design, taking its child list with it, so the browser
    // spec covers the rendered live list only.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('session-subagents.png') });
  } finally {
    release(); await page.goto('about:blank'); await network.close();
  }
});

test('a background parent is attached metadata-only before its subagent roster is rendered', async ({ page }, info) => {
  const title = `Background parent ${info.project.name}`;
  const network = await pwaNetwork(false);
  network.seedActiveSubagent(title);
  try {
    await loginPwa(page, network.origin); await conversations(page);
    const active = page.getByRole('region', { name: 'Active agent sessions' });
    const parentButton = active.getByRole('button', { name: `Open active session: ${title}`, exact: true });
    await expect(parentButton).toContainText('Working');
    const parentItem = active.locator('li').filter({ has: page.getByRole('button', { name: `Open active session: ${title}`, exact: true }) });
    const child = parentItem.locator('.active-subagent');
    await expect(child).toHaveCount(1);
    await expect(child).toContainText('sa-background');
    await expect(child).toContainText('Background child');
    await expect(child).toContainText('deepseek-v4.1-flash');
    await expect(child).toContainText('last tool: terminal');
    // The metadata-only attach must not select the background conversation or paint its transcript.
    await expect(page.locator('[data-role="user"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await page.goto('about:blank'); await network.close();
  }
});
