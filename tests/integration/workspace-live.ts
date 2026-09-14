/** Real production WebUI mount and native Hermes admission; no mocked auth or file APIs. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { WorkspaceApi, WorkspaceClientError } from '../../client/workspace/api.js';
import { browserAuth } from '../helpers/browser-auth.js';
const pin = 'b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a';
const origin = 'https://127.0.0.1:8790', mode = process.env.PHASE4_TLS_MODE;
assert.equal(process.env.HERMES_TEST_REF, pin);
assert.ok(['dashboard', 'trusted-local'].includes(mode ?? ''));
assert.ok(process.env.NODE_EXTRA_CA_CERTS); assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
const auth = browserAuth(origin), dashboard = new DashboardClient(origin, auth.fetcher);
const api = new WorkspaceApi((input, init) => auth.fetcher(origin + input, init));
const signal = () => AbortSignal.timeout(20_000);
const gates: string[] = []; let success = false;
const pass = (gate: string) => { gates.push(gate); console.log(`PASS phase5/${mode}/${gate}`); };
try {
  if (mode === 'dashboard') {
    await assert.rejects(api.roots(signal()), error => error instanceof WorkspaceClientError && error.status === 401);
    await dashboard.status();
    const provider = (await dashboard.providers()).find(row => row.supports_password); assert.ok(provider);
    await dashboard.login(provider.name, process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME!, process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD!);
  } else { await dashboard.status(); await dashboard.verifyLocalAccess(); }
  const inventory = await api.roots(signal()); assert.equal(inventory.git, true);
  assert.deepEqual(inventory.roots, [{ id: 'workspace', label: 'Workspace', writable: false }]);
  pass('native-admission-protects-dedicated-readonly-mount');
  const tree = await api.tree('workspace', '', 0, signal());
  assert.ok(tree.entries.some(entry => entry.name === 'example.ts')); assert.ok(!tree.entries.some(entry => entry.name === '.env' || entry.name === '.git'));
  const preview = await api.preview('workspace', 'example.ts', signal()); assert.equal(preview.text, 'export const value = 3;\n');
  const download = await auth.fetcher(origin + api.download('workspace', 'example.ts'));
  assert.equal(download.status, 200); assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.equal(download.headers.get('content-type'), 'application/octet-stream'); assert.match(download.headers.get('content-disposition')!, /^attachment;/);
  assert.equal(await download.text(), preview.text);
  pass('files-preview-and-attachment-download-over-verified-tls');
  const discovered = await api.repos('workspace', '', signal()); assert.ok(discovered.repos.some(repo => repo.path === '' && repo.supported));
  const status = await api.status('workspace', '', signal()); assert.equal(status.branch, 'main');
  assert.ok(status.files.some(file => file.path === 'example.ts' && file.staged && file.unstaged));
  const staged = await api.diff('workspace', '', 'example.ts', true, signal()); assert.match(staged.patch, /-export const value = 1;/); assert.match(staged.patch, /\+export const value = 2;/);
  const working = await api.diff('workspace', '', 'example.ts', false, signal()); assert.match(working.patch, /-export const value = 2;/); assert.match(working.patch, /\+export const value = 3;/);
  pass('production-git-reader-discovers-and-compares-staged-working-content');
  const prefix = origin + '/__hermes/webui-local/';
  for (const path of ['../private', '.env', '.git/config', 'blocked-link']) {
    const response = await auth.fetcher(prefix + 'files/read?' + new URLSearchParams({ root: 'workspace', path }));
    assert.ok([400, 403].includes(response.status)); await response.body?.cancel();
  }
  const mutation = await auth.fetcher(prefix + 'files/read?root=workspace&path=example.ts', { method: 'PUT', body: 'not allowed' });
  assert.equal(mutation.status, 405); await mutation.body?.cancel();
  assert.ok(!JSON.stringify([inventory, tree, status]).includes('PRIVATE_WORKSPACE_CANARY'));
  pass('traversal-metadata-secrets-links-and-write-requests-rejected');
  if (mode === 'dashboard') {
    await dashboard.logout();
    await assert.rejects(api.preview('workspace', 'example.ts', signal()), error => error instanceof WorkspaceClientError && error.status === 401);
    pass('logout-revokes-local-workspace-admission');
  }
  success = true;
} finally {
  await mkdir('test-results/live', { recursive: true });
  await writeFile(`test-results/live/phase5-workspace-${mode}.json`, JSON.stringify({ success, gates, mode, upstream: pin,
    commit: process.env.GITHUB_SHA, certificateVerification: true,
    boundary: 'Unmodified Hermes admission; real production non-root WebUI container with dedicated read-only project mount. No browser emulation or real-user files.' }, null, 2));
}
