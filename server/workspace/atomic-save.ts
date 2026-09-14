import { constants } from 'node:fs';
import { open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { relativeParts } from './files.js';
import { contained, openChecked, WorkspaceError, type WorkspaceRoot } from './safe-open.js';
import { fileSnapshot, saveInput } from './file-version.js';
import { writableRoot, type WritePolicy } from './write-policy.js';

export interface SaveResult { path: string; version: string; size: number; outcome: 'saved' | 'unchanged' }
export interface SaveChecks {
  /** Admission is rechecked after the bounded request body and staging, before commit. */
  beforeCommit?: () => Promise<void>;
  signal?: AbortSignal;
}
function current(signal?: AbortSignal) {
  if (signal?.aborted) throw new WorkspaceError('WORKSPACE_SAVE_CANCELLED', 409);
}
function safeError(error: unknown, committed: boolean): WorkspaceError {
  if (committed) return new WorkspaceError('WORKSPACE_SAVE_UNCONFIRMED', 503);
  if (error instanceof WorkspaceError) return error;
  const code = (error as NodeJS.ErrnoException)?.code;
  return new WorkspaceError(code === 'EROFS' ? 'WORKSPACE_MOUNT_READ_ONLY' :
    code === 'EACCES' || code === 'EPERM' ? 'WORKSPACE_WRITE_FORBIDDEN' :
    code === 'ENOSPC' || code === 'EDQUOT' ? 'WORKSPACE_STORAGE_FULL' : 'WORKSPACE_SAVE_UNAVAILABLE',
    code === 'EROFS' || code === 'EACCES' || code === 'EPERM' ? 403 : code === 'ENOSPC' || code === 'EDQUOT' ? 507 : 503);
}
/** Single-process mutation lane: no shared-volume multi-writer or external-writer CAS claim. */
export class WorkspaceWriter {
  private readonly lanes = new Map<string, Promise<void>>();
  private readonly lifetime = new AbortController();
  private count = 0;
  async save(root: WorkspaceRoot, policy: WritePolicy | undefined, input: unknown, checks: SaveChecks = {}): Promise<SaveResult> {
    if (!writableRoot(policy, root)) throw new WorkspaceError('WORKSPACE_READ_ONLY', 403);
    const data = saveInput(input), parts = relativeParts(data.path);
    if (data.root !== root.id || !parts.length) throw new WorkspaceError('WORKSPACE_INVALID_SAVE');
    current(this.lifetime.signal); current(checks.signal);
    if (this.count >= 4) throw new WorkspaceError('WORKSPACE_BUSY', 429);
    const key = root.path + '/' + parts.join('/');
    const previous = this.lanes.get(key) ?? Promise.resolve();
    let release!: () => void;
    const lane = new Promise<void>(resolve => { release = resolve; });
    this.lanes.set(key, lane); ++this.count;
    try {
      await previous;
      const signal = checks.signal ? AbortSignal.any([checks.signal, this.lifetime.signal]) : this.lifetime.signal;
      current(signal);
      return await this.replace(root, parts, data.text, data.expectedVersion, { ...checks, signal });
    } finally {
      release(); --this.count;
      if (this.lanes.get(key) === lane) this.lanes.delete(key);
    }
  }
  private async replace(root: WorkspaceRoot, parts: string[], text: string, expected: string, checks: SaveChecks): Promise<SaveResult> {
    const path = parts.join('/'), parents = parts.slice(0, -1), name = parts.at(-1)!;
    let parent: FileHandle | undefined, temporary: FileHandle | undefined, tempPath: string | undefined;
    let committed = false;
    try {
      parent = await openChecked(root, parents, true);
      const parentStat = await parent.stat();
      const inspect = async () => {
        const handle = await openChecked(root, parts, false);
        try { return await fileSnapshot(handle, root); } finally { await handle.close(); }
      };
      const source = await inspect();
      if (source.version !== expected) throw new WorkspaceError('WORKSPACE_VERSION_CONFLICT', 409);
      // Atomic replacement must not grant write access merely because the parent is writable.
      // Dedicated editable projects must be owned by the non-root WebUI runtime UID.
      if (source.stat.uid !== process.getuid?.() || !(source.stat.mode & 0o200) || source.stat.mode & 0o7000)
        throw new WorkspaceError('WORKSPACE_WRITE_FORBIDDEN', 403);
      current(checks.signal);
      if (text === source.text) return { path, version: source.version, size: source.content.length, outcome: 'unchanged' };
      const prefix = `/proc/self/fd/${parent.fd}/`;
      const candidate = prefix + '.webui-tmp-' + randomBytes(18).toString('hex');
      temporary = await open(candidate, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      tempPath = candidate;
      const bytes = Buffer.from(text, 'utf8');
      await temporary.writeFile(bytes);
      // Preserve group only when the OS permits it; never silently broaden ownership.
      const created = await temporary.stat();
      if (created.gid !== source.stat.gid) await temporary.chown(source.stat.uid, source.stat.gid);
      await temporary.chmod(source.stat.mode & 0o777);
      await temporary.sync();
      current(checks.signal);
      await checks.beforeCommit?.();
      current(checks.signal);
      // Revalidate current root/path identity and content immediately before atomic replacement.
      const latest = await inspect();
      if (latest.version !== expected) throw new WorkspaceError('WORKSPACE_VERSION_CONFLICT', 409);
      const freshParent = await openChecked(root, parents, true);
      try {
        const stat = await freshParent.stat();
        if (stat.dev !== parentStat.dev || stat.ino !== parentStat.ino) throw new WorkspaceError('WORKSPACE_CHANGED_RETRY', 409);
      } finally { await freshParent.close(); }
      await contained(parent, root); await contained(temporary, root); current(checks.signal);
      await rename(candidate, prefix + name);
      committed = true; tempPath = undefined;
      await parent.sync();
      const result = await fileSnapshot(temporary, root);
      if (!result.content.equals(bytes)) throw new WorkspaceError('WORKSPACE_SAVE_UNCONFIRMED', 503);
      return { path, version: result.version, size: result.content.length, outcome: 'saved' };
    } catch (error) { throw safeError(error, committed); }
    finally {
      // Only our exclusive random sibling is removed; never delete/truncate the destination.
      if (tempPath) await unlink(tempPath).catch(() => {});
      await temporary?.close().catch(() => {}); await parent?.close().catch(() => {});
    }
  }
  async close() { this.lifetime.abort(); await Promise.all([...this.lanes.values()]); }
}
