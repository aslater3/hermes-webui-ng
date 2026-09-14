import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceApi, validPath } from '../../client/workspace/api.js';
import { WorkspaceStore } from '../../client/workspace/store.js';
const signal = () => new AbortController().signal;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
test('workspace client requests only the local cookie-scoped read API without caching', async () => {
  const api = new WorkspaceApi(async (input, init) => {
    assert.equal(input, '/__hermes/webui-local/workspaces'); assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
    return response({ roots: [{ id: 'workspace', label: 'Project', writable: false }], git: true });
  });
  assert.equal((await api.roots(signal())).roots[0]?.id, 'workspace');
  assert.match(api.download('workspace', 'hello world.html'), /path=hello\+world.html/);
});
test('workspace client rejects malformed, writable, oversized and cross-path responses', async () => {
  for (const data of [{ roots: [{ id: 'workspace', label: 'X', writable: true }], git: true }, { roots: [{ id: '/etc', label: 'X', writable: false }], git: true }])
    await assert.rejects(new WorkspaceApi(async () => response(data)).roots(signal()));
  for (const path of ['../x', '/root/x', 'x//y', 'x\\y', '%2e%2e', 'x\0']) assert.throws(() => validPath(path));
  await assert.rejects(new WorkspaceApi(async () => response({ path: 'other', kind: 'text', text: 'wrong', size: 5 })).preview('workspace', 'wanted', signal()));
  await assert.rejects(new WorkspaceApi(async () => response({ path: 'x', kind: 'text', text: 'a'.repeat(262145), size: 262145 })).preview('workspace', 'x', signal()));
});
test('old workspace reads cannot publish after a different file is selected or the pane is closed', async () => {
  let release!: (response: Response) => void;
  const store = new WorkspaceStore(new WorkspaceApi(async input => String(input).includes('path=first') ? new Promise(resolve => { release = resolve; }) : response({ path: 'second', kind: 'text', size: 3, text: 'new' })));
  store.state.root = 'workspace';
  const first = store.file('first'); await store.file('second');
  release(response({ path: 'first', kind: 'text', size: 3, text: 'old' })); await first;
  assert.equal(store.state.preview?.text, 'new');
  const next = store.file('first'); store.dispose(); release(response({ path: 'first', kind: 'text', size: 6, text: 'closed' })); await next;
  assert.equal(store.state.preview, undefined);
});
test('expired workspace admission clears displayed data and asks the native connection to revalidate', async () => {
  let expired = 0;
  const store = new WorkspaceStore(new WorkspaceApi(async () => response({ error: { code: 'WORKSPACE_AUTH_REQUIRED' } }, 401)), () => expired++);
  store.state.root = 'workspace'; store.state.preview = { path: 'x', kind: 'text', text: 'private', size: 7 };
  await store.file('x'); assert.equal(expired, 1); assert.equal(store.state.preview, undefined); assert.match(store.state.error, /Sign in/);
});

test('an unreadable initial root does not hide other admitted roots', async () => {
  const api = new WorkspaceApi(async input => String(input).endsWith('/workspaces')
    ? response({ roots: [{ id: 'workspace', label: 'First', writable: false }, { id: 'workspace-2', label: 'Second', writable: false }], git: false })
    : String(input).includes('root=workspace-2')
      ? response({ path: '', entries: [], offset: 0, nextOffset: null, truncated: false })
      : response({ error: { code: 'WORKSPACE_PATH_UNAVAILABLE' } }, 403));
  const store = new WorkspaceStore(api); await store.load();
  assert.equal(store.state.roots.length, 2); assert.ok(store.state.error);
  await store.selectRoot('workspace-2'); assert.equal(store.state.error, ''); assert.equal(store.state.root, 'workspace-2');
  store.dispose();
});

test('a delayed root response cannot start file reads after view disposal', async () => {
  let release!: (response: Response) => void; let reads = 0;
  const store = new WorkspaceStore(new WorkspaceApi(async () => { reads++; return new Promise(resolve => { release = resolve; }); }));
  const loading = store.load(); store.dispose();
  release(response({ roots: [{ id: 'workspace', label: 'Project', writable: false }], git: true }));
  await loading; await store.load(); assert.equal(reads, 1); assert.deepEqual(store.state.roots, []);
});
