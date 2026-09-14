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
  expect(await activeButton.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
  const savedButton = page.getByRole('button', { name: `Open conversation: ${prompt}`, exact: true });
  await expect(savedButton).toHaveAttribute('data-attention', 'required');
  expect(await savedButton.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
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
    await button.click(); await idle(page);
    await expect(userMessages).toHaveText([prompt]);
    await expect(userMessages).not.toContainText('Current foreground response');
    expect(network.metrics.submits).toBe(2);
    expect(network.metrics.creates).toBe(2);
  } finally {
    release(); await page.goto('about:blank'); await network.close();
  }
});
