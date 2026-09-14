import { test, expect, type Page } from '@playwright/test';
import { login } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
const prompt = (page: Page) => page.locator('#shell-prompt');
const browse = (page: Page) => page.getByRole('button', { name: 'Browse Hermes commands', exact: true });
const catalogue = (page: Page) => page.getByRole('dialog', { name: 'Hermes commands', exact: true });

test('first-message catalogue settles even while shell animation-frame notifications are paused', async ({ page }) => {
  // Delay only rendering notifications, not network replies or React's control-store subscription.
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Map<number, FrameRequestCallback>(); let paused = false, held = 0;
    window.requestAnimationFrame = callback => {
      const id = request(time => {
        if (paused) { held++; return; }
        if (pending.delete(id)) callback(time);
      });
      pending.set(id, callback); return id;
    };
    window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
    Reflect.set(window, '__commandTestFrames', {
      pause: () => { paused = true; },
      held: () => held,
      resume: () => {
        paused = false;
        for (const [id, callback] of [...pending]) {
          pending.delete(id); cancel(id); window.requestAnimationFrame(callback);
        }
      },
    });
  });
  let release: (() => void) | undefined;
  const calls: string[] = [];
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer(), catalogues = new Set<unknown>();
    socket.onMessage(raw => {
      const frame = JSON.parse(String(raw)); calls.push(frame.method);
      if (frame.method === 'commands.catalog') catalogues.add(frame.id);
      server.send(raw);
    });
    server.onMessage(raw => {
      const frame = JSON.parse(String(raw));
      if (catalogues.delete(frame.id)) release = () => socket.send(raw);
      else socket.send(raw);
    });
  });
  await login(page); await prompt(page).fill('Preserve this first-message draft');
  await browse(page).click(); await expect(catalogue(page)).toContainText('Reading Hermes command catalogue…');
  await expect.poll(() => !!release).toBe(true);
  try {
    await page.evaluate(() => Reflect.get(window, '__commandTestFrames').pause());
    release!();
    await expect(catalogue(page).getByRole('button', { name: 'Use /undo', exact: true })).toBeDisabled();
    await expect(catalogue(page).getByRole('button', { name: 'Use /usage', exact: true })).toBeEnabled();
    await expect(catalogue(page)).not.toContainText('Reading Hermes command catalogue…');
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__commandTestFrames').held())).toBeGreaterThan(0);
    await expect(prompt(page)).toHaveValue('Preserve this first-message draft');
    expect(calls.filter(method => ['session.create', 'prompt.submit', 'slash.exec'].includes(method))).toEqual([]);
  } finally {
    await page.evaluate(() => Reflect.get(window, '__commandTestFrames').resume());
  }
});
