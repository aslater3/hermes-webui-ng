/** Production-container file mutations over verified TLS and unmodified Hermes admission. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { WorkspaceApi } from '../../client/workspace/api.js';
import { browserAuth } from '../helpers/browser-auth.js';
const pin = 'b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a';
const origin = 'https://127.0.0.1:8790', mode = process.env.PHASE4_TLS_MODE;
assert.equal(process.env.HERMES_TEST_REF, pin);
assert.ok(['dashboard', 'trusted-local'].includes(mode ?? ''));
assert.ok(process.env.NODE_EXTRA_CA_CERTS); assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
const auth = browserAuth(origin), dashboard = new DashboardClient(origin, auth.fetcher);
const api = new WorkspaceApi((url, init) => auth.fetcher(origin + url, init));
const signal = () => AbortSignal.timeout(20_000);
const gates: string[] = []; let success = false;
const pass = (gate: string) => { gates.push(gate); console.log(`PASS phase6/${mode}/${gate}`); };
async function mutation(path: string, method: string, data: unknown, status = 200) {
  const response = await auth.fetcher(origin + '/__hermes/webui-local/files/' + path, {
    method, body: data instanceof Uint8Array ? Buffer.from(data) : JSON.stringify(data),
    headers: { 'Content-Type': data instanceof Uint8Array ? 'application/octet-stream' : 'application/json', 'X-WebUI-Request': 'workspace-write' },
    signal: signal(), redirect: 'error', cache: 'no-store',
  });
  assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json() as Promise<{ version: string; outcome: string }>;
}
try {
  if (mode === 'dashboard') {
    await mutation('mkdir', 'POST', { root: 'workspace', path: 'must-not-exist', confirm: true }, 401);
    await dashboard.status();
    const provider = (await dashboard.providers()).find(p => p.supports_password); assert.ok(provider);
    await dashboard.login(provider.name, process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME!, process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD!);
  } else { await dashboard.status(); await dashboard.verifyLocalAccess(); }
  const roots = await api.roots(signal()); assert.equal(roots.roots[0]?.writable, true);
  const initial = await api.preview('workspace', 'editable.txt', signal()); assert.ok(initial.version);
  const data = { root: 'workspace', path: 'editable.txt', text: 'Saved by an explicitly authorised workspace request.\r\n', expectedVersion: initial.version };
  const saved = await mutation('write', 'PUT', data); assert.equal(saved.outcome, 'saved');
  assert.equal((await api.preview('workspace', 'editable.txt', signal())).text, data.text);
  await mutation('write', 'PUT', data, 409);
  pass('native-authenticated-save-readback-and-stale-version-conflict');
  await mutation('mkdir', 'POST', { root: 'workspace', path: 'created', confirm: true });
  const upload = await mutation('upload?root=workspace&path=created%2Fsample.bin', 'POST', new Uint8Array([0, 255, 17]));
  await mutation('upload?root=workspace&path=created%2Fsample.bin', 'POST', new Uint8Array([1]), 409);
  const renamed = await mutation('rename', 'POST', { root: 'workspace', path: 'created/sample.bin', target: 'created/renamed.bin', expectedVersion: upload.version, confirm: true });
  const dir = await api.info('workspace', 'created', signal());
  await mutation('delete', 'DELETE', { root: 'workspace', path: 'created', expectedVersion: dir.version, confirm: true }, 409);
  await mutation('delete', 'DELETE', { root: 'workspace', path: 'created/renamed.bin', expectedVersion: renamed.version, confirm: true });
  const empty = await api.info('workspace', 'created', signal());
  await mutation('delete', 'DELETE', { root: 'workspace', path: 'created', expectedVersion: empty.version, confirm: true });
  pass('bounded-upload-no-clobber-rename-and-nonrecursive-delete');
  for (const path of ['.env', '.git/config', '../escape', 'blocked-link/new'])
    assert.ok((await auth.fetcher(origin + '/__hermes/webui-local/files/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WebUI-Request': 'workspace-write' }, body: JSON.stringify({ root: 'workspace', path, confirm: true }) })).status >= 400);
  const noGuard = await auth.fetcher(origin + '/__hermes/webui-local/files/write', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal(noGuard.status, 403); await noGuard.body?.cancel();
  pass('project-boundary-and-csrf-guard-enforced-in-runtime-image');
  if (mode === 'dashboard') {
    await dashboard.logout();
    await mutation('write', 'PUT', { ...data, expectedVersion: saved.version }, 401);
    pass('logout-revokes-write-authority');
  }
  success = true;
} finally {
  await mkdir('test-results/live', { recursive: true });
  await writeFile(`test-results/live/phase6-workspace-${mode}.json`, JSON.stringify({ success, gates, mode, upstream: pin,
    commit: process.env.GITHUB_SHA, certificateVerification: true,
    boundary: 'Real non-root production image, explicit rw disposable project, native Hermes auth; file operations only, no operator data or Git mutations.' }, null, 2));
}
