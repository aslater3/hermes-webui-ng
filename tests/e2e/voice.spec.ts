import { test, expect, type Page, type Request } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, send, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
const field = (page: Page) => page.locator('#shell-prompt');
const dictate = (page: Page) => page.getByRole('button', { name: 'Dictate a message', exact: true });
const stopRecording = (page: Page) => page.getByRole('button', { name: 'Stop recording', exact: true });
const status = (page: Page) => page.locator('.dictation-status');
const alert = (page: Page) => page.getByRole('alert');

/**
 * Synthetic device stubs. No real microphone is opened and no audio is played: MediaRecorder yields a
 * tiny silent blob, getUserMedia honours window.__voiceMode, and HTMLMediaElement.play is counted, not run.
 */
async function stubDevices(page: Page, mode: 'ok' | 'denied' | 'no-mic' | 'busy' = 'ok', options: { noRecorder?: boolean } = {}) {
  await page.addInitScript(({ mode, noRecorder }) => {
    (window as unknown as { __voiceMode: string }).__voiceMode = mode;
    (window as unknown as { __played: number }).__played = 0;
    // A non-loading stand-in: no media element decodes or plays anything; play() is counted only.
    (window as unknown as { Audio: unknown }).Audio = class {
      onended: (() => void) | null = null; onerror: (() => void) | null = null; src: string;
      constructor(src: string) { this.src = src; }
      play() { (window as unknown as { __played: number }).__played += 1; return Promise.resolve(); }
      pause() { /* nothing is playing */ }
    };
    class FakeRecorder {
      state = 'inactive'; ondataavailable: ((event: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null; onerror: ((event: unknown) => void) | null = null;
      constructor(_stream: unknown, _options?: unknown) { /* the stub ignores the requested codec */ }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array(64)], { type: 'audio/webm' }) }); this.onstop?.(); }, 0); }
      static isTypeSupported(type: string) { return type.startsWith('audio/webm'); }
    }
    if (noRecorder) Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: undefined });
    else Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FakeRecorder });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => {
        const current = (window as unknown as { __voiceMode: string }).__voiceMode;
        if (current === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
        if (current === 'no-mic') throw new DOMException('No device', 'NotFoundError');
        if (current === 'busy') throw new DOMException('In use', 'NotReadableError');
        return { getTracks: () => [{ stop() { /* released */ } }] };
      },
    } });
  }, { mode, noRecorder: options.noRecorder ?? false });
}
const played = (page: Page) => page.evaluate(() => (window as unknown as { __played: number }).__played);

/** Counts gated audio requests and keeps only their method and route, never the audio payload. */
function audioRequests(page: Page) {
  const seen: { method: string; route: string; body: string }[] = [];
  page.on('request', (request: Request) => {
    if (!request.url().includes('/__hermes/api/audio/')) return;
    seen.push({ method: request.method(), route: new URL(request.url()).pathname, body: request.postData() ?? '' });
  });
  return { seen, transcribe: () => seen.filter(item => item.route.endsWith('/transcribe')), speak: () => seen.filter(item => item.route.endsWith('/speak')) };
}

test('dictation records, transcribes and inserts text into the draft for review without sending', async ({ page }) => {
  await stubDevices(page); const audio = audioRequests(page);
  await login(page);
  await expect(dictate(page)).toBeEnabled();
  await dictate(page).click();
  await expect(status(page)).toContainText('Recording');
  await expect(status(page)).toContainText('0:00 / 1:00');
  await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).click();
  await expect(field(page)).toHaveValue('fixture dictation');
  await expect(page.locator('[data-role="user"]')).toHaveCount(0);
  expect(audio.transcribe()).toHaveLength(1);
  expect(audio.transcribe()[0]?.method).toBe('POST');
  expect(audio.transcribe()[0]?.body).toContain('data:audio/webm;base64,');
  await expect(status(page)).toHaveCount(0);
});

test('a second take appends to the draft with one space and never replaces typed text', async ({ page }) => {
  await stubDevices(page); await login(page);
  await field(page).fill('Typed first');
  await expect(dictate(page)).toBeEnabled();
  await dictate(page).click(); await expect(status(page)).toContainText('Recording');
  await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).click();
  await expect(field(page)).toHaveValue('Typed first fixture dictation');
});

test('cancel discards the take without any upload', async ({ page }) => {
  await stubDevices(page); const audio = audioRequests(page); await login(page);
  await dictate(page).click();
  await expect(status(page)).toContainText('Recording');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(status(page)).toHaveCount(0);
  await expect(field(page)).toHaveValue('');
  await page.waitForTimeout(50);
  expect(audio.transcribe()).toHaveLength(0);
});

test('denied microphone permission explains the fix and does not record', async ({ page }) => {
  await stubDevices(page, 'denied'); const audio = audioRequests(page); await login(page);
  await dictate(page).click();
  await expect(alert(page)).toContainText('Microphone access was blocked');
  await expect(stopRecording(page)).toHaveCount(0);
  expect(audio.transcribe()).toHaveLength(0);
});

test('no microphone and a busy microphone each say what happened', async ({ page }) => {
  await stubDevices(page, 'no-mic'); await login(page);
  await dictate(page).click();
  await expect(alert(page)).toContainText('No microphone was found');
});

test('a busy microphone says another app is using it', async ({ page }) => {
  await stubDevices(page, 'busy'); await login(page);
  await dictate(page).click();
  await expect(alert(page)).toContainText('The microphone is in use by another app');
});

test('an unavailable speech provider degrades to typed input with plain copy', async ({ page }) => {
  await stubDevices(page); await login(page);
  await page.route('**/__hermes/api/audio/transcribe*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'provider' }, detail: 'No provider configured' }) }));
  await dictate(page).click(); await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).click();
  await expect(alert(page)).toContainText('Speech-to-text is not available on this Hermes host right now');
  await expect(alert(page)).not.toContainText('No provider configured');
  await expect(field(page)).toHaveValue('');
  await expect(dictate(page)).toBeEnabled();
});

test('a browser without recording support does not offer dictation and keeps typing', async ({ page }) => {
  await stubDevices(page, 'ok', { noRecorder: true }); await login(page);
  await expect(dictate(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Attach image or PDF', exact: true })).toBeVisible();
  await field(page).fill('Still typing');
  await expect(field(page)).toHaveValue('Still typing');
});

test('dictation controls meet touch-target rules and the recording state passes axe', async ({ page }) => {
  await stubDevices(page); await login(page);
  const box = await dictate(page).boundingBox();
  expect(box && box.width >= 44 && box.height >= 44).toBe(true);
  await dictate(page).click();
  await expect(status(page)).toContainText('Recording');
  expect((await new AxeBuilder({ page }).include('.composer-dock').analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('read aloud plays one assistant reply at a time, stops on request, and never autoplays', async ({ page }) => {
  await stubDevices(page); const audio = audioRequests(page); await login(page);
  await send(page, 'Speak the first answer'); await idle(page);
  await send(page, 'Speak the second answer'); await idle(page);
  expect(await played(page)).toBe(0);
  const replies = page.locator('[data-role="assistant"]');
  await expect(replies).toHaveCount(2);
  await replies.nth(0).getByRole('button', { name: 'Read aloud', exact: true }).click();
  await expect(replies.nth(0).getByRole('button', { name: 'Stop reading aloud', exact: true })).toBeVisible();
  await expect.poll(() => played(page)).toBe(1);
  await replies.nth(1).getByRole('button', { name: 'Read aloud', exact: true }).click();
  await expect(replies.nth(0).getByRole('button', { name: 'Read aloud', exact: true })).toBeVisible();
  await expect.poll(() => played(page)).toBe(2);
  await replies.nth(1).getByRole('button', { name: 'Stop reading aloud', exact: true }).click();
  await expect(replies.nth(1).getByRole('button', { name: 'Read aloud', exact: true })).toBeVisible();
  expect(audio.speak()).toHaveLength(2);
  expect(audio.speak().every(item => item.method === 'POST')).toBe(true);
  expect(audio.speak().every(item => !item.body.includes('data:'))).toBe(true);
});

test('read aloud surfaces an unavailable provider and stays silent', async ({ page }) => {
  await stubDevices(page); await login(page);
  await send(page, 'Speak with no provider'); await idle(page);
  await page.route('**/__hermes/api/audio/speak*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"no tts"}' }));
  const reply = page.locator('[data-role="assistant"]').last();
  await reply.getByRole('button', { name: 'Read aloud', exact: true }).click();
  await expect(reply).toContainText('Read aloud is not available on this Hermes host right now');
  expect(await played(page)).toBe(0);
});

test('switching conversation stops a playing reply', async ({ page }) => {
  await stubDevices(page); await login(page);
  await send(page, 'Speak then leave'); await idle(page);
  await page.locator('[data-role="assistant"]').last().getByRole('button', { name: 'Read aloud', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop reading aloud', exact: true })).toBeVisible();
  await page.evaluate(() => { history.pushState(null, '', location.pathname); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByRole('button', { name: 'Stop reading aloud', exact: true })).toHaveCount(0);
});

test('trusted-local hides voice with honest copy and never calls audio routes', async ({ page }) => {
  await stubDevices(page);
  const audio = audioRequests(page);
  await page.goto('http://127.0.0.1:8789/');
  await expect(page.getByRole('button', { name: 'Connection status: Connected' })).toBeVisible();
  await expect(field(page)).toBeEnabled();
  await expect(dictate(page)).toHaveCount(0);
  await expect(page.getByText('Voice is available when signed in through the Hermes Dashboard.', { exact: true })).toBeVisible();
  await send(page, 'Local voice check'); await idle(page);
  await expect(page.locator('[data-role="assistant"]').last().getByRole('button', { name: 'Read aloud', exact: true })).toHaveCount(0);
  expect(audio.seen).toEqual([]);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
});
