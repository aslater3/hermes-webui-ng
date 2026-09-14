import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat, chmod, symlink, link, rename, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { WorkspaceWriter } from '../../server/workspace/atomic-save.js';
import { fileSnapshot, fileVersion } from '../../server/workspace/file-version.js';
import { workspaceRoots, openWorkspacePath, tree } from '../../server/workspace/files.js';
async function fixture(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'workspace-save-'));
  await mkdir(join(base, 'project')); await mkdir(join(base, 'outside'));
  const root = workspaceRoots(join(base, 'project'))[0]!;
  await writeFile(join(root.path, 'file.txt'), 'original\r\n', { mode: 0o640 });
  await writeFile(join(base, 'outside', 'secret.txt'), 'OUTSIDE_CANARY');
  const writer = new WorkspaceWriter(), policy = { enabled: true, roots: ['workspace'] };
  const snapshot = async (path = 'file.txt') => { const fd = await openWorkspacePath(root, path); try { return await fileSnapshot(fd, root); } finally { await fd.close(); } };
  const data = { root: 'workspace', path: 'file.txt', text: 'replacement\r\n', expectedVersion: (await snapshot()).version };
  const noTemp = async () => assert.deepEqual((await readdir(root.path)).filter(s => s.startsWith('.webui-tmp-')), []);
  t.after(async () => { await writer.close(); await rm(base, { recursive: true, force: true }); });
  return { root, base, writer, policy, data, snapshot, noTemp };
}
test('atomic save replaces complete text, preserves permissions, reports a new version and leaves old open descriptors intact', async t => {
  const f = await fixture(t), old = await open(join(f.root.path, 'file.txt'), 'r'); t.after(() => old.close());
  const result = await f.writer.save(f.root, f.policy, f.data);
  assert.equal(result.outcome, 'saved'); assert.notEqual(result.version, f.data.expectedVersion);
  assert.equal(await readFile(join(f.root.path, 'file.txt'), 'utf8'), f.data.text);
  assert.equal(await old.readFile('utf8'), 'original\r\n');
  assert.equal((await stat(join(f.root.path, 'file.txt'))).mode & 0o777, 0o640);
  assert.equal(result.version, (await f.snapshot()).version); await f.noTemp();
});
test('identical saves do not replace the file or change its revision', async t => {
  const f = await fixture(t), initial = await f.snapshot();
  const result = await f.writer.save(f.root, f.policy, { ...f.data, text: initial.text });
  assert.equal(result.outcome, 'unchanged'); assert.equal(result.version, initial.version);
  assert.equal((await stat(join(f.root.path, 'file.txt'))).ino, initial.stat.ino); await f.noTemp();
});
test('same-size external changes and replacement inodes invalidate the expected version', async t => {
  const f = await fixture(t), before = await f.snapshot();
  const other = Buffer.from('changed!\r\n'); assert.equal(other.length, before.content.length);
  assert.notEqual(fileVersion(before.stat, before.content), fileVersion(before.stat, other));
  await writeFile(join(f.root.path, 'file.txt'), other);
  await assert.rejects(f.writer.save(f.root, f.policy, f.data), { code: 'WORKSPACE_VERSION_CONFLICT' });
  assert.deepEqual(await readFile(join(f.root.path, 'file.txt')), other); await f.noTemp();
  await rm(join(f.root.path, 'file.txt')); await writeFile(join(f.root.path, 'file.txt'), before.content);
  await assert.rejects(f.writer.save(f.root, f.policy, f.data), { code: 'WORKSPACE_VERSION_CONFLICT' });
});
test('concurrent API saves with the same revision serialize: one succeeds, the stale save conflicts', async t => {
  const f = await fixture(t);
  const values = await Promise.allSettled([
    f.writer.save(f.root, f.policy, f.data),
    f.writer.save(f.root, f.policy, { ...f.data, text: 'second draft' }),
  ]);
  assert.equal(values[0]!.status, 'fulfilled'); assert.equal(values[1]!.status, 'rejected');
  if (values[1]!.status === 'rejected') assert.equal(values[1]!.reason.code, 'WORKSPACE_VERSION_CONFLICT');
  assert.equal(await readFile(join(f.root.path, 'file.txt'), 'utf8'), f.data.text); await f.noTemp();
});
test('an external change during staging aborts the save without damaging the newer file', async t => {
  const f = await fixture(t);
  await assert.rejects(f.writer.save(f.root, f.policy, f.data, { beforeCommit: async () => {
    await writeFile(join(f.root.path, 'file.txt'), 'newer external edit');
  } }), { code: 'WORKSPACE_VERSION_CONFLICT' });
  assert.equal(await readFile(join(f.root.path, 'file.txt'), 'utf8'), 'newer external edit'); await f.noTemp();
});
test('cancellation, revoked admission and precommit I/O failure leave the original and clean their temp file', async t => {
  const f = await fixture(t);
  for (const failure of ['cancel', 'auth', 'disk']) {
    const controller = new AbortController();
    await assert.rejects(f.writer.save(f.root, f.policy, f.data, { signal: controller.signal, beforeCommit: async () => {
      if (failure === 'cancel') controller.abort();
      else throw Object.assign(new Error('PRIVATE_ERROR'), { code: failure === 'disk' ? 'ENOSPC' : 'EACCES' });
    } }));
    assert.equal(await readFile(join(f.root.path, 'file.txt'), 'utf8'), 'original\r\n'); await f.noTemp();
  }
});
test('read-only/default roots, unsafe paths, binary content and oversized saves cannot mutate files', async t => {
  const f = await fixture(t);
  await assert.rejects(f.writer.save(f.root, undefined, f.data), { code: 'WORKSPACE_READ_ONLY' });
  await assert.rejects(f.writer.save(f.root, { enabled: true, roots: ['workspace-2'] }, f.data), { code: 'WORKSPACE_READ_ONLY' });
  for (const path of ['../outside/secret.txt', '/etc/passwd', '.env', '.git/config', 'a//b', '.webui-tmp-guess'])
    await assert.rejects(f.writer.save(f.root, f.policy, { ...f.data, path }));
  await assert.rejects(f.writer.save(f.root, f.policy, { ...f.data, text: 'é'.repeat(131073) }), { code: 'WORKSPACE_SAVE_TOO_LARGE' });
  await writeFile(join(f.root.path, 'binary.bin'), Buffer.from([0, 1, 255]));
  await assert.rejects(f.writer.save(f.root, f.policy, { ...f.data, path: 'binary.bin' }), { code: 'WORKSPACE_NOT_TEXT' });
  await chmod(join(f.root.path, 'file.txt'), 0o440);
  const updated = await f.snapshot();
  await assert.rejects(f.writer.save(f.root, f.policy, { ...f.data, expectedVersion: updated.version }), { code: 'WORKSPACE_WRITE_FORBIDDEN' });
  assert.equal(await readFile(join(f.base, 'outside/secret.txt'), 'utf8'), 'OUTSIDE_CANARY'); await f.noTemp();
});
test('symlink, hardlink, FIFO, ancestor swaps and replaced roots fail closed', async t => {
  const f = await fixture(t), outside = join(f.base, 'outside/secret.txt');
  await symlink(outside, join(f.root.path, 'link')); await link(outside, join(f.root.path, 'hard'));
  execFileSync('mkfifo', [join(f.root.path, 'pipe')]);
  for (const path of ['link', 'hard', 'pipe']) await assert.rejects(f.writer.save(f.root, f.policy, { ...f.data, path }));
  await mkdir(join(f.root.path, 'nested')); await writeFile(join(f.root.path, 'nested/file.txt'), 'nested');
  const nested = { ...f.data, path: 'nested/file.txt', expectedVersion: (await f.snapshot('nested/file.txt')).version };
  await assert.rejects(f.writer.save(f.root, f.policy, nested, { beforeCommit: async () => {
    await rename(join(f.root.path, 'nested'), join(f.root.path, 'parked'));
    await symlink(join(f.base, 'outside'), join(f.root.path, 'nested'));
  } }));
  assert.equal(await readFile(join(f.root.path, 'parked/file.txt'), 'utf8'), 'nested');
  assert.deepEqual(await readdir(join(f.root.path, 'parked')), ['file.txt']);
  assert.equal(await readFile(outside, 'utf8'), 'OUTSIDE_CANARY');
  await rename(f.root.path, join(f.base, 'old')); await mkdir(f.root.path);
  await assert.rejects(f.writer.save(f.root, f.policy, f.data), { code: 'WORKSPACE_ROOT_CHANGED' });
});
test('temporary siblings are never visible in file listings or accepted as project paths', async t => {
  const f = await fixture(t);
  await f.writer.save(f.root, f.policy, f.data, { beforeCommit: async () => {
    assert.ok((await readdir(f.root.path)).some(s => s.startsWith('.webui-tmp-')));
    assert.ok(!(await tree(f.root, '')).entries.some(s => s.name.startsWith('.webui-tmp-')));
  } }); await f.noTemp();
});
test('BOM, CRLF, non-ASCII text and empty files round-trip without backend normalization', async t => {
  const f = await fixture(t);
  for (const text of ['\ufeffname: café\r\n', '', '😀\n']) {
    const version = (await f.snapshot()).version;
    const result = await f.writer.save(f.root, f.policy, { ...f.data, text, expectedVersion: version });
    assert.equal((await f.snapshot()).text, text); assert.equal(result.size, Buffer.byteLength(text));
  }
});
