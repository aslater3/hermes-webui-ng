import { test, expect } from '@playwright/test';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });

test('streamed reply text and tool calls render in the order they happened, as one Hermes turn', async ({ page }) => {
  await login(page);
  await send(page, '[interleave-test] build');
  const turn = page.locator('[data-role="turn"]');
  await expect(turn).toHaveCount(1);
  // While streaming the text between tools is a timeline row, not a second copy in the streamed box.
  await expect(turn.locator('[data-row="narration"]')).toContainText('Checking the build first.');
  await expect(page.locator('.message.streaming')).toHaveCount(0);
  await idle(page);
  // After the turn the saved history and the live rows merge: one of each step, in order, one header.
  const rows = await turn.locator('.turn-rows > li').evaluateAll(nodes => nodes.map(node => node.dataset.row));
  expect(rows).toEqual(['narration', 'tools', 'reply']);
  await expect(turn.locator('[data-row="narration"]')).toHaveCount(1);
  await expect(turn.locator('[data-row="reply"]')).toContainText('The build passes.');
  await expect(turn.locator('.message-label')).toHaveCount(1);
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: 'Checking the build first.' })).toHaveCount(1);
  await expect(page.locator('.message.streaming')).toHaveCount(0);
});
