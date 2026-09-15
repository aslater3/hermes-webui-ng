import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, open, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { nativeBoundary, plainMetadata, lockedRoot } from '../../server/workspace/native-boundary.js';
import { workspaceRoots, openWorkspacePath } from '../../server/workspace/files.js';
import { WorkspaceWriter } from '../../server/workspace/atomic-save.js';
import { fileSnapshot } from '../../server/workspace/file-version.js';

test('metadata guard rejects real file xattrs and inherited directory ACLs before a save', async t => {
  const path = await mkdtemp(join(tmpdir(), 'webui-metadata-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const root = workspaceRoots(path)[0]!; await writeFile(join(path, 'file.txt'), 'unchanged');
  const fd = await openWorkspacePath(root, 'file.txt');
  const version = (await fileSnapshot(fd, root)).version; await fd.close();
  execFileSync('python3', ['-c', 'import os,sys; os.setxattr(sys.argv[1], "user.webui-test", b"PRIVATE_XATTR")', join(path, 'file.txt')]);
  const writer = new WorkspaceWriter(); t.after(() => writer.close());
  await assert.rejects(writer.save(root, { enabled: true, roots: [root.id] }, { root: root.id, path: 'file.txt', text: 'replacement', expectedVersion: version }), { code: 'WORKSPACE_EXTENDED_METADATA_UNSUPPORTED' });
  assert.equal(await readFile(join(path, 'file.txt'), 'utf8'), 'unchanged');
  execFileSync('python3', ['-c', 'import os,sys,struct; entries=[(1,7,0xffffffff),(2,4,4242),(4,0,0xffffffff),(16,4,0xffffffff),(32,0,0xffffffff)]; os.setxattr(sys.argv[1], "system.posix_acl_default", struct.pack("<I",2)+b"".join(struct.pack("<HHI",*e) for e in entries))', path]);
  const dir = await open(path, 'r');
  try { await assert.rejects(plainMetadata(dir, true), { code: 'WORKSPACE_EXTENDED_METADATA_UNSUPPORTED' }); }
  finally { await dir.close(); }
});

test('a kernel root lock excludes another WebUI writer and is released after failure', async t => {
  const path = await mkdtemp(join(tmpdir(), 'webui-lock-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const root = workspaceRoots(path)[0]!;
  await assert.rejects(lockedRoot(root, async () => {
    await assert.rejects(lockedRoot(root, async () => undefined), { code: 'WORKSPACE_BUSY' });
    throw new Error('Deliberate failure');
  }), /Deliberate/);
  assert.equal(await lockedRoot(root, async () => 'released'), 'released');
  await chmod(path, 0o777);
  await assert.rejects(lockedRoot(root, async () => undefined), { code: 'WORKSPACE_WRITE_FORBIDDEN' });
});

test('kernel no-replace rename protects existing files and directories and accepts no path components', async t => {
  const path = await mkdtemp(join(tmpdir(), 'webui-noreplace-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  await writeFile(join(path, 'source'), 'source'); await writeFile(join(path, 'target'), 'target');
  await mkdir(join(path, 'directory')); await mkdir(join(path, 'occupied'));
  const dir = await open(path, 'r'); t.after(() => dir.close());
  const native = nativeBoundary();
  assert.throws(() => native.renameNoReplace(dir.fd, 'source', dir.fd, 'target'), { code: 'EEXIST' });
  assert.equal(await readFile(join(path, 'target'), 'utf8'), 'target');
  assert.throws(() => native.renameNoReplace(dir.fd, 'directory', dir.fd, 'occupied'), { code: 'EEXIST' });
  for (const name of ['', '.', '..', '../target', '/target', 'x\0y', 'a'.repeat(256)])
    assert.throws(() => native.renameNoReplace(dir.fd, 'source', dir.fd, name), { code: 'EINVAL' });
  native.renameNoReplace(dir.fd, 'source', dir.fd, 'renamed');
  assert.equal(await readFile(join(path, 'renamed'), 'utf8'), 'source');
  native.renameNoReplace(dir.fd, 'directory', dir.fd, 'moved-directory');
  assert.throws(() => native.emptyMetadata(-1), { code: 'EINVAL' });
  assert.throws(() => native.tryLock(Number.NaN), { code: 'EINVAL' });
});
