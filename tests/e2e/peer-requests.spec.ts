import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle } from './shell-fixture.js';
test.use({ baseURL: 'http://127.0.0.1:8787' });
async function fixture(page: Page) {
  let emit: (frame: unknown) => void = () => {}, runtime = '';
  const replies: Record<string, unknown>[] = [];
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer(); emit = frame => socket.send(JSON.stringify(frame));
    socket.onMessage(raw => {
      const frame = JSON.parse(String(raw));
      if (typeof frame.params?.session_id === 'string') runtime = frame.params.session_id;
      if (!frame.method && frame.id) { replies.push(frame); return; }
      server.send(raw);
    });
    server.onMessage(raw => socket.send(raw));
  });
  return { replies, request: (id: string, method: string, params: Record<string, unknown> = {}) =>
    emit({ jsonrpc: '2.0', id, method, params: { session_id: runtime, ...params } }),
  cancel: (id: string, method: string) => emit({ jsonrpc: '2.0', method: 'event', params: { type: 'request.cancel', session_id: runtime, payload: { id, method, reason: 'resolved' } } }) };
}
test('modern approval can be answered once without disconnecting or sending a prompt', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Peer approval setup'); await idle(page);
  rpc.request('srq-approval', 'approval', { request_id: 'approval-a', command: 'Native operation', choices: ['once', 'session', 'deny'] });
  const card = page.getByRole('article', { name: 'Hermes requests approval', exact: true });
  await expect(card).toBeVisible(); await expect(page.locator('#shell-prompt')).toBeDisabled();
  expect((await new AxeBuilder({ page }).include('.native-questions').analyze()).violations).toEqual([]);
  const button = card.getByRole('button', { name: 'Approve for session', exact: true });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44); await button.click();
  await expect(card).toHaveCount(0); expect(rpc.replies).toEqual([{ jsonrpc: '2.0', id: 'srq-approval', result: { choice: 'session' } }]);
  await expect(page.locator('#shell-prompt')).toBeEnabled();
});
test('modern secret input clears on cancellation and secret answers are absent from browser storage', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Peer secret setup'); await idle(page);
  rpc.request('srq-secret', 'secret', { env_var: 'SERVICE_KEY', prompt: 'Enter service key' });
  const card = page.getByRole('article', { name: 'Secret requested by Hermes', exact: true });
  await card.getByLabel('Secret requested by Hermes', { exact: true }).fill('PRIVATE-SECRET-123');
  rpc.cancel('srq-secret', 'secret'); await expect(card).toHaveCount(0); expect(rpc.replies).toHaveLength(0);
  rpc.request('srq-sudo', 'sudo', { command: 'Native privileged operation' });
  const sudo = page.getByRole('article', { name: 'Sudo password', exact: true });
  await sudo.getByLabel('Sudo password', { exact: true }).fill('PASSWORD-TEST');
  await sudo.getByRole('button', { name: 'Send answer to Hermes', exact: true }).click();
  await expect(sudo).toHaveCount(0); expect(rpc.replies[0]).toEqual({ jsonrpc: '2.0', id: 'srq-sudo', result: { value: 'PASSWORD-TEST' } });
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toMatch(/PASSWORD-TEST|PRIVATE-SECRET/);
});
test('modern batch clarify preserves locked answers and unknown bridges fail fast', async ({ page }) => {
  const rpc = await fixture(page); await login(page); await send(page, 'Peer batch setup'); await idle(page);
  rpc.request('srq-batch', 'clarify', { questions: [{ qid: 'locked', question: 'Locked question' }, { qid: 'next', question: 'Next question' }], answers: { locked: 'Server answer' } });
  const card = page.getByRole('article', { name: 'Hermes needs your input', exact: true });
  await expect(card).toContainText('Answer locked in Hermes: Server answer');
  await card.getByLabel('Your answer', { exact: true }).fill('Browser answer');
  await card.getByRole('button', { name: 'Send answer to Hermes', exact: true }).click();
  await expect(card).toHaveCount(0); expect(rpc.replies[0]).toEqual({ jsonrpc: '2.0', id: 'srq-batch', result: { answers: { locked: 'Server answer', next: 'Browser answer' } } });
  rpc.request('srq-unknown', 'window.read'); await expect.poll(() => rpc.replies.length).toBe(2);
  expect((rpc.replies[1]?.error as Record<string, unknown>).code).toBe(-32601); await expect(page.locator('#shell-prompt')).toBeEnabled();
});
