import type { Page } from '@playwright/test';

/** Exercise document-initiated reload, including a full reload when the URL has a session fragment. */
export async function reloadPwa(page: Page): Promise<void> {
  const loaded = page.waitForEvent('load');
  await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
  await loaded;
}
