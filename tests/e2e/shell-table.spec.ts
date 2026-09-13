import { test, expect } from '@playwright/test';
import { login, send, idle, richFixture } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
test('wide Markdown tables scroll within the conversation without compressing headings', async ({ page }, info) => {
  await richFixture(page);
  await login(page);
  await send(page, 'Show the network migration plan.');
  await idle(page);
  const region = page.getByRole('region', { name: 'Scrollable table' });
  await expect(region).toBeVisible();
  await region.scrollIntoViewIfNeeded();
  const geometry = await region.evaluate(node => {
    const table = node.querySelector('table')!;
    const heading = table.querySelector('th')!;
    return {
      outer: node.clientWidth,
      inner: node.scrollWidth,
      table: table.getBoundingClientRect().width,
      headingWrap: getComputedStyle(heading).whiteSpace,
      focusable: (node as HTMLElement).tabIndex,
      pageWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
    };
  });
  expect(geometry.table).toBeGreaterThanOrEqual(530);
  expect(geometry.headingWrap).toBe('nowrap');
  expect(geometry.focusable).toBe(0);
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport);
  if (geometry.outer < 530) {
    expect(geometry.inner).toBeGreaterThan(geometry.outer);
    await region.evaluate(node => { node.scrollLeft = node.scrollWidth; });
    expect(await region.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  }
  await region.screenshot({ path: info.outputPath('readable-markdown-table.png') });
});
