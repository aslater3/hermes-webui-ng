import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
test('conversation details use a real desktop pane and a full-width mobile sheet without losing the draft', async ({ page }, info) => {
  await login(page); await send(page, 'Conversation details example'); await idle(page);
  await page.locator('#shell-prompt').fill('Keep this draft while inspecting details');
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('button', { name: 'Conversation details', exact: true }).click();
  const details = page.getByRole('complementary', { name: 'Conversation details', exact: true });
  await expect(details).toContainText('fixture-alpha'); await expect(details).toContainText('default');
  await expect(details).toContainText('idle');
  await details.getByRole('button', { name: 'Refresh native state', exact: true }).click();
  expect((await new AxeBuilder({ page }).include('.conversation-details').analyze()).violations).toEqual([]);
  if ((page.viewportSize()?.width ?? 0) >= 1180) await expect(page.locator('.workspace')).toHaveClass(/with-details/);
  else await expect(page.getByRole('dialog', { name: 'Conversation details', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('conversation-details.png') });
  await page.getByRole('button', { name: 'Close conversation details', exact: true }).click();
  await expect(page.locator('#shell-prompt')).toHaveValue('Keep this draft while inspecting details');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('portrait, landscape and keyboard-sized viewports preserve composer and draft', async ({ page }) => {
  await login(page); await page.locator('#shell-prompt').fill('Line one\nLine two');
  for (const size of [{width:390,height:844},{width:844,height:390},{width:390,height:360},{width:320,height:568}]) {
    await page.setViewportSize(size); await expect(page.locator('#shell-prompt')).toBeVisible();
    await expect(page.locator('#shell-prompt')).toHaveValue('Line one\nLine two');
    await expect.poll(async () => { const box = await page.getByRole('button',{name:'Send message',exact:true}).boundingBox(); return !!box && box.y >= 0 && box.y + box.height <= size.height + 1; }).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
