import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
// Shapes from pinned Hermes session_history.py; transport is a labelled synthetic fixture.
test('native tool summaries, structured replies and public reasoning render cleanly after reload', async ({ page }, info) => {
  const methods = new Map<string | number, string>();
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer();
    socket.onMessage(raw => { const request = JSON.parse(String(raw)); methods.set(request.id, request.method); server.send(raw); });
    server.onMessage(raw => {
      const frame = JSON.parse(String(raw));
      if (methods.get(frame.id) === 'session.history' && frame.result?.messages?.length >= 2) frame.result.messages = [
        frame.result.messages[0],
        { role: 'assistant', text: '' },
        { role: 'tool', name: 'terminal', context: 'git status', args: { deliberately_unprojected: 'PRIVATE_TOOL_ARG' } },
        { role: 'assistant', content: [{ type: 'text', text: 'Structured response survives reload.' }] },
        { role: 'assistant', text: '', reasoning_content: 'Public reasoning saved by Hermes.',
          codex_message_items: [{ type: 'message', content: [{ type: 'output_text', text: 'Sidecar-only answer survives reload.' }] }] },
      ];
      socket.send(JSON.stringify(frame));
    });
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page); await send(page, 'Show structured history'); await idle(page);
  for (let pass = 0; pass < 2; pass++) {
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(2);
    await expect(page.locator('[data-role="assistant"]')).toContainText(['Structured response survives reload.', 'Sidecar-only answer survives reload.']);
    const tool = page.locator('[data-row="tools"]');
    await expect(tool).toContainText('git status'); await expect(tool).not.toContainText('Hermes');
    await tool.locator('.turn-row-toggle').click(); await expect(tool.locator('.turn-command')).toHaveText('git status');
    const reasoning = page.locator('[data-row="thought"]'); await reasoning.locator('.turn-row-toggle').click();
    await expect(reasoning.locator('.turn-thought-text')).toHaveText('Public reasoning saved by Hermes.');
    await expect(page.locator('#conversation-scroll')).not.toContainText('[Non-text entry]');
    await expect(page.locator('#conversation-scroll')).not.toContainText('PRIVATE_TOOL_ARG');
    const decorative = await page.locator('article.message svg').evaluateAll(nodes => nodes.every(node => node.getAttribute('aria-hidden') === 'true'));
    expect(decorative).toBe(true);
    // One Hermes header for the turn, whatever the number of rows under it.
    await expect(page.locator('[data-role="turn"] .message-label')).toHaveCount(1);
    await expect(page.locator('.turn-timeline .lucide-sparkles')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (!pass) { await page.reload(); await idle(page); }
  }
  expect((await new AxeBuilder({ page }).include('#conversation-scroll').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('structured-history.png') });
  expect(errors).toEqual([]);
});
