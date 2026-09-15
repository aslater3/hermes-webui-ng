import { writableRoot, type WritePolicy } from './write-policy.js';
import { constants } from 'node:fs';
import { mkdir, open, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { relativeParts, FILE_LIMITS } from './files.js';
import { fileVersion } from './file-version.js';
import { contained, openChecked, readBounded, WorkspaceError, type WorkspaceRoot } from './safe-open.js';
import { lockedRoot, nativeBoundary, plainMetadata } from './native-boundary.js';
import type { SaveChecks } from './atomic-save.js';

export interface EntryInfo { path: string; kind: 'file' | 'directory'; size: number; version: string }
export function currentWrite(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WorkspaceError('WORKSPACE_OPERATION_CANCELLED', 409);
}
export function operationError(error: unknown, committed = false): WorkspaceError {
  if (committed) return new WorkspaceError('WORKSPACE_OPERATION_UNCONFIRMED', 503);
  if (error instanceof WorkspaceError) return error;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'EEXIST') return new WorkspaceError('WORKSPACE_DESTINATION_EXISTS', 409);
  if (code === 'ENOTEMPTY') return new WorkspaceError('WORKSPACE_DIRECTORY_NOT_EMPTY', 409);
  if (code === 'EROFS') return new WorkspaceError('WORKSPACE_MOUNT_READ_ONLY', 403);
  if (['EACCES', 'EPERM'].includes(code ?? '')) return new WorkspaceError('WORKSPACE_WRITE_FORBIDDEN', 403);
  if (['ENOSPC', 'EDQUOT'].includes(code ?? '')) return new WorkspaceError('WORKSPACE_STORAGE_FULL', 507);
  if (['ENOSYS', 'EOPNOTSUPP', 'EXDEV', 'EINVAL'].includes(code ?? '')) return new WorkspaceError('WORKSPACE_ATOMIC_OPERATION_UNSUPPORTED', 422);
  return new WorkspaceError('WORKSPACE_OPERATION_UNAVAILABLE', 503);
}
export function mutationPath(path: unknown): string[] {
  if (typeof path !== 'string') throw new WorkspaceError('WORKSPACE_INVALID_PATH');
  const parts = relativeParts(path);
  if (!parts.length || parts.some(name => Buffer.byteLength(name, 'utf8') > 255)) throw new WorkspaceError('WORKSPACE_INVALID_PATH');
  return parts;
}
export function expectedVersion(version: unknown): string {
  if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version)) throw new WorkspaceError('WORKSPACE_VERSION_REQUIRED', 428);
  return version;
}
export async function entryInfo(root: WorkspaceRoot, path: string): Promise<EntryInfo> {
  const fd = await openChecked(root, mutationPath(path));
  try {
    const stat = await fd.stat(), directory = stat.isDirectory();
    const content = directory ? new Uint8Array() : await readBounded(fd, root, FILE_LIMITS.downloadBytes);
    const after = await fd.stat(); await contained(fd, root);
    if (fileVersion(stat, content) !== fileVersion(after, content)) throw new WorkspaceError('WORKSPACE_CHANGED_RETRY', 409);
    return { path, kind: directory ? 'directory' : 'file', size: directory ? 0 : stat.size, version: fileVersion(stat, content) };
  } finally { await fd.close(); }
}
/** Every project ancestor must be a plain, owner-controlled directory. No ancestor is created. */
export async function writeParent(root: WorkspaceRoot, path: string): Promise<FileHandle> {
  const parents = mutationPath(path).slice(0, -1);
  for (let count = 0; count <= parents.length; count++) {
    const fd = await openChecked(root, parents.slice(0, count), true);
    try { await plainMetadata(fd, true); await contained(fd, root); if (count === parents.length) return fd; }
    catch (error) { await fd.close(); throw error; }
    await fd.close();
  }
  throw new WorkspaceError('WORKSPACE_INVALID_PATH');
}
async function checkParent(root: WorkspaceRoot, path: string, original: FileHandle) {
  const fd = await writeParent(root, path);
  try {
    const before = await original.stat(), after = await fd.stat();
    if (before.dev !== after.dev || before.ino !== after.ino) throw new WorkspaceError('WORKSPACE_CHANGED_RETRY', 409);
    await contained(original, root);
  } finally { await fd.close(); }
}
async function checkEntry(root: WorkspaceRoot, path: string, version: string) {
  const info = await entryInfo(root, path);
  if (info.version !== expectedVersion(version)) throw new WorkspaceError('WORKSPACE_VERSION_CONFLICT', 409);
  const fd = await openChecked(root, mutationPath(path));
  try { await plainMetadata(fd, info.kind === 'directory'); } finally { await fd.close(); }
  return info;
}
const filename = (path: string) => mutationPath(path).at(-1)!;
const temporaryName = () => '.webui-tmp-' + randomBytes(18).toString('hex');

export class WorkspaceFiles {
  constructor(private readonly policy?: WritePolicy) {}
  private allowed(root: WorkspaceRoot) { if (!writableRoot(this.policy, root)) throw new WorkspaceError('WORKSPACE_READ_ONLY', 403); }
  async rename(root: WorkspaceRoot, path: string, target: string, version: string, checks: SaveChecks = {}) {
    this.allowed(root);
    mutationPath(path); mutationPath(target); expectedVersion(version);
    let committed = false;
    try { return await lockedRoot(root, async () => {
      const source = await writeParent(root, path); let destination: FileHandle | undefined;
      try {
        destination = await writeParent(root, target);
        const info = await checkEntry(root, path, version); currentWrite(checks.signal);
        if (path === target) return { ...info, outcome: 'unchanged' as const };
        await checks.beforeCommit?.(); currentWrite(checks.signal);
        await checkEntry(root, path, version); await checkParent(root, path, source); await checkParent(root, target, destination);
        currentWrite(checks.signal);
        nativeBoundary().renameNoReplace(source.fd, filename(path), destination.fd, filename(target)); committed = true;
        await source.sync(); await destination.sync();
        return { ...await entryInfo(root, target), outcome: 'renamed' as const };
      } finally { await destination?.close(); await source.close(); }
    }); } catch (error) { throw operationError(error, committed); }
  }
  async remove(root: WorkspaceRoot, path: string, version: string, checks: SaveChecks = {}) {
    this.allowed(root);
    mutationPath(path); expectedVersion(version); let committed = false;
    try { return await lockedRoot(root, async () => {
      const parent = await writeParent(root, path);
      try {
        await checkEntry(root, path, version); currentWrite(checks.signal);
        await checks.beforeCommit?.(); currentWrite(checks.signal);
        const info = await checkEntry(root, path, version); await checkParent(root, path, parent); currentWrite(checks.signal);
        const target = `/proc/self/fd/${parent.fd}/${filename(path)}`;
        if (info.kind === 'directory') await rmdir(target); // Empty directories only. Never recursive.
        else await unlink(target);
        committed = true; await parent.sync();
        return { path, outcome: 'deleted' as const };
      } finally { await parent.close(); }
    }); } catch (error) { throw operationError(error, committed); }
  }
  async directory(root: WorkspaceRoot, path: string, checks: SaveChecks = {}) {
    this.allowed(root);
    mutationPath(path); let committed = false;
    try { return await lockedRoot(root, async () => {
      const parent = await writeParent(root, path), temporary = temporaryName(); let staged = false;
      const prefix = `/proc/self/fd/${parent.fd}/`;
      try {
        currentWrite(checks.signal); await mkdir(prefix + temporary, { mode: 0o700 }); staged = true;
        const temp = await open(prefix + temporary, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { await plainMetadata(temp, true); await temp.sync(); } finally { await temp.close(); }
        await checks.beforeCommit?.(); await checkParent(root, path, parent); currentWrite(checks.signal);
        nativeBoundary().renameNoReplace(parent.fd, temporary, parent.fd, filename(path)); staged = false; committed = true;
        await parent.sync(); return { ...await entryInfo(root, path), outcome: 'created' as const };
      } finally { if (staged) await rmdir(prefix + temporary).catch(() => {}); await parent.close(); }
    }); } catch (error) { throw operationError(error, committed); }
  }
  async create(root: WorkspaceRoot, path: string, chunks: AsyncIterable<Uint8Array>, maxBytes: number, checks: SaveChecks = {}) {
    this.allowed(root);
    mutationPath(path); let committed = false;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > FILE_LIMITS.downloadBytes) throw new WorkspaceError('WORKSPACE_INVALID_LIMIT');
    try { return await lockedRoot(root, async () => {
      const parent = await writeParent(root, path), temporary = temporaryName(); let temp: FileHandle | undefined, staged = false;
      const prefix = `/proc/self/fd/${parent.fd}/`;
      try {
        currentWrite(checks.signal);
        temp = await open(prefix + temporary, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); staged = true;
        let bytes = 0;
        for await (const chunk of chunks) {
          currentWrite(checks.signal);
          if (!(chunk instanceof Uint8Array) || bytes + chunk.byteLength > maxBytes) throw new WorkspaceError('WORKSPACE_UPLOAD_TOO_LARGE', 413);
          let offset = 0;
          while (offset < chunk.byteLength) {
            const result = await temp.write(chunk, offset, chunk.byteLength - offset, bytes + offset);
            if (!result.bytesWritten) throw new WorkspaceError('WORKSPACE_STORAGE_FULL', 507);
            offset += result.bytesWritten;
          }
          bytes += chunk.byteLength;
        }
        await plainMetadata(temp); await temp.sync(); await checks.beforeCommit?.();
        await checkParent(root, path, parent); await contained(temp, root); currentWrite(checks.signal);
        nativeBoundary().renameNoReplace(parent.fd, temporary, parent.fd, filename(path)); staged = false; committed = true;
        await parent.sync();
        return { ...await entryInfo(root, path), outcome: 'created' as const };
      } finally { if (staged) await unlink(prefix + temporary).catch(() => {}); await temp?.close(); await parent.close(); }
    }); } catch (error) { throw operationError(error, committed); }
  }
}
