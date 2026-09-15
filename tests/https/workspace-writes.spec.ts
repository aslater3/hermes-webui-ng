import { test, expect, type Locator, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { workspaceFixture } from '../e2e/workspace-fixture.js';
import { loginPwa } from '../e2e/pwa-network.js';

// CodeMirror owns selection; use its actual editable surface and keyboard commands,
// never race a transient loading placeholder or mutate its DOM via fill().
async function replaceText(page: Page, dialog: Locator, text: string) {
  const editor = dialog.locator('.cm-content[contenteditable="true"]');
  await expect(editor).toBeVisible(); await editor.click();
  // Playwright resolves ControlOrMeta from the Linux runner, but this editor
  // deliberately uses Apple's keymap in an emulated iPhone browser.
  const apple = await page.evaluate(() => /Mac/.test(navigator.platform) || /iP(?:hone|ad|od)/.test(navigator.userAgent));
  await editor.press(apple ? 'Meta+A' : 'Control+A'); await editor.press('Backspace');
  await expect(editor).toHaveText(''); await page.keyboard.insertText(text);
  await expect(editor).toHaveText(text);
}

test('operator-enabled editing saves exact text and preserves a draft across background and discarded-close cancellation', async ({ page }, info) => {
  const f = await workspaceFixture(page, false, true);
  try {
    await loginPwa(page, f.origin); await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    await page.getByRole('button', { name: 'hello.ts File', exact: true }).click();
    await page.getByRole('button', { name: 'Edit file', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit workspace file', exact: true });
    const editor = dialog.getByLabel('Edit file content', { exact: true });
    await replaceText(page, dialog, 'export const edited = true;');
    await expect(dialog.getByRole('button', { name: 'Save file', exact: true })).toBeEnabled();
    page.once('dialog', event => { void event.dismiss(); });
    await dialog.getByRole('button', { name: 'Discard and close', exact: true }).click();
    await expect(editor).toHaveText('export const edited = true;');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(dialog.locator('.cm-editor')).toHaveCount(0);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(editor).toHaveText('export const edited = true;');
    // Cancel an actual browser reload; a subsequent deliberate Save must still work.
    page.once('dialog', event => { void event.dismiss(); });
    await page.evaluate(() => location.reload());
    await expect(editor).toHaveText('export const edited = true;');
    expect((await new AxeBuilder({ page }).include('.modal-workspace-mutation').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('workspace-edit.png') });
    // A reduced-height 320px surface models the viewport pressure of a touch keyboard.
    await page.setViewportSize({ width: 320, height: 440 });
    // The matchMedia transition rebuilds the modal shell. Wait for the actual
    // compact workspace and editor before measuring its controls.
    await expect(page.locator('.modal-workspace[open]')).toBeVisible();
    await expect(page.locator('.modal-workspace-mutation[open]')).toBeVisible();
    await expect(editor).toHaveText('export const edited = true;');
    const saveButton = dialog.getByRole('button', { name: 'Save file', exact: true });
    await expect(saveButton).toBeVisible();
    await expect.poll(async () => {
      const box = await saveButton.boundingBox();
      return !!box && box.height >= 44 && box.y >= 0 && box.y + box.height <= 440;
    }, { message: 'The settled mobile Save control is touch-sized and within the viewport' }).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('workspace-edit-narrow.png') });
    await dialog.getByRole('button', { name: 'Save file', exact: true }).click();
    await expect(dialog).toContainText('confirmed the workspace operation');
    expect(await readFile(join(f.project, 'hello.ts'), 'utf8')).toBe('export const edited = true;');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await f.unchanged();
  } finally { await f.close(); }
});

test('stale file saves preserve the newer file and require explicit readback and version choice', async ({ page }) => {
  const f = await workspaceFixture(page, false, true);
  try {
    await loginPwa(page, f.origin); await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    await page.getByRole('button', { name: 'hello.ts File', exact: true }).click(); await page.getByRole('button', { name: 'Edit file', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit workspace file', exact: true });
    await replaceText(page, dialog, 'my reviewed edit');
    await writeFile(join(f.project, 'hello.ts'), 'newer outside edit');
    await dialog.getByRole('button', { name: 'Save file', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Read current state' })).toBeVisible();
    expect(await readFile(join(f.project, 'hello.ts'), 'utf8')).toBe('newer outside edit');
    await dialog.getByRole('button', { name: 'Read current state' }).click();
    await dialog.getByText('Review current file', { exact: true }).click(); await expect(dialog.locator('pre')).toHaveText('newer outside edit');
    page.once('dialog', event => { void event.accept(); }); await dialog.getByRole('button', { name: 'Keep draft against current version' }).click();
    await dialog.getByRole('button', { name: 'Save file', exact: true }).click(); await expect(dialog).toContainText('confirmed the workspace operation');
    expect(await readFile(join(f.project, 'hello.ts'), 'utf8')).toBe('my reviewed edit');
  } finally { await f.close(); }
});

test('trusted-local folder, upload, rename and non-recursive delete use explicit touch-accessible confirmations', async ({ page }) => {
  const f = await workspaceFixture(page, true, true);
  try {
    await page.goto(f.origin); await expect(page.locator('#shell-prompt')).toBeEnabled();
    await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Create folder', exact: true });
    await dialog.getByLabel('Destination path').fill('created'); await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
    await expect(dialog).toContainText('confirmed the workspace operation'); await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'created Folder', exact: true }).click();
    await page.getByLabel('Choose upload file').setInputFiles({ name: 'uploaded.txt', mimeType: 'text/plain', buffer: Buffer.from('uploaded test text') });
    dialog = page.getByRole('dialog', { name: 'Upload file', exact: true });
    await dialog.getByRole('button', { name: 'Upload file', exact: true }).click(); await expect(dialog).toContainText('confirmed the workspace operation'); await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await readFile(join(f.project, 'created/uploaded.txt'), 'utf8')).toBe('uploaded test text');
    await page.getByRole('button', { name: 'Rename uploaded.txt', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Rename entry', exact: true });
    await dialog.getByLabel('Destination path').fill('created/renamed.txt'); await dialog.getByRole('button', { name: 'Confirm rename', exact: true }).click(); await expect(dialog).toContainText('confirmed the workspace operation'); await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Delete renamed.txt', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Delete entry', exact: true });
    await expect(dialog).toContainText('no recycle bin');
    expect((await dialog.getByRole('button', { name: 'Confirm delete' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await dialog.getByRole('button', { name: 'Confirm delete' }).click(); await expect(dialog).toContainText('confirmed the workspace operation');
    await f.unchanged();
  } finally { await f.close(); }
});
