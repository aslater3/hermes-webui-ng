import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceApi } from '../../client/workspace/api.js';
import { WorkspaceMutations } from '../../client/workspace/mutations.js';
const initial = { path: 'file.txt', kind: 'text' as const, text: 'original\r\n', size: 10, version: 'a'.repeat(64) };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function setup(send: typeof fetch, read: typeof fetch = async () => response(initial)) {
  const actions = new WorkspaceMutations(new WorkspaceApi(read), send);
  actions.edit('workspace', initial); return actions;
}
test('workspace edit is memory-only, explicit and blocks updates only when dirty or unresolved', async () => {
  let count = 0;
  const actions = setup(async () => { count++; return response({ path: 'file.txt', outcome: 'saved', version: 'b'.repeat(64), size: 4 }); });
  assert.equal(actions.blocker(), ''); await actions.perform(); assert.equal(count, 0);
  actions.change('edit'); assert.ok(actions.blocker()); await actions.perform();
  assert.equal(count, 1); assert.equal(actions.state.phase, 'done'); assert.equal(actions.blocker(), '');
  actions.clear(); assert.equal(actions.state.text, '');
});
test('a lost or malformed write reply is unknown and cannot be replayed by a second click', async () => {
  for (const malformed of [false, true]) {
    let writes = 0, reads = 0;
    const actions = setup(async () => { writes++; if (!malformed) throw new Error('Lost ack'); return response({ ok: true }); }, async () => { reads++; return response({ ...initial, text: 'edit', version: 'b'.repeat(64) }); });
    actions.change('edit'); await actions.perform(); assert.equal(actions.state.phase, 'unknown'); assert.ok(actions.blocker());
    await actions.perform(); assert.equal(writes, 1);
    await actions.reconcile(); assert.equal(actions.state.phase, 'done'); assert.equal(writes, 1); assert.equal(reads, 1);
  }
});
test('conflict requires deliberate current-version adoption and preserves the draft for review', async () => {
  const sent: Record<string, unknown>[] = [];
  const actions = setup(async (_input, init) => { sent.push(JSON.parse(String(init?.body))); return sent.length === 1 ? response({ error: { code: 'WORKSPACE_VERSION_CONFLICT' } }, 409) : response({ path: 'file.txt', outcome: 'saved', version: 'c'.repeat(64) }); }, async () => response({ ...initial, text: 'someone else', version: 'b'.repeat(64) }));
  actions.change('my edit'); await actions.perform(); assert.equal(actions.state.phase, 'conflict');
  await actions.perform(); assert.equal(sent.length, 1);
  await actions.reconcile(); assert.equal(actions.state.text, 'my edit'); assert.equal(actions.state.remote?.text, 'someone else');
  actions.useCurrentBase(); assert.equal(actions.state.phase, 'ready'); await actions.perform();
  assert.equal(sent[1]?.expectedVersion, 'b'.repeat(64)); assert.equal(sent[1]?.text, 'my edit');
});
test('account clear and offline cancellation invalidate late write acknowledgements', async () => {
  for (const clear of [true, false]) {
    let release!: (value: Response) => void;
    const actions = setup(async () => new Promise(resolve => { release = resolve; }));
    actions.change('edit'); const request = actions.perform(); assert.equal(actions.state.phase, 'sending');
    if (clear) actions.clear(); else actions.pause();
    release(response({ path: 'file.txt', outcome: 'saved', version: 'b'.repeat(64) })); await request;
    assert.equal(actions.state.phase, clear ? 'closed' : 'unknown'); assert.equal(actions.state.text, clear ? '' : 'edit');
  }
});
test('folder and delete selection never writes without the explicit confirmation action', async () => {
  const calls: RequestInit[] = [];
  const actions = new WorkspaceMutations(new WorkspaceApi(async () => response({ path: 'folder', kind: 'directory', size: 0, version: 'a'.repeat(64) })), async (_input, init) => { calls.push(init!); return response({ path: 'folder', outcome: 'deleted' }); });
  await actions.open('delete', 'workspace', 'folder'); assert.equal(calls.length, 0);
  await actions.perform(); assert.equal(calls.length, 1); assert.equal(calls[0]?.method, 'DELETE');
  assert.equal(JSON.parse(String(calls[0]?.body)).confirm, true);
});
test('mixed line endings and oversized UTF-8 drafts are not silently normalised or sent', async () => {
  let writes = 0; const actions = setup(async () => { writes++; return response({}); });
  for (const text of ['one\r\ntwo\n', 'one\rtwo\r']) {
    actions.clear(); actions.edit('workspace', { ...initial, text }); assert.equal(actions.state.phase, 'done');
  }
  actions.clear(); actions.edit('workspace', initial); actions.change('é'.repeat(131073)); await actions.perform(); assert.equal(writes, 0); assert.match(actions.state.note, /256 KiB/);
});

test('interrupted or failed readback never unlocks another uncertain write', async () => {
  let reads = 0, writes = 0, release!: (response: Response) => void;
  const api = new WorkspaceApi(async () => {
    reads++;
    if (reads === 1) return response({ path: 'folder', kind: 'directory', size: 0, version: 'a'.repeat(64) });
    if (reads === 2) throw new Error('Readback unavailable');
    return new Promise(resolve => { release = resolve; });
  });
  const actions = new WorkspaceMutations(api, async () => { writes++; throw new Error('Lost acknowledgement'); });
  await actions.open('delete', 'workspace', 'folder'); await actions.perform();
  assert.equal(actions.state.phase, 'unknown'); await actions.reconcile();
  assert.equal(actions.state.phase, 'unknown'); await actions.perform(); assert.equal(writes, 1);
  const reading = actions.reconcile(); actions.pause();
  assert.equal(actions.state.phase, 'unknown');
  release(response({ path: 'folder', kind: 'directory', size: 0, version: 'a'.repeat(64) })); await reading;
  assert.equal(actions.state.phase, 'unknown'); await actions.perform(); assert.equal(writes, 1);
});
