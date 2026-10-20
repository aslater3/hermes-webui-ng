import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
const field = (page: Page) => page.locator('#shell-prompt');
const tray = (page: Page) => page.getByRole('region', { name: 'Attachments for your next message' });
const attachButton = (page: Page) => page.getByRole('button', { name: 'Attach image or PDF', exact: true });
const picker = (page: Page) => page.getByTestId('attachment-input');

type Mode = 'ok' | 'unsupported' | 'pdf-unavailable';
// Synthetic native attachment RPCs over the real WebSocket. Not vanilla-Hermes evidence.
async function fixture(page: Page, mode: () => Mode = () => 'ok') {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer(), requests = new Map<unknown, string>();
    socket.onMessage(raw => {
      const frame = JSON.parse(String(raw)); calls.push({ method: frame.method, params: frame.params ?? {} });
      const result = (value: unknown) => socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: value }));
      const failure = (code: number, message: string) => socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code, message } }));
      const name = String(frame.params?.filename || frame.params?.path || 'file').split('/').pop() || 'file';
      if (frame.method === 'image.attach_bytes') {
        if (mode() === 'unsupported') { failure(-32601, 'method not found'); return; }
        result({ attached: true, count: calls.filter(call => call.method === 'image.attach_bytes').length, name, path: `/hermes/queue/${name}-${calls.length}.png`, bytes: 4 }); return;
      }
      if (frame.method === 'pdf.attach') {
        if (mode() === 'pdf-unavailable') { failure(5028, 'pdftoppm not installed'); return; }
        result({ attached: true, filename: name, pages_attached: 2, count: 2, text: '', pages: [
          { path: `/hermes/queue/${name}-1.png`, page: 1 }, { path: `/hermes/queue/${name}-2.png`, page: 2 }] }); return;
      }
      if (frame.method === 'image.detach') { result({ detached: true, count: 0 }); return; }
      requests.set(frame.id, frame.method); server.send(raw);
    });
    server.onMessage(raw => { requests.delete(JSON.parse(String(raw)).id); socket.send(raw); });
  });
  return { calls, count: (method: string) => calls.filter(call => call.method === method).length };
}
async function pngChip(page: Page, name: string) {
  await picker(page).setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  await expect(tray(page).getByText(name, { exact: true })).toBeVisible();
}
/** Dispatch a file list through a real DataTransfer, the same shape a drop or paste delivers. */
async function dispatchFiles(page: Page, target: string, event: 'drop' | 'paste', files: { name: string; type: string; size?: number }[]) {
  await page.evaluate(({ target, event, files }) => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([new Uint8Array(file.size ?? 4).fill(1)], file.name, { type: file.type }));
    const node = document.querySelector(target)!;
    if (event === 'drop') node.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    else node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, { target, event, files });
}

test('picker attaches an image to the selected native session and the chip can be removed', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Attachment setup'); await idle(page);
  await expect(attachButton(page)).toBeEnabled();
  await pngChip(page, 'diagram.png');
  expect(rpc.calls.filter(call => call.method === 'image.attach_bytes').at(-1)?.params).toMatchObject({ session_id: expect.any(String), profile: 'default', filename: 'diagram.png' });
  await expect(tray(page).locator('img.attachment-thumb')).toHaveCount(1);
  await tray(page).getByRole('button', { name: 'Remove attachment diagram.png', exact: true }).click();
  await expect(tray(page)).toHaveCount(0);
  await expect.poll(() => rpc.count('image.detach')).toBe(1);
  expect(rpc.calls.find(call => call.method === 'image.detach')?.params).toMatchObject({ path: expect.stringContaining('diagram.png') });
  expect(rpc.count('slash.exec')).toBe(0); expect(rpc.count('command.dispatch')).toBe(0);
});

test('a PDF is attached as its rendered pages and reports the page count', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'PDF setup'); await idle(page);
  await picker(page).setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(tray(page).getByText('report.pdf', { exact: true })).toBeVisible();
  await expect(tray(page)).toContainText('2 pages');
  expect(rpc.calls.find(call => call.method === 'pdf.attach')?.params).toMatchObject({ session_id: expect.any(String), filename: 'report.pdf' });
  expect(typeof rpc.calls.find(call => call.method === 'pdf.attach')?.params.content_base64).toBe('string');
});

test('drag and drop onto the composer attaches files on a fine pointer device', async ({ page }, info) => {
  test.skip(!!info.project.use.isMobile, 'drag and drop is a desktop gesture; touch uses the attach button');
  const rpc = await fixture(page); await login(page); await send(page, 'Drop setup'); await idle(page);
  await dispatchFiles(page, '.composer-dock', 'drop', [{ name: 'dropped.png', type: 'image/png' }]);
  await expect(tray(page).getByText('dropped.png', { exact: true })).toBeVisible();
  expect(rpc.count('image.attach_bytes')).toBe(1);
  await expect(page.locator('.composer-dock.is-dropping')).toHaveCount(0);
});

test('a pasted image attaches from the paste event and pasted text stays in the draft', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Paste attach setup'); await idle(page);
  await field(page).fill('Look at this');
  await dispatchFiles(page, '#shell-prompt', 'paste', [{ name: 'pasted.png', type: 'image/png' }]);
  await expect(tray(page).getByText('pasted.png', { exact: true })).toBeVisible();
  expect(rpc.count('image.attach_bytes')).toBe(1);
  await expect(field(page)).toHaveValue('Look at this');
});

test('an oversized image is refused with plain copy and nothing is sent to Hermes', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Oversize setup'); await idle(page);
  await dispatchFiles(page, '#shell-prompt', 'paste', [{ name: 'huge.png', type: 'image/png', size: 25 * 1024 * 1024 + 1 }]);
  await expect(page.getByRole('alert')).toContainText('Images must be 25 MB or smaller. huge.png was not attached.');
  expect(rpc.count('image.attach_bytes')).toBe(0);
  await expect(tray(page)).toHaveCount(1); // the error stays visible; no chip was created
  await expect(tray(page).getByRole('button')).toHaveCount(0);
});

test('a non-image, non-PDF file is refused before any RPC', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Type setup'); await idle(page);
  await picker(page).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByRole('alert')).toContainText('Only images and PDFs can be attached');
  expect(rpc.count('image.attach_bytes') + rpc.count('pdf.attach')).toBe(0);
});

test('sending clears the chips only after Hermes accepts the turn, and the attachment was queued first', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Before attachment'); await idle(page);
  await pngChip(page, 'context.png');
  await send(page, 'Please review the attached diagram'); await idle(page);
  await expect(tray(page)).toHaveCount(0);
  const submit = rpc.calls.map(call => call.method).lastIndexOf('prompt.submit');
  expect(rpc.calls.findIndex(call => call.method === 'image.attach_bytes')).toBeLessThan(submit);
  expect(rpc.count('image.detach')).toBe(0);
});

test('switching conversation clears the chips and they do not come back when returning', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Chip owner'); await idle(page);
  const owner = page.url();
  await pngChip(page, 'owner.png');
  // Leave the conversation the same way the app does on navigation (no full reload, so no fresh state).
  await page.evaluate(() => { history.pushState(null, '', location.pathname); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(tray(page)).toHaveCount(0);
  await expect.poll(() => rpc.count('image.detach')).toBeGreaterThanOrEqual(1);
  await page.goBack(); await idle(page);
  await expect(page.url()).toBe(owner);
  await expect(tray(page)).toHaveCount(0);
});

test('unsupported Hermes disables attach with honest copy and never shows a chip', async ({ page }) => {
  const rpc = await fixture(page, () => 'unsupported'); await login(page); await send(page, 'Unsupported setup'); await idle(page);
  await picker(page).setInputFiles({ name: 'plain.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  await expect(page.getByRole('alert')).toContainText('Attachments are not supported by this Hermes version.');
  await expect(attachButton(page)).toBeDisabled();
  await expect(tray(page).getByRole('button')).toHaveCount(0);
  expect(rpc.count('image.attach_bytes')).toBe(1);
});

test('a PDF that the host cannot render says why and attaches nothing', async ({ page }) => {
  await fixture(page, () => 'pdf-unavailable'); await login(page); await send(page, 'PDF host setup'); await idle(page);
  await picker(page).setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(page.getByRole('alert')).toContainText('PDF pages could not be rendered on this Hermes host');
  await expect(tray(page).getByRole('button')).toHaveCount(0);
});

test('the attach control is disabled with a reason when no conversation is open', async ({ page }) => {
  await fixture(page); await login(page);
  await expect(attachButton(page)).toBeDisabled();
  await expect(page.getByText('Open or start a conversation to attach files.')).toBeVisible();
});

test('a chip is removable from the keyboard and carries a screen-reader label', async ({ page }) => {
  await fixture(page); await login(page); await send(page, 'Keyboard setup'); await idle(page);
  await pngChip(page, 'keys.png');
  const remove = tray(page).getByRole('button', { name: 'Remove attachment keys.png', exact: true });
  await remove.focus(); await page.keyboard.press('Enter');
  await expect(tray(page)).toHaveCount(0);
});

test('attachment chips meet touch-target and accessibility rules', async ({ page }) => {
  await fixture(page); await login(page); await send(page, 'A11y setup'); await idle(page);
  await pngChip(page, 'accessible.png');
  const box = await tray(page).getByRole('button', { name: 'Remove attachment accessible.png', exact: true }).boundingBox();
  expect(box && box.width >= 44 && box.height >= 44).toBe(true);
  expect((await new AxeBuilder({ page }).include('.attachment-tray').analyze()).violations).toEqual([]);
});
