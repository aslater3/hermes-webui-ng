import { contentStatus } from './git-status.js';
import { parentPort, workerData } from 'node:worker_threads';
import { join } from 'node:path';
import { opendir } from 'node:fs/promises';
import git from 'isomorphic-git';
import { createTwoFilesPatch } from 'diff';
import { allowedName, relativeParts } from './files.js';
import { contained, openChecked, WorkspaceError, type WorkspaceRoot } from './safe-open.js';
import { gitFileSystem, GIT_LIMITS } from './git-fs.js';

export interface GitRequest { root: WorkspaceRoot; repo: string; action: 'repos' | 'status' | 'diff'; path?: string; staged?: boolean }
async function repoRoot(root: WorkspaceRoot, path: string) {
  const parts = relativeParts(path), handle = await openChecked(root, parts, true);
  try {
    const stat = await handle.stat();
    return { ...root, path: join(root.path, ...parts), dev: stat.dev, ino: stat.ino };
  } finally { await handle.close(); }
}
async function discover(root: WorkspaceRoot, start: string) {
  const queue = [{ path: start, depth: 0 }], repos: { path: string; supported: boolean }[] = [];
  let scanned = 0, truncated = false;
  while (queue.length && scanned < 200 && repos.length < 32) {
    const item = queue.shift()!; scanned++;
    const handle = await openChecked(root, relativeParts(item.path), true);
    try {
      const dir = await opendir(`/proc/self/fd/${handle.fd}`);
      let entries = 0;
      for await (const entry of dir) {
        if (++entries > 1000) { truncated = true; break; }
        if (entry.name === '.git') { repos.push({ path: item.path, supported: entry.isDirectory() && !entry.isSymbolicLink() }); continue; }
        if (entry.isDirectory() && allowedName(entry.name) && !['node_modules', 'vendor', 'build', 'dist'].includes(entry.name)) {
          if (item.depth < 3 && queue.length < 200) queue.push({ path: [item.path, entry.name].filter(Boolean).join('/'), depth: item.depth + 1 });
          else truncated = true;
        }
      }
      await contained(handle, root);
    } finally { await handle.close(); }
  }
  return { repos: repos.slice(0, 32), truncated: truncated || !!queue.length };
}
function text(blob: Uint8Array) {
  if (blob.length > GIT_LIMITS.diffBytes) throw new WorkspaceError('GIT_DIFF_TOO_LARGE', 413);
  try { if (blob.includes(0)) throw new Error(); return new TextDecoder('utf-8', { fatal: true }).decode(blob); }
  catch { throw new WorkspaceError('GIT_BINARY_DIFF', 415); }
}
async function run(request: GitRequest) {
  const { root, repo, action } = request;
  if (action === 'repos') return discover(root, repo);
  const target = await repoRoot(root, repo);
  const meta = await openChecked(target, ['.git'], true); await meta.close();
  const boundary = gitFileSystem(target);
  const options = { fs: boundary.fs, dir: '/project', gitdir: '/project/.git' };
  const signature = async () => {
    const value = async (path: string) => { try { return Buffer.from(await boundary.readFile(path)).toString('base64'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; } };
    // Detect HEAD/index updates across the read; no files or library index refresh are written.
    return (await value('/project/.git/HEAD')) + ':' + (await value('/project/.git/index'));
  };
  const before = await signature();
  let result: unknown;
  if (action === 'status') {
    const rows = await contentStatus(options);
    boundary.check();
    const changes = rows.filter(([, head, work, stage]) => head !== work || work !== stage);
    const branch = await git.currentBranch({ ...options, fullname: false });
    let head: string | null = null;
    try { head = await git.resolveRef({ ...options, ref: 'HEAD' }); }
    catch (error) { if ((error as { code?: string }).code !== 'NotFoundError') throw error; }
    if (head && !/^[a-f0-9]{40}$/.test(head)) throw new WorkspaceError('GIT_UNSUPPORTED_FORMAT', 422);
    result = { repo, branch: branch?.slice(0, 200) ?? null, head,
      files: changes.slice(0, GIT_LIMITS.files).map(([path, head, work, stage]) => ({ path, head, work, stage, staged: head !== stage, unstaged: work !== stage })),
      truncated: changes.length > GIT_LIMITS.files, total: changes.length };
  } else {
    const path = request.path ?? ''; if (!path) throw new WorkspaceError('WORKSPACE_INVALID_PATH'); relativeParts(path);
    let base: Uint8Array = new Uint8Array(), staged: Uint8Array = new Uint8Array();
    // Prune all unrelated trees. Never expose symlink targets, submodule state or restricted paths.
    await git.walk({ ...options, trees: [git.TREE({ ref: 'HEAD' }), git.STAGE()],
      map: async (filename, entries) => {
        if (filename === '.' || path.startsWith(filename + '/')) return undefined;
        if (filename !== path) return null;
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]; if (!entry) continue;
          const mode = await entry.mode();
          if (![0o100644, 0o100755].includes(mode)) throw new WorkspaceError('GIT_FILE_TYPE_REJECTED', 403);
          const { blob } = await git.readBlob({ ...options, oid: await entry.oid() });
          if (i === 0) base = blob; else staged = blob;
        }
        return null;
      },
    });
    boundary.check();
    let current = staged;
    if (!request.staged) {
      base = staged;
      try { current = Buffer.from(await boundary.readFile('/project/' + path)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') current = new Uint8Array(); else throw error; }
    }
    const oldText = text(base), newText = text(current);
    const patch = createTwoFilesPatch(path, path, oldText, newText, request.staged ? 'HEAD' : 'Index', request.staged ? 'Index' : 'Working tree', { context: 3 });
    result = { repo, path, staged: !!request.staged, patch: patch.slice(0, GIT_LIMITS.diffBytes), truncated: patch.length > GIT_LIMITS.diffBytes };
  }
  boundary.check();
  if (before !== await signature()) throw new WorkspaceError('WORKSPACE_CHANGED_RETRY', 409);
  return result;
}
if (parentPort) {
  void run(workerData as GitRequest).then(result => parentPort!.postMessage({ ok: true, result })).catch(error => {
    const safe = error instanceof WorkspaceError ? error : new WorkspaceError('GIT_UNSUPPORTED_OR_UNAVAILABLE', 422);
    parentPort!.postMessage({ ok: false, code: safe.code, status: safe.status });
  });
}
