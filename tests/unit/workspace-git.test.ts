import git from 'isomorphic-git';
import { contentStatus } from '../../server/workspace/git-status.js';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceRoots } from '../../server/workspace/files.js';
import { gitFileSystem } from '../../server/workspace/git-fs.js';
import { WorkspaceGit } from '../../server/workspace/git.js';

async function fixture(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'workspace-git-'));
  const command = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', path, ...args], { env: { PATH: process.env.PATH, HOME: path }, stdio: 'pipe' }).toString().trim();
  command('init', '-b', 'main');
  await writeFile(join(path, 'example.txt'), 'one\ntwo\n');
  await writeFile(join(path, '.gitignore'), 'ignored.txt\n');
  await writeFile(join(path, '.env'), 'PRIVATE_HISTORY_CANARY');
  command('add', '.'); command('commit', '-m', 'fixture');
  const root = workspaceRoots(path)[0]!, service = new WorkspaceGit();
  t.after(async () => { await service.close(); await rm(path, { recursive: true, force: true }); });
  return { path, command, root, service };
}
test('read-only Git discovers standard repositories and reports staged/unstaged/untracked changes without touching the index', async t => {
  const { path, root, command, service } = await fixture(t);
  await writeFile(join(path, 'example.txt'), 'one\nstaged\n'); command('add', 'example.txt');
  await writeFile(join(path, 'example.txt'), 'one\nworking\n');
  await writeFile(join(path, 'new.txt'), 'new'); await writeFile(join(path, 'ignored.txt'), 'ignored');
  const index = await readFile(join(path, '.git/index'));
  const discovered = await service.read(root, '', 'repos') as { repos: { path: string; supported: boolean }[] };
  assert.deepEqual(discovered.repos, [{ path: '', supported: true }]);
  const status = await service.read(root, '', 'status') as { branch: string; files: { path: string; staged: boolean; unstaged: boolean }[] };
  assert.equal(status.branch, 'main');
  assert.equal(status.files.find(f => f.path === 'example.txt')?.staged, true);
  assert.equal(status.files.find(f => f.path === 'example.txt')?.unstaged, true);
  assert.ok(status.files.some(f => f.path === 'new.txt'));
  assert.ok(!JSON.stringify(status).includes('.env')); assert.ok(!JSON.stringify(status).includes('ignored.txt'));
  assert.deepEqual(await readFile(join(path, '.git/index')), index);
});
test('Git diff is limited to index versus worktree or HEAD versus index with fixed path scope', async t => {
  const { path, root, command, service } = await fixture(t);
  await writeFile(join(path, 'example.txt'), 'one\nstaged\n'); command('add', 'example.txt');
  await writeFile(join(path, 'example.txt'), 'one\nworking\n');
  const staged = await service.read(root, '', 'diff', 'example.txt', true) as { patch: string };
  assert.match(staged.patch, /-two\n\+staged/);
  const working = await service.read(root, '', 'diff', 'example.txt') as { patch: string };
  assert.match(working.patch, /-staged\n\+working/);
  for (const name of ['.env', '../private', '/etc/passwd', '.git/config']) await assert.rejects(service.read(root, '', 'diff', name));
  assert.ok(!JSON.stringify([staged, working]).includes('PRIVATE_HISTORY_CANARY'));
});
test('Git configuration, include paths, hooks and external diff commands are never executed or read', async t => {
  const { path, root, service } = await fixture(t);
  const canary = join(path, 'executed');
  await writeFile(join(path, '.git/config'), `[core]\n fsmonitor = touch ${canary}\n[include]\n path = /etc/passwd\n[diff]\n external = touch ${canary}\n`);
  await writeFile(join(path, 'example.txt'), 'safe change\n');
  const result = await service.read(root, '', 'status'); assert.ok(JSON.stringify(result).includes('example.txt'));
  await service.read(root, '', 'diff', 'example.txt');
  await assert.rejects(readFile(canary), { code: 'ENOENT' });
  const fs = gitFileSystem(root);
  await assert.rejects(fs.fs.promises.readFile('/etc/passwd'));
  await assert.rejects(fs.fs.promises.writeFile());
});
test('Git metadata symlinks and alternate gitdir files are not followed outside a workspace', async t => {
  const { path, root, service } = await fixture(t);
  await rename(join(path, '.git'), join(path, 'saved'));
  await symlink('saved', join(path, '.git'));
  await assert.rejects(service.read(root, '', 'status'));
  await rm(join(path, '.git')); await writeFile(join(path, '.git'), 'gitdir: /etc\n');
  await assert.rejects(service.read(root, '', 'status'));
  const result = await service.read(root, '', 'repos') as { repos: { supported: boolean }[] };
  assert.equal(result.repos[0]?.supported, false);
});
test('packed Git objects work and deleted/untracked text diffs remain read-only', async t => {
  const { path, root, command, service } = await fixture(t);
  command('gc', '--prune=now');
  await rm(join(path, 'example.txt'));
  const patch = await service.read(root, '', 'diff', 'example.txt') as { patch: string };
  assert.match(patch.patch, /-one/);
  await writeFile(join(path, 'new.txt'), 'new\n');
  const added = await service.read(root, '', 'diff', 'new.txt') as { patch: string };
  assert.match(added.patch, /\+new/);
});
test('Git rejects binary and oversized diffs without disclosing their bodies', async t => {
  const { path, root, service } = await fixture(t);
  await writeFile(join(path, 'binary.bin'), Buffer.from([0, 1, 255]));
  await assert.rejects(service.read(root, '', 'diff', 'binary.bin'), { code: 'GIT_BINARY_DIFF' });
  await writeFile(join(path, 'large.txt'), 'a'.repeat(262145));
  await assert.rejects(service.read(root, '', 'diff', 'large.txt'), { code: 'GIT_DIFF_TOO_LARGE' });
});
test('Git discovery is bounded and labels external-worktree gitdirs unsupported', async t => {
  const { path, root, service } = await fixture(t);
  await mkdir(join(path, 'nested')); await writeFile(join(path, 'nested/.git'), 'gitdir: /private');
  const result = await service.read(root, '', 'repos') as { repos: { path: string; supported: boolean }[] };
  assert.ok(result.repos.some(repo => repo.path === 'nested' && !repo.supported));
  await assert.rejects(service.read(root, '../', 'repos'));
});

test('equal-size edits with identical stat-cache metadata still compare real worktree contents', async t => {
  const { path, root, command } = await fixture(t);
  await writeFile(join(path, 'example.txt'), 'version A\n'); command('add', 'example.txt'); command('commit', '-m', 'same-size baseline');
  await writeFile(join(path, 'example.txt'), 'version B\n'); command('add', 'example.txt');
  const boundary = gitFileSystem(root);
  const cached = await boundary.fs.promises.lstat('/project/example.txt');
  const index = await readFile(join(path, '.git/index'));
  await writeFile(join(path, 'example.txt'), 'version C\n');
  // Model precisely the metadata match that the library treats as a cache hit.
  // Reads still go through the actual constrained descriptor filesystem.
  const fs = { promises: { ...boundary.fs.promises,
    lstat: async (input: string) => input === '/project/example.txt' ? cached : boundary.fs.promises.lstat(input),
  } };
  const options = { fs, dir: '/project', gitdir: '/project/.git' };
  const old = await git.statusMatrix({ ...options, refresh: false });
  assert.deepEqual(old.find(row => row[0] === 'example.txt'), ['example.txt', 1, 2, 2]);
  const current = await contentStatus(options);
  assert.deepEqual(current.find(row => row[0] === 'example.txt'), ['example.txt', 1, 2, 3]);
  boundary.check(); assert.deepEqual(await readFile(join(path, '.git/index')), index);
});
