import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { workspaceFixture } from './workspace-fixture.js';
import { loginPwa } from './pwa-network.js';
import { login, send, idle } from './shell-fixture.js';
test.use({ baseURL: 'http://127.0.0.1:8787', serviceWorkers: 'allow' });

test('unmounted workspace is explained without fake write controls and chat still works', async ({ page }) => {
  await login(page); await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No workspace mounted' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Save file|Upload file|Commit changes/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await send(page, 'Chat works without a project mount'); await idle(page);
});

test('read-only lazy CodeMirror, breadcrumbs, download and return to chat work on desktop and phones', async ({ page }, info) => {
  const network = await workspaceFixture(page), errors: string[] = [], scripts: string[] = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', req => { if (req.resourceType() === 'script') scripts.push(req.url()); });
  try {
    await loginPwa(page, network.origin); await send(page, 'Keep this conversation while inspecting files'); await idle(page);
    expect(scripts.some(url => url.includes('/CodePreview-'))).toBe(false);
    await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    const region = page.getByRole('complementary', { name: 'Project workspace' });
    await expect(region.getByRole('button', { name: 'hello.ts File', exact: true })).toBeVisible();
    await expect(region).not.toContainText('.env');
    await region.getByRole('button', { name: 'hello.ts File', exact: true }).click();
    await expect(region.locator('.cm-content')).toContainText('Working project');
    await expect(region.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
    expect(scripts.some(url => url.includes('/CodePreview-'))).toBe(true);
    const nonce = await page.locator('meta[name="webui-style-nonce"]').getAttribute('content');
    expect(nonce).toBeTruthy();
    const styleNonces = await page.locator('style').evaluateAll(nodes => nodes.map(node => node.nonce));
    expect(styleNonces.every(value => value === nonce)).toBe(true);
    await region.getByRole('button', { name: 'Toggle line wrapping' }).click();
    const download = page.waitForEvent('download'); await region.getByRole('link', { name: 'Download file' }).click();
    expect((await download).suggestedFilename()).toBe('hello.ts');
    await region.getByRole('button', { name: 'Back', exact: true }).click();
    await region.getByRole('button', { name: 'src Folder', exact: true }).click();
    await region.getByRole('button', { name: 'settings.json File', exact: true }).click();
    await expect(region.locator('.cm-content')).toContainText('fixture only');
    expect((await new AxeBuilder({ page }).include('.file-workspace').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const dimensions = await region.boundingBox(); expect(dimensions!.height).toBeGreaterThan(400);
    if (page.viewportSize()!.width < 1180) expect(dimensions!.width).toBeGreaterThan(page.viewportSize()!.width - 25);
    for (const name of ['Back to chat', 'Refresh workspace', 'Toggle line wrapping']) expect((await region.getByRole('button', { name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath('workspace-code.png') });
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
    await expect(page.locator('.cm-editor')).toHaveCount(0); await expect(page.locator('.user-text').last()).toHaveText('Keep this conversation while inspecting files');
    await send(page, 'Continue after workspace inspection'); await idle(page);
    await network.unchanged(); expect(errors).toEqual([]);
  } finally { await network.close(); }
});

test('Git discovery, staged and working diffs never write the index', async ({ page }, info) => {
  const network = await workspaceFixture(page);
  try {
    await loginPwa(page, network.origin); await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    const region = page.getByRole('complementary', { name: 'Project workspace' });
    await region.getByRole('tab', { name: 'Git', exact: true }).click();
    await region.getByRole('button', { name: 'Root repository Inspect branch and changes', exact: true }).click();
    await expect(region.locator('.workspace-repo')).toContainText('main');
    const row = region.locator('.workspace-changes li').filter({ hasText: 'hello.ts' });
    await row.getByRole('button', { name: 'Staged diff' }).click();
    await expect(region.locator('.cm-content')).toContainText('-export const message = "Original project";');
    await expect(region.locator('.cm-content')).toContainText('+export const message = "Staged project";');
    await region.getByRole('button', { name: 'Back', exact: true }).click();
    await row.getByRole('button', { name: 'Working diff' }).click();
    await expect(region.locator('.cm-content')).toContainText('+export const message = "Working project";');
    await page.screenshot({ path: info.outputPath('workspace-diff.png') });
    await expect(region).not.toContainText('PRIVATE_WORKSPACE_CANARY');
    await network.unchanged(); expect(network.metrics.submits).toBe(0);
  } finally { await network.close(); }
});

test('active content stays inert; binary/large/blocked paths degrade without an executable preview', async ({ page }) => {
  const network = await workspaceFixture(page); await network.addLink();
  try {
    await loginPwa(page, network.origin); await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    const region = page.getByRole('complementary', { name: 'Project workspace' });
    await expect(region.getByRole('button', { name: 'blocked-link Unavailable', exact: true })).toBeDisabled();
    await region.getByRole('button', { name: 'image.svg File', exact: true }).click();
    await expect(region.locator('.cm-content')).toContainText('Inert SVG source'); expect(await page.evaluate(() => 'WORKSPACE_XSS' in window)).toBe(false);
    await region.getByRole('button', { name: 'Back', exact: true }).click(); await region.getByRole('button', { name: 'binary.bin File', exact: true }).click();
    await expect(region.getByRole('heading', { name: 'Binary file' })).toBeVisible();
    await region.getByRole('button', { name: 'Back', exact: true }).click(); await region.getByRole('button', { name: 'large.txt File', exact: true }).click();
    await expect(region.getByRole('heading', { name: 'File too large to preview' })).toBeVisible(); await expect(region.locator('.cm-editor')).toHaveCount(0);
    await network.unchanged();
  } finally { await network.close(); }
});

test('workspace content is erased on background, offline and expired native admission and never cached', async ({ page }) => {
  const network = await workspaceFixture(page);
  try {
    await loginPwa(page, network.origin); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    const region = page.getByRole('complementary', { name: 'Project workspace' });
    await region.getByRole('button', { name: 'hello.ts File', exact: true }).click(); await expect(region.locator('.cm-content')).toContainText('Working project');
    const cached = await page.evaluate(async () => {
      const paths: string[] = []; for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) paths.push(new URL(request.url).pathname);
      return paths;
    });
    expect(cached.some(path => path.includes('webui-local') || path.startsWith('/api/'))).toBe(false);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(region.locator('.cm-editor')).toHaveCount(0); await expect(region).not.toContainText('Working project');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await region.getByRole('button', { name: 'hello.ts File', exact: true }).click(); await expect(region.locator('.cm-content')).toContainText('Working project');
    await page.evaluate(() => window.dispatchEvent(new Event('offline'))); await expect(region.locator('.cm-editor')).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await region.getByRole('button', { name: 'hello.ts File', exact: true }).click(); await expect(region.locator('.cm-content')).toContainText('Working project');
    await page.evaluate(async () => { await fetch('/__hermes/auth/logout', { method: 'POST' }); });
    await region.getByRole('button', { name: 'Refresh workspace' }).click();
    await expect(page.locator('.cm-editor')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  } finally { await network.close(); }
});

test('trusted-local workspace and reduced-height mobile view retain the same read-only behaviour', async ({ page }) => {
  const network = await workspaceFixture(page, true);
  try {
    await page.goto(network.origin); await expect(page.locator('#shell-prompt')).toBeEnabled();
    await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    await page.getByRole('button', { name: 'hello.ts File', exact: true }).click(); await expect(page.locator('.cm-content')).toContainText('Working project');
    await page.setViewportSize({ width: 390, height: 440 });
    const back = page.getByRole('button', { name: 'Back to chat', exact: true }); await expect(back).toBeVisible();
    const box = await back.boundingBox(); expect(box!.y + box!.height).toBeLessThanOrEqual(440);
    await back.click(); await expect(page.locator('.cm-editor')).toHaveCount(0);
    await send(page, 'Continue in the existing local admission mode'); await idle(page); await network.unchanged();
  } finally { await network.close(); }
});
