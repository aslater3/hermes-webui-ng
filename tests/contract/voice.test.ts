import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { localPathAllowed } from '../../server/trusted-local.js';
import { DashboardClient, HttpError } from '../../src/hermes/dashboard-client.js';
import { AUDIO_MAX_BYTES } from '../../src/hermes/voice.js';
import { startFixture } from '../fixtures/dashboard.js';
import { browserAuth } from '../helpers/browser-auth.js';

const TOKEN = 'LOCAL_VOICE_CONTRACT_TOKEN_NOT_A_SECRET';

async function gated(t: TestContext, voiceUnavailable = false) {
  const fixture = await startFixture(0, { voiceUnavailable });
  const config = loadConfig({ HERMES_DASHBOARD_URL: fixture.origin, PUBLIC_ORIGIN: 'http://127.0.0.1:1' });
  const app = createApp(config);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`; config.publicOrigin = new URL(origin);
  const auth = browserAuth(origin);
  const dashboard = new DashboardClient(origin, auth.fetcher);
  t.after(async () => { await app.close(); await fixture.close(); });
  return { origin, auth, dashboard, fixture, config };
}

const clip = 'data:audio/webm;base64,AAECAw==';

test('gated voice: transcribe and speak succeed through the authenticated proxy with same-origin POSTs', async t => {
  const h = await gated(t);
  await h.dashboard.login('basic', 'fixture', 'fixture-password');
  assert.equal(await h.dashboard.transcribe(clip, 'audio/webm', undefined), 'fixture dictation');
  const reply = await h.dashboard.speak('Hello', 'work');
  assert.equal(reply.mimeType, 'audio/mpeg'); assert.ok(reply.dataUrl.startsWith('data:audio/mpeg;base64,'));
  assert.equal(await h.dashboard.voiceAvailable(undefined), true);
});

test('gated voice: an unconfigured provider surfaces as an HTTP 503 the client can classify, not as success', async t => {
  const h = await gated(t, true);
  await h.dashboard.login('basic', 'fixture', 'fixture-password');
  await assert.rejects(() => h.dashboard.transcribe(clip, 'audio/webm', undefined), (error: unknown) => error instanceof HttpError && error.status === 503);
  await assert.rejects(() => h.dashboard.speak('Hello', undefined), (error: unknown) => error instanceof HttpError && error.status === 503);
});

test('gated voice: POSTs without a same-origin Origin are refused before reaching Hermes', async t => {
  const h = await gated(t);
  await h.dashboard.login('basic', 'fixture', 'fixture-password');
  const cases: Record<string, string>[] = [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, {}];
  for (const headers of cases) {
    const response = await fetch(`${h.origin}/__hermes/api/audio/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ data_url: clip, mime_type: 'audio/webm' }) });
    assert.equal(response.status, 403, JSON.stringify(headers));
  }
  const speak = await fetch(`${h.origin}/__hermes/api/audio/speak`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{"text":"x"}' });
  assert.equal(speak.status, 403);
  assert.equal(h.fixture.metrics.submits, 0);
});

test('gated voice: an unauthenticated POST gets no transcript or audio', async t => {
  const h = await gated(t);
  const response = await fetch(`${h.origin}/__hermes/api/audio/transcribe`, { method: 'POST', headers: { Origin: h.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ data_url: clip, mime_type: 'audio/webm' }) });
  assert.equal(response.status, 401);
  assert.ok(!(await response.text()).includes('fixture dictation'));
});

test('gated voice: the largest permitted recording fits under the proxy body limit', async t => {
  const h = await gated(t);
  const encoded = Math.ceil(AUDIO_MAX_BYTES / 3) * 4;
  const envelope = 512;
  assert.ok(encoded + envelope < h.config.maxBodyBytes, `recording body ${encoded + envelope} must stay under ${h.config.maxBodyBytes}`);
});

test('gated voice: security headers allow same-origin microphone and blob playback only', async t => {
  const h = await gated(t);
  const page = await fetch(`${h.origin}/`);
  const policy = page.headers.get('permissions-policy') ?? '';
  assert.match(policy, /microphone=\(self\)/);
  assert.match(policy, /camera=\(\)/, 'camera stays denied; the picker offers the camera without NG requesting it');
  const csp = page.headers.get('content-security-policy') ?? '';
  assert.match(csp, /media-src 'self' blob:/);
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(csp, /media-src[^;]*(data:|https?:|\*)/);
});

test('trusted-local voice: the route allowlist refuses audio routes for every method', () => {
  assert.equal(localPathAllowed('/api/audio/transcribe', 'POST'), false);
  assert.equal(localPathAllowed('/api/audio/speak', 'POST'), false);
  assert.equal(localPathAllowed('/api/audio/voice-config', 'GET'), false);
  assert.equal(localPathAllowed('/api/audio/transcribe', 'GET'), false);
  assert.equal(localPathAllowed('/api/audio/voice-config?profile=work', 'GET'), false);
});

test('trusted-local voice: the proxy refuses audio POSTs and the browser client never calls them', async t => {
  const upstream = await startFixture(0, { sessionToken: TOKEN });
  const config = loadConfig({ HERMES_AUTH_MODE: 'trusted-local', HERMES_DASHBOARD_SESSION_TOKEN: TOKEN, HERMES_DASHBOARD_URL: upstream.origin, PUBLIC_ORIGIN: 'http://127.0.0.1:1' });
  const app = createApp(config);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`; config.publicOrigin = new URL(origin);
  t.after(async () => { await app.close(); await upstream.close(); });
  const post = await fetch(`${origin}/__hermes/api/audio/transcribe`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ data_url: clip, mime_type: 'audio/webm' }) });
  assert.equal(post.status, 403);
  assert.equal((await post.json()).error.code, 'LOCAL_ROUTE_UNAVAILABLE');
  const get = await fetch(`${origin}/__hermes/api/audio/voice-config`);
  assert.equal(get.status, 403);
  const local = new DashboardClient(origin);
  await local.status();
  assert.equal(local.admissionMode, 'trusted-local');
  await assert.rejects(local.transcribe(clip, 'audio/webm', undefined));
});
