import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../server/config.js';
import { createApp } from '../../server/app.js';
import { startFixture } from '../fixtures/dashboard.js';
interface Result { roots?: { writable: boolean }[]; version?: string; size?: number; error?: { code: string } }
const prefix = '/__hermes/webui-local/';
async function setup(t: TestContext, local = false, enabled = true) {
  const base = await mkdtemp(join(tmpdir(), 'write-wire-')), root = join(base, 'project'); await mkdir(root);
  await writeFile(join(root, 'file.txt'), 'original\r\n', { mode: 0o600 });
  const cert = join(base, 'server.crt'), key = join(base, 'server.key');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const token = 'SYNTHETIC_WRITE_TOKEN', upstream = await startFixture(0, local ? { sessionToken: token } : {});
  const config = loadConfig({ HERMES_DASHBOARD_URL: upstream.origin, PUBLIC_ORIGIN: 'https://127.0.0.1:1', WEBUI_TLS_CERT: cert, WEBUI_TLS_KEY: key, WORKSPACE_ROOTS: root,
    ...(enabled ? { WORKSPACE_WRITE_ENABLED: 'true', WORKSPACE_WRITABLE_ROOTS: 'workspace' } : {}),
    ...(local ? { HERMES_AUTH_MODE: 'trusted-local', HERMES_DASHBOARD_SESSION_TOKEN: token } : {}) });
  const logs: unknown[] = [], app = createApp(config, event => logs.push(event));
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const addr = app.server.address(); assert.ok(addr && typeof addr !== 'string'); config.publicOrigin = new URL(`https://127.0.0.1:${addr.port}`);
  const ca = await readFile(cert);
  const request = (path: string, method = 'GET', value?: unknown, headers: Record<string, string> = {}) => new Promise<{ status: number; data: Result; text: string }>((resolve, reject) => {
    const raw = value instanceof Buffer ? value : value === undefined ? undefined : JSON.stringify(value);
    const req = https.request(new URL(prefix + path, config.publicOrigin), { ca, method, headers: { Origin: config.publicOrigin.origin, Cookie: upstream.cookie, 'Content-Type': value instanceof Buffer ? 'application/octet-stream' : 'application/json', 'X-WebUI-Request': 'workspace-write', ...(raw === undefined ? {} : { 'Content-Length': String(Buffer.byteLength(raw)) }), ...headers } }, res => {
      let text = ''; res.on('data', chunk => { text += String(chunk); });
      res.on('end', () => { let data: unknown; try { data = JSON.parse(text); } catch { data = text; } resolve({ status: res.statusCode!, data: data as Result, text }); });
    }); req.once('error', reject); req.end(raw);
  });
  t.after(async () => { await app.close(); await upstream.close(); await rm(base, { recursive: true, force: true }); });
  return { request, root, logs, upstream };
}
for (const local of [false, true]) test(`opt-in TLS writes, conflicts, folder operations and streamed upload (${local ? 'local' : 'dashboard'})`, async t => {
  const f = await setup(t, local);
  assert.equal((await f.request('workspaces')).data.roots![0]!.writable, true);
  const first = (await f.request('files/read?root=workspace&path=file.txt')).data;
  assert.match(first.version!, /^[a-f0-9]{64}$/);
  const save = { root: 'workspace', path: 'file.txt', text: 'saved\r\n', expectedVersion: first.version };
  assert.equal((await f.request('files/write', 'PUT', save)).status, 200);
  assert.equal((await f.request('files/write', 'PUT', save)).status, 409);
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'saved\r\n');
  assert.equal((await f.request('files/mkdir', 'POST', { root: 'workspace', path: 'folder', confirm: true })).status, 200);
  const uploaded = await f.request('files/upload?root=workspace&path=folder%2Fimage.bin', 'POST', Buffer.from([0, 255, 12]));
  assert.equal(uploaded.status, 200); assert.equal(uploaded.data.size, 3);
  assert.equal((await f.request('files/upload?root=workspace&path=folder%2Fimage.bin', 'POST', Buffer.from('overwrite'))).status, 409);
  const rename = await f.request('files/rename', 'POST', { root: 'workspace', path: 'folder/image.bin', target: 'folder/renamed.bin', expectedVersion: uploaded.data.version, confirm: true });
  assert.equal(rename.status, 200);
  const dir = (await f.request('files/info?root=workspace&path=folder')).data;
  const blocked = await f.request('files/delete', 'DELETE', { root: 'workspace', path: 'folder', expectedVersion: dir.version, confirm: true });
  assert.equal(blocked.data.error?.code, 'WORKSPACE_DIRECTORY_NOT_EMPTY', JSON.stringify(blocked));
  assert.equal((await f.request('files/delete', 'DELETE', { root: 'workspace', path: 'folder/renamed.bin', expectedVersion: rename.data.version, confirm: true })).status, 200);
  const latest = (await f.request('files/info?root=workspace&path=folder')).data;
  assert.equal((await f.request('files/delete', 'DELETE', { root: 'workspace', path: 'folder', expectedVersion: latest.version, confirm: true })).status, 200);
  assert.ok(!JSON.stringify(f.logs).includes('saved\\r')); // audit outcome may say saved, but never contents with CRLF
});
test('write routes reject missing admission, CSRF/simple forms, stale versions, unsafe destinations and unconfirmed operations', async t => {
  const f = await setup(t), version = (await f.request('files/read?root=workspace&path=file.txt')).data.version;
  const data = { root: 'workspace', path: 'file.txt', text: 'PRIVATE_NEW_CONTENT', expectedVersion: version };
  assert.equal((await f.request('files/write', 'PUT', data, { Cookie: '' })).status, 401);
  for (const headers of [{ Origin: 'https://evil.invalid' }, { 'X-WebUI-Request': '' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Content-Type': 'text/plain' }] as Record<string, string>[]) assert.ok((await f.request('files/write', 'PUT', data, headers)).status >= 400);
  assert.equal((await f.request('files/write', 'PUT', { ...data, expectedVersion: '*' })).status, 428);
  assert.equal((await f.request('files/write', 'PUT', { ...data, force: true })).status, 400);
  assert.equal((await f.request('files/mkdir', 'POST', { root: 'workspace', path: 'folder', confirm: false })).status, 428);
  assert.equal((await f.request('files/upload?root=workspace&path=..%2Fescape', 'POST', Buffer.from('no'))).status, 400);
  assert.equal((await f.request('files/upload?root=workspace&path=new', 'POST', Buffer.alloc(10_485_761))).status, 413);
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'original\r\n');
  await fetch(f.upstream.origin + '/auth/logout', { method: 'POST', headers: { Cookie: f.upstream.cookie }, redirect: 'manual' });
  assert.equal((await f.request('files/write', 'PUT', data)).status, 401);
  assert.ok(!JSON.stringify(f.logs).includes('PRIVATE_NEW_CONTENT')); assert.ok(!JSON.stringify(f.logs).includes('file.txt'));
});
test('default mounts do not become writable through a browser request', async t => {
  const f = await setup(t, false, false);
  assert.equal((await f.request('workspaces')).data.roots![0]!.writable, false);
  assert.equal((await f.request('files/write', 'PUT', { force: true })).status, 403);
  assert.equal((await f.request('files/read?root=workspace&path=file.txt')).data.version, undefined);
});
