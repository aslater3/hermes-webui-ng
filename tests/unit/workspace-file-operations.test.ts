import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceRoots } from '../../server/workspace/files.js';
import { entryInfo, WorkspaceFiles } from '../../server/workspace/file-operations.js';
const chunks = async function* (text: string | Buffer) { yield Buffer.from(text); };
async function fixture(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'file-operations-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const root = workspaceRoots(path)[0]!, operations = new WorkspaceFiles({ enabled: true, roots: [root.id] });
  const clean = async () => assert.ok(!(await readdir(path)).some(name => name.startsWith('.webui-tmp-')));
  return { root, operations, clean };
}
test('confirmed new-path primitives create complete private files and folders without replacing a destination', async t => {
  const { root, operations, clean } = await fixture(t);
  const folder = await operations.directory(root, 'folder'); assert.equal(folder.kind, 'directory');
  assert.equal((await stat(join(root.path, 'folder'))).mode & 0o777, 0o700);
  const file = await operations.create(root, 'folder/new.bin', chunks(Buffer.from([0, 255, 1])), 3);
  assert.equal(file.size, 3); assert.equal((await stat(join(root.path, file.path))).mode & 0o777, 0o600);
  await assert.rejects(operations.create(root, file.path, chunks('overwrite'), 10), { code: 'WORKSPACE_DESTINATION_EXISTS' });
  await assert.rejects(operations.directory(root, 'folder'), { code: 'WORKSPACE_DESTINATION_EXISTS' });
  assert.deepEqual(await readFile(join(root.path, file.path)), Buffer.from([0, 255, 1])); await clean();
});
test('rename is version-bound and no-clobber for both files and directories', async t => {
  const { root, operations, clean } = await fixture(t);
  await operations.create(root, 'source.txt', chunks('source'), 10);
  await operations.create(root, 'target.txt', chunks('target'), 10);
  const source = await entryInfo(root, 'source.txt');
  await assert.rejects(operations.rename(root, source.path, 'target.txt', source.version), { code: 'WORKSPACE_DESTINATION_EXISTS' });
  assert.equal(await readFile(join(root.path, 'target.txt'), 'utf8'), 'target');
  await operations.rename(root, source.path, 'renamed.txt', source.version);
  assert.equal(await readFile(join(root.path, 'renamed.txt'), 'utf8'), 'source');
  const directory = await operations.directory(root, 'old'); await operations.directory(root, 'other');
  await assert.rejects(operations.rename(root, 'old', 'other', directory.version), { code: 'WORKSPACE_DESTINATION_EXISTS' });
  await operations.rename(root, 'old', 'new', directory.version); await clean();
});
test('delete removes one exact-version file or empty directory and never recursively deletes', async t => {
  const { root, operations, clean } = await fixture(t);
  const file = await operations.create(root, 'file', chunks('first'), 10);
  await writeFile(join(root.path, 'file'), 'newer');
  await assert.rejects(operations.remove(root, 'file', file.version), { code: 'WORKSPACE_VERSION_CONFLICT' });
  await operations.remove(root, 'file', (await entryInfo(root, 'file')).version);
  await assert.rejects(readFile(join(root.path, 'file')), { code: 'ENOENT' });
  await operations.directory(root, 'folder'); await writeFile(join(root.path, 'folder/keep'), 'keep');
  await assert.rejects(operations.remove(root, 'folder', (await entryInfo(root, 'folder')).version), { code: 'WORKSPACE_DIRECTORY_NOT_EMPTY' });
  assert.equal(await readFile(join(root.path, 'folder/keep'), 'utf8'), 'keep'); await clean();
});
test('oversized, interrupted and revoked uploads publish nothing and clean their temporary file', async t => {
  const { root, operations, clean } = await fixture(t);
  await assert.rejects(operations.create(root, 'too-large', chunks('1234'), 3), { code: 'WORKSPACE_UPLOAD_TOO_LARGE' });
  const interrupted = async function* () { yield Buffer.from('partial'); throw new Error('transport'); };
  await assert.rejects(operations.create(root, 'partial', interrupted(), 100));
  await assert.rejects(operations.create(root, 'revoked', chunks('private'), 100, { beforeCommit: async () => { throw new Error('revoked'); } }));
  assert.deepEqual(await readdir(root.path), []); await clean();
});
test('traversal, root operations, secret paths, symlinks and missing write opt-in are refused', async t => {
  const { root, operations } = await fixture(t);
  await mkdir(join(root.path, 'real')); await symlink('real', join(root.path, 'link'));
  for (const path of ['', '..', '../outside', '/tmp/outside', '.env', '.git/config', 'link/new', '.webui-tmp-owned', 'a'.repeat(256)])
    await assert.rejects(operations.create(root, path, chunks('no'), 10));
  await assert.rejects(new WorkspaceFiles().directory(root, 'denied'), { code: 'WORKSPACE_READ_ONLY' });
  assert.deepEqual(await readdir(join(root.path, 'real')), []);
});
test('changes introduced during admission recheck conflict rather than renaming/deleting newer content', async t => {
  const { root, operations } = await fixture(t);
  const file = await operations.create(root, 'file', chunks('old'), 20);
  await assert.rejects(operations.rename(root, 'file', 'renamed', file.version, { beforeCommit: () => writeFile(join(root.path, 'file'), 'new') }), { code: 'WORKSPACE_VERSION_CONFLICT' });
  assert.equal(await readFile(join(root.path, 'file'), 'utf8'), 'new');
});
