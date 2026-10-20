import { test, expect, type Page } from '@playwright/test';
import { login, send } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });

/** Where the approval card sits relative to the transcript scroller and the end of the transcript. */
async function placement(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('.conversation-scroll') as HTMLElement;
    const card = document.querySelector('.agent-approval') as HTMLElement;
    const region = card.closest('.conversation-requests') as HTMLElement | null;
    const content = document.querySelector('.conversation-content') as HTMLElement;
    const children = [...content.children] as HTMLElement[];
    const view = scroller.getBoundingClientRect(), box = card.getBoundingClientRect();
    return {
      pinnedToBottom: Math.abs(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) < 4,
      fullyVisible: box.top >= view.top && box.bottom <= view.bottom,
      tailOnScreen: box.bottom > view.top && box.bottom <= view.bottom + 1,
      atEndOfTranscript: !!region,
      inActivityStream: !!card.closest('.agent-activity'),
      // Anything with a real block height after the request region would sit below the request.
      trailingBlocks: !region || children.slice(children.indexOf(region) + 1).some(node => node.getBoundingClientRect().height > 2),
    };
  });
}

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

test('an unanswered request stays the newest block of the transcript', async ({ page }, info) => {
  // A real turn streams text and tool activity before Hermes pauses for approval. The request must
  // end up at the end of the transcript, in view, instead of above the reply asking for a scroll.
  let sid = '', injected = false;
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer();
    const relay = (type: string, payload: unknown) =>
      socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id: sid, payload } }));
    socket.onMessage(raw => server.send(raw));
    server.onMessage(raw => {
      const text = String(raw);
      let frame: { params?: { type?: string; session_id?: string } } = {};
      try { frame = JSON.parse(text); } catch { socket.send(text); return; }
      if (typeof frame?.params?.session_id === 'string' && frame.params.session_id) sid = frame.params.session_id;
      if (frame?.params?.type === 'approval.request' && !injected) {
        injected = true;
        for (let i = 0; i < 12; i++) relay('message.delta', { text: `Paragraph ${i} of the reply so far: ${'context '.repeat(20)}\n` });
        for (let i = 0; i < 5; i++) relay('tool.start', { tool_id: `before-${i}`, name: 'terminal', args: { command: `investigation step ${i}` } });
      }
      socket.send(text);
    });
  });
  await login(page);
  await send(page, `[agent-test] approval placement ${info.project.name}`);
  const approval = page.getByRole('article', { name: 'Operation approval', exact: true });
  await expect(approval).toBeVisible();
  await expect.poll(() => placement(page)).toMatchObject({
    pinnedToBottom: true, atEndOfTranscript: true, inActivityStream: false, tailOnScreen: true, trailingBlocks: false,
  });
  // A phone transcript pane is shorter than this card, so only a desktop viewport must show it whole.
  if (info.project.name === 'desktop-chromium')
    await expect.poll(() => placement(page)).toMatchObject({ fullyVisible: true });
  await approval.screenshot({ path: info.outputPath('pending-request-placement.png') });

  // Answering it returns the card to the chronological stream so the running reply keeps the tail.
  await approval.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect.poll(() => placement(page)).toMatchObject({ atEndOfTranscript: false, inActivityStream: true });
});
