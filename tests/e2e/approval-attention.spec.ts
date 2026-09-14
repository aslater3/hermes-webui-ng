import { test, expect } from '@playwright/test';
import { login, send } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });

test('approval is visually prominent and explains the Hermes expiry boundary', async ({ page }, info) => {
  await login(page);
  await send(page, `[agent-test] approval prominence ${info.project.name}`);
  const approval = page.getByRole('article', { name: 'Operation approval', exact: true });
  await expect(approval).toBeVisible();
  await expect(approval.getByRole('heading', { name: 'Permission required', exact: true })).toBeVisible();
  await expect(approval).toContainText('Hermes is paused until you decide');
  await expect(approval).toContainText('defaults to five minutes');
  await expect(approval.locator('.agent-input-status')).toHaveText('Action paused — choose an approval scope, YOLO, or Deny');
  await expect(page.locator('.attention-strip')).toContainText('request need your input');
  const style = await approval.evaluate(element => {
    const computed = getComputedStyle(element);
    return { borderWidth: parseFloat(computed.borderTopWidth), borderColor: computed.borderTopColor, background: computed.backgroundColor };
  });
  expect(style.borderWidth).toBeGreaterThanOrEqual(2);
  expect(style.borderColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
  for (const name of ['Allow once', 'Approve for session', 'YOLO', 'Deny']) {
    const box = await approval.getByRole('button', { name, exact: true }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await approval.screenshot({ path: info.outputPath('permission-required.png') });
});

test('a new approval plays one short browser chime after audio has been unlocked', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.assign(window, { __approvalBeeps: 0 });
    class FakeParam { setValueAtTime() {} exponentialRampToValueAtTime() {} }
    class FakeOscillator {
      type = 'sine'; frequency = new FakeParam(); connect() { return this; }
      start() { (window as unknown as { __approvalBeeps: number }).__approvalBeeps += 1; }
      stop() {}
    }
    class FakeGain { gain = new FakeParam(); connect() { return this; } }
    class FakeAudioContext {
      state: 'suspended' | 'running' | 'closed' = 'suspended'; currentTime = 0; destination = {};
      createOscillator() { return new FakeOscillator(); }
      createGain() { return new FakeGain(); }
      resume() { this.state = 'running'; return Promise.resolve(); }
      close() { this.state = 'closed'; return Promise.resolve(); }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  });
  await login(page);
  expect(await page.evaluate(() => (window as unknown as { __approvalBeeps: number }).__approvalBeeps)).toBe(0);
  await send(page, `[agent-test] approval chime ${info.project.name}`);
  await expect(page.getByRole('article', { name: 'Operation approval', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __approvalBeeps: number }).__approvalBeeps)).toBe(1);
  await page.setViewportSize({ width: page.viewportSize()!.width, height: Math.max(420, page.viewportSize()!.height - 1) });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as unknown as { __approvalBeeps: number }).__approvalBeeps)).toBe(1);
});
