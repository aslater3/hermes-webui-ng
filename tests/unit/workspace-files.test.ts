import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, link, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workspaceRoots, relativeParts, preview, tree, FILE_LIMITS, WorkspaceError } from '../../server/workspace/files.js';

async function fixture(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'ng-workspace-'));
  await mkdir(join(base, 'project')); await mkdir(join(base, 'outside'));
  const root = workspaceRoots(join(base, 'project'))[0]!;
  await writeFile(join(base, 'outside', 'private.txt'), 'OUTSIDE_CANARY');
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, root };
}
test('workspace configuration is opt-in, rejects unsafe or duplicate roots and hides host paths', async t => {
  const { root } = await fixture(t);
  assert.deepEqual(workspaceRoots(undefined), []);
  assert.equal(root.id, 'workspace');
  for (const path of ['/', '/etc', '/proc', '/home', 'relative', `${root.path},${root.path}`]) assert.throws(() => workspaceRoots(path));
});
test('relative paths reject traversal, mixed separators, double encoding and known secret files', () => {
  for (const path of ['..', 'src/../a', '/etc/passwd', 'src\\..\\file', '%2e%2e/file', 'a\0b', 'a\nb', 'a//b', '.git/config', '.hermes/state.db', '.env', '.env.local', 'server.key', 'state.db-wal'])
    assert.throws(() => relativeParts(path), WorkspaceError);
  assert.deepEqual(relativeParts('src/network config.yaml'), ['src', 'network config.yaml']);
});
test('tree and text reads work without executing active HTML or SVG', async t => {
  const { root } = await fixture(t);
  await mkdir(join(root.path, 'src')); await writeFile(join(root.path, 'hostile.svg'), '<svg onload="alert(1)"/>');
  await writeFile(join(root.path, '.env'), 'SECRET_CANARY');
  const listing = await tree(root, '');
  assert.deepEqual(listing.entries.map(entry => entry.name), ['src', 'hostile.svg']);
  assert.equal((await preview(root, 'hostile.svg')).text, '<svg onload="alert(1)"/>');
});
test('symlink, ancestor-symlink, hardlink and FIFO reads are rejected', async t => {
  const { root, base } = await fixture(t);
  await symlink(join(base, 'outside'), join(root.path, 'escape'));
  await symlink(join(base, 'outside', 'private.txt'), join(root.path, 'link.txt'));
  await writeFile(join(root.path, 'normal.txt'), 'safe');
  await symlink('normal.txt', join(root.path, 'internal.txt'));
  await link(join(base, 'outside', 'private.txt'), join(root.path, 'hard.txt'));
  execFileSync('mkfifo', [join(root.path, 'pipe')]);
  for (const path of ['escape/private.txt', 'link.txt', 'internal.txt', 'hard.txt', 'pipe']) await assert.rejects(preview(root, path), WorkspaceError);
  assert.equal((await tree(root, '')).entries.find(entry => entry.name === 'escape')?.type, 'blocked');
});
test('a replaced root fails closed instead of following a new directory at the same path', async t => {
  const { root, base } = await fixture(t);
  await writeFile(join(root.path, 'safe.txt'), 'safe');
  await rename(root.path, join(base, 'old-project'));
  await mkdir(root.path); await writeFile(join(root.path, 'safe.txt'), 'REPLACEMENT');
  await assert.rejects(preview(root, 'safe.txt'), { code: 'WORKSPACE_ROOT_CHANGED' });
});
test('swapping an ancestor between directory and escape symlink never reads outside', async t => {
  const { root, base } = await fixture(t);
  const dir = join(root.path, 'changing'), parked = join(root.path, 'parked');
  await mkdir(dir); await writeFile(join(dir, 'private.txt'), 'INSIDE');
  let stop = false;
  const swaps = (async () => {
    while (!stop) {
      await rename(dir, parked); await symlink(join(base, 'outside'), dir);
      await new Promise(resolve => setImmediate(resolve));
      await rm(dir); await rename(parked, dir);
    }
  })();
  try {
    for (let i = 0; i < 80; i++) {
      try { assert.equal((await preview(root, 'changing/private.txt')).text, 'INSIDE'); }
      catch (error) { assert.ok(error instanceof WorkspaceError); }
    }
  } finally { stop = true; await swaps; }
});
test('preview is bounded, binary is not decoded, directory scan and page size are bounded', async t => {
  const { root } = await fixture(t);
  await writeFile(join(root.path, 'large.txt'), Buffer.alloc(FILE_LIMITS.previewBytes + 1, 65));
  await writeFile(join(root.path, 'binary.bin'), Buffer.from([0, 255, 1]));
  await writeFile(join(root.path, 'invalid.txt'), Buffer.from([0xff]));
  assert.equal((await preview(root, 'large.txt')).kind, 'too-large');
  assert.equal((await preview(root, 'binary.bin')).kind, 'binary');
  assert.equal((await preview(root, 'invalid.txt')).kind, 'binary');
  await mkdir(join(root.path, 'many'));
  await Promise.all(Array.from({ length: 1003 }, (_, i) => writeFile(join(root.path, 'many', `file-${i}`), '')));
  const listing = await tree(root, 'many');
  assert.equal(listing.entries.length, 200); assert.equal(listing.truncated, true); assert.equal(listing.nextOffset, 200);
  await assert.rejects(tree(root, 'many', 99999));
});
