import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
async function fixture(page: Page) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let emit: (frame: unknown) => void = () => {}, runtime = '';
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const upstream = socket.connectToServer(), methods = new Map<unknown, string>();
    emit = frame => socket.send(JSON.stringify(frame));
    socket.onMessage(raw => {
      const frame = JSON.parse(String(raw)); calls.push({ method: frame.method, params: frame.params ?? {} }); methods.set(frame.id, frame.method);
      if (frame.params?.session_id) runtime = frame.params.session_id;
      const reply = (result: unknown) => { methods.delete(frame.id); emit({ jsonrpc: '2.0', id: frame.id, result }); };
      if (frame.method === 'config.get' && frame.params.key === 'profile') reply({ home: '/private/default' });
      else if (frame.method === 'prompt.btw') {
        // Deliberately deliver before acknowledgement to test the correlation race.
        emit({ jsonrpc: '2.0', method: 'event', params: { type: 'btw.complete', session_id: runtime, payload: { task_id: 'btw_test', text: '<script>notExecuted()</script>\nNative side answer' } } });
        reply({ task_id: 'btw_test' });
      } else if (frame.method === 'session.compress') reply({ status: 'compressed', removed: 0, summary: { headline: 'Native compression preview', token_line: 'No transcript rows changed' } });
      else if (frame.method === 'session.title') reply({ title: frame.params.title, pending: false });
      else if (frame.method === 'process.stop') reply({ killed: 2 });
      else upstream.send(raw);
    });
    upstream.onMessage(raw => {
      const frame = JSON.parse(String(raw));
      if (methods.get(frame.id) === 'commands.catalog') frame.result.pairs.push(...['/title', '/stop', '/btw'].map(name => [name, 'Dedicated native command']));
      methods.delete(frame.id); emit(frame);
    });
  });
  return calls;
}
async function execute(page: Page, command: string) {
  await page.locator('#shell-prompt').fill(command);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm native command', exact: true }).getByRole('button', { name: 'Run native command', exact: true }).click();
}

test('compression uses its native long-running route and preserves the existing conversation', async ({ page }) => {
  const calls = await fixture(page); await login(page); await send(page, 'Compression route setup'); await idle(page);
  await execute(page, '/compress here 3 --preview');
  const dialog = page.getByRole('dialog', { name: 'Command /compress', exact: true });
  await expect(dialog).toContainText('Native compression preview');
  expect(calls.filter(call => call.method === 'session.compress').map(call => call.params)).toEqual([
    { session_id: expect.any(String), profile: 'default', focus_topic: 'here 3 --preview' },
  ]);
  expect(calls.filter(call => ['slash.exec', 'command.dispatch'].includes(call.method))).toHaveLength(0);
  expect(calls.filter(call => call.method === 'prompt.submit')).toHaveLength(1);
});

test('side-command result survives event-before-ack, renders safely and is accessible on mobile', async ({ page }) => {
  const calls = await fixture(page); await login(page); await send(page, 'Side command setup'); await idle(page);
  await execute(page, '/btw Explain the last answer');
  const tasks = page.getByRole('region', { name: 'Native command tasks', exact: true });
  await expect(tasks.locator('summary')).toContainText('Result received'); await tasks.locator('summary').click();
  await expect(tasks).toContainText('Native side answer'); await expect(tasks.locator('script')).toHaveCount(0);
  const button = tasks.getByRole('button', { name: 'Dismiss task result', exact: true });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await new AxeBuilder({ page }).include('.native-command-tasks').analyze()).violations).toEqual([]);
  expect(calls.filter(call => call.method === 'prompt.btw')).toHaveLength(1);
  expect(calls.filter(call => call.method === 'prompt.submit')).toHaveLength(1);
  await button.click(); await expect(tasks).toHaveCount(0);
});

test('stop is reachable during a native approval wait and uses interrupt plus explicitly global cleanup', async ({ page }) => {
  const calls = await fixture(page); await login(page); await send(page, '[agent-test] Hold for stop command');
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Browse Hermes commands', exact: true }).click();
  await page.getByRole('button', { name: 'Use /stop', exact: true }).click();
  await page.getByRole('button', { name: 'Review command', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm native command', exact: true });
  await expect(confirm).toContainText('whole Hermes process registry');
  await confirm.getByRole('button', { name: 'Run native command', exact: true }).click();
  const result = page.getByRole('dialog', { name: 'Command /stop', exact: true });
  await expect(result).toContainText('Stopped 2 background processes');
  expect(calls.filter(call => ['session.interrupt', 'process.stop'].includes(call.method)).map(call => call.method)).toEqual(['session.interrupt', 'process.stop']);
  expect(calls.filter(call => ['slash.exec', 'command.dispatch'].includes(call.method))).toHaveLength(0);
});
