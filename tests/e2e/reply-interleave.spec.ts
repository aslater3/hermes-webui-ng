import { test, expect } from '@playwright/test';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });

test('streamed reply text and tool cards render in the order they happened', async ({ page }) => {
  await login(page);
  await send(page, '[interleave-test] build');
  const timeline = page.locator('.agent-timeline');
  await expect(timeline.locator('.agent-reply-text')).toHaveCount(2);
  expect(await timeline.locator(':scope > .agent-reply-text, :scope > .agent-tool').evaluateAll(nodes =>
    nodes.map(node => node.classList.contains('agent-tool') ? 'tool' : `text:${node.textContent}`)))
    .toEqual(['text:Checking the build first. ', 'tool', 'text:The build passes.']);
  // No duplicate copy of the same text in the single streamed box while interleaved.
  await expect(page.locator('.message.streaming')).toHaveCount(0);
  await idle(page);
  await expect(page.locator('.message-assistant').last()).toContainText('Checking the build first. The build passes.');
});
