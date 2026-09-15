import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { FileHandle } from 'node:fs/promises';
import { contained, openChecked, WorkspaceError, type WorkspaceRoot } from './safe-open.js';
interface Boundary {
  emptyMetadata(fd: number): boolean;
  tryLock(fd: number): boolean;
  renameNoReplace(from: number, source: string, to: number, target: string): void;
}
let loaded: Boundary | undefined;
export function nativeBoundary(): Boundary {
  if (loaded) return loaded;
  try {
    const location = new URL(import.meta.url.endsWith('.ts') ? '../../build/server/workspace/workspace-boundary.node' : './workspace-boundary.node', import.meta.url);
    loaded = createRequire(import.meta.url)(fileURLToPath(location)) as Boundary;
    return loaded;
  } catch { throw new WorkspaceError('WORKSPACE_NATIVE_BOUNDARY_UNAVAILABLE', 503); }
}
/** Reject metadata we cannot safely preserve, including POSIX/default ACLs and security labels. */
export async function plainMetadata(handle: FileHandle, directory = false): Promise<void> {
  const stat = await handle.stat();
  if (stat.uid !== process.getuid?.() || !(stat.mode & 0o200) || stat.mode & 0o7000 ||
      (directory ? !stat.isDirectory() || !!(stat.mode & 0o022) : !stat.isFile() || stat.nlink !== 1))
    throw new WorkspaceError('WORKSPACE_WRITE_FORBIDDEN', 403);
  try { if (!nativeBoundary().emptyMetadata(handle.fd)) throw new WorkspaceError('WORKSPACE_EXTENDED_METADATA_UNSUPPORTED', 403); }
  catch (error) { if (error instanceof WorkspaceError) throw error; throw new WorkspaceError('WORKSPACE_METADATA_UNAVAILABLE', 503); }
}
/** Cooperating WebUI processes share a nonblocking kernel root lock; host editors do not. */
export async function lockedRoot<T>(root: WorkspaceRoot, action: () => Promise<T>): Promise<T> {
  const fd = await openChecked(root, [], true);
  try {
    await plainMetadata(fd, true); await contained(fd, root);
    if (!nativeBoundary().tryLock(fd.fd)) throw new WorkspaceError('WORKSPACE_BUSY', 429);
    return await action();
  } finally { await fd.close(); }
}
