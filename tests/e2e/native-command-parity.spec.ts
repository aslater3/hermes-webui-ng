import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
const field = (page: Page) => page.locator('#shell-prompt');
const confirmation = (page: Page) => page.getByRole('dialog', { name: 'Confirm native command', exact: true });
async function prepare(page: Page, text: string) {
  await expect(field(page)).toBeEnabled(); await field(page).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(confirmation(page)).toBeVisible();
}
/** Synthetic effect shapes only. Unmodified Hermes plan/undo acceptance is separate. */
async function nativeFixture(page: Page) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let outcome: unknown = { type: 'exec', output: 'SYNTHETIC native command result' }, fail = false;
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer();
    socket.onMessage(raw => {
      const frame = JSON.parse(String(raw)); calls.push({ method: frame.method, params: frame.params ?? {} });
      const result = (value: unknown) => socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: value }));
      if (frame.method === 'config.get' && frame.params?.key === 'profile') result({ home: '/private/default' });
      else if (frame.method === 'command.dispatch') {
        if (fail) socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: 4018, message: 'PRIVATE_ERROR' } }));
        else result(outcome);
      } else server.send(raw);
    });
    server.onMessage(raw => socket.send(raw));
  });
  return { calls, outcome: (value: unknown) => { outcome = value; }, fail: () => { fail = true; },
    count: (method: string) => calls.filter(call => call.method === method).length };
}

test('confirmation, cancellation and keyboard-height recovery preserve the composer draft without native effects', async ({ page }, info) => {
  const rpc = await nativeFixture(page); await login(page); await send(page, 'Native command setup'); await idle(page);
  await prepare(page, '/undo 1'); await expect(field(page)).toHaveValue('/undo 1'); await expect(field(page)).toBeDisabled();
  expect(rpc.count('command.dispatch')).toBe(0); expect(rpc.count('prompt.submit')).toBe(1);
  expect((await new AxeBuilder({ page }).include('.modal-commands').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('native-command-confirmation.png') });
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 360 });
  const cancel = confirmation(page).getByRole('button', { name: 'Cancel command', exact: true });
  await cancel.scrollIntoViewIfNeeded(); expect((await cancel.boundingBox())!.height).toBeGreaterThanOrEqual(44); await cancel.click();
  await expect(field(page)).toBeEnabled(); await expect(field(page)).toHaveValue('/undo 1');
  expect(rpc.count('command.dispatch')).toBe(0);
});

test('catalogue native arguments are reviewed and inert output never replaces an unrelated draft', async ({ page }) => {
  const rpc = await nativeFixture(page); rpc.outcome({ type: 'plugin', output: '<script>PRIVATE_CODE()</script>\nNative output' });
  await login(page); await send(page, 'Native catalogue setup'); await idle(page); await field(page).fill('My unrelated unsent draft');
  await page.getByRole('button', { name: 'Browse Hermes commands', exact: true }).click();
  await page.getByRole('button', { name: 'Use /unsafe', exact: true }).click();
  await page.getByLabel('Native command arguments', { exact: true }).fill('list --all');
  await page.getByRole('button', { name: 'Review command', exact: true }).click();
  await expect(confirmation(page)).toContainText('/unsafe list --all'); expect(rpc.count('command.dispatch')).toBe(0);
  await confirmation(page).getByRole('button', { name: 'Run native command', exact: true }).click();
  const result = page.getByRole('dialog', { name: 'Command /unsafe', exact: true }); await expect(result).toContainText('Native output');
  expect(rpc.calls.filter(call => call.method === 'command.dispatch').map(call => call.params)).toEqual([
    { session_id: expect.any(String), name: 'unsafe', arg: 'list --all' },
  ]);
  expect(await page.evaluate(() => 'PRIVATE_CODE' in window)).toBe(false); await expect(result.locator('script')).toHaveCount(0);
  await result.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(field(page)).toHaveValue('My unrelated unsent draft'); expect(rpc.count('prompt.submit')).toBe(1);
});

test('skill execution sends the native scaffold exactly once, not the slash command or display label', async ({ page }) => {
  const rpc = await nativeFixture(page); rpc.outcome({ type: 'skill', message: 'SYNTHETIC skill scaffold: perform task', display: 'Display only' });
  await login(page); await send(page, 'Skill setup'); await idle(page); await prepare(page, '/default-skill perform task');
  expect(rpc.count('prompt.submit')).toBe(1);
  await confirmation(page).getByRole('button', { name: 'Run native command', exact: true }).click();
  await expect.poll(() => rpc.count('prompt.submit')).toBe(2); await idle(page);
  expect(rpc.calls.filter(call => call.method === 'prompt.submit').at(-1)?.params.text).toBe('SYNTHETIC skill scaffold: perform task');
  expect(rpc.count('command.dispatch')).toBe(1); await expect(field(page)).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('skill scaffold');
});

test('undo prefill is offered for editing and a leading slash remains literal when deliberately restored', async ({ page }) => {
  const rpc = await nativeFixture(page); rpc.outcome({ type: 'prefill', message: '/literal restored text', notice: 'Synthetic undo readback' });
  await login(page); await send(page, 'Undo setup'); await idle(page); await prepare(page, '/undo 1');
  await confirmation(page).getByRole('button', { name: 'Run native command', exact: true }).click();
  const recovered = page.getByRole('dialog', { name: 'Recovered command input', exact: true }); await expect(recovered).toContainText('/literal restored text');
  expect(rpc.count('prompt.submit')).toBe(1);
  await recovered.getByRole('button', { name: 'Use recovered input as draft', exact: true }).click();
  await expect(field(page)).toHaveValue('//literal restored text');
  await page.getByRole('button', { name: 'Send message', exact: true }).click(); await idle(page);
  expect(rpc.calls.filter(call => call.method === 'prompt.submit').at(-1)?.params.text).toBe('/literal restored text');
  expect(rpc.count('command.dispatch')).toBe(1);
});

test('an alias requires deliberate use of its recovered target and cannot trigger automatic recursion', async ({ page }) => {
  const rpc = await nativeFixture(page); rpc.outcome({ type: 'alias', target: '/unsafe another-target' });
  await login(page); await send(page, 'Alias setup'); await idle(page); await prepare(page, '/unsafe');
  await confirmation(page).getByRole('button', { name: 'Run native command', exact: true }).click();
  const recovered = page.getByRole('dialog', { name: 'Recovered command input', exact: true });
  await expect(recovered).toContainText('/unsafe another-target'); expect(rpc.count('command.dispatch')).toBe(1);
  await recovered.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(field(page)).toHaveValue(''); expect(rpc.count('prompt.submit')).toBe(1);
});

test('foreign-profile execution is rejected before dispatch instead of using the gateway launch profile', async ({ page }) => {
  const rpc = await nativeFixture(page); await login(page); await send(page, 'Profile setup'); await idle(page);
  await page.getByRole('button', { name: 'Profile: default', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation with Work', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Profile: work', exact: true })).toBeVisible();
  await prepare(page, '/work-skill task'); await confirmation(page).getByRole('button', { name: 'Run native command', exact: true }).click();
  await expect(page.locator('body')).toContainText('cannot safely run generic commands for the selected profile');
  await expect(field(page)).toBeEnabled(); await expect(field(page)).toHaveValue('/work-skill task');
  expect(rpc.count('command.dispatch')).toBe(0); expect(rpc.count('prompt.submit')).toBe(1);
});

test('failed execution blocks retries until the operator reviews native effects and refreshes', async ({ page }) => {
  const rpc = await nativeFixture(page); rpc.fail(); await login(page); await send(page, 'Uncertain outcome setup'); await idle(page);
  await prepare(page, '/unsafe'); await confirmation(page).getByRole('button', { name: 'Run native command', exact: true }).click();
  const uncertain = page.getByRole('dialog', { name: 'Check native command outcome', exact: true });
  await expect(uncertain).toContainText('may have had effects'); await expect(field(page)).toBeDisabled();
  await expect(page.locator('body')).not.toContainText('PRIVATE_ERROR'); expect(rpc.count('command.dispatch')).toBe(1);
  await uncertain.getByRole('button', { name: 'I have checked the effects — refresh native state', exact: true }).click();
  await expect(uncertain).toHaveCount(0); await expect(field(page)).toBeEnabled(); await expect(field(page)).toHaveValue('/unsafe');
  expect(rpc.count('command.dispatch')).toBe(1); expect(rpc.count('prompt.submit')).toBe(1);
});
