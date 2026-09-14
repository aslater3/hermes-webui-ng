import { constants } from 'node:fs';
import { open, readlink, type FileHandle } from 'node:fs/promises';

export class WorkspaceError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export interface WorkspaceRoot { id: string; label: string; path: string; dev: number; ino: number }
const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
export async function contained(handle: FileHandle, root: WorkspaceRoot) {
  const actual = await readlink(`/proc/self/fd/${handle.fd}`);
  if (actual !== root.path && !actual.startsWith(`${root.path}/`)) throw new WorkspaceError('WORKSPACE_PATH_REJECTED', 403);
  if (actual.endsWith(' (deleted)')) throw new WorkspaceError('WORKSPACE_CHANGED_RETRY', 409);
}
/** Internal primitive. Public file paths and the Git metadata adapter apply separate allowlists. */
export async function openChecked(root: WorkspaceRoot, parts: string[], directory?: boolean): Promise<FileHandle> {
  if (parts.length > 40 || parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f\x7f\\/%\uFFFD]/.test(part)))
    throw new WorkspaceError('WORKSPACE_INVALID_PATH');
  let handle: FileHandle | undefined;
  try {
    handle = await open(root.path, flags | constants.O_DIRECTORY);
    const identity = await handle.stat();
    if (identity.dev !== root.dev || identity.ino !== root.ino) throw new WorkspaceError('WORKSPACE_ROOT_CHANGED', 409);
    for (let i = 0; i < parts.length; i++) {
      await contained(handle, root);
      const next = await open(`/proc/self/fd/${handle.fd}/${parts[i]}`, flags | (directory === true || i < parts.length - 1 ? constants.O_DIRECTORY : 0));
      await handle.close(); handle = next;
    }
    await contained(handle, root);
    const stat = await handle.stat();
    if (directory === true ? !stat.isDirectory() : directory === false ? !stat.isFile() || stat.nlink !== 1 : !(stat.isDirectory() || stat.isFile() && stat.nlink === 1))
      throw new WorkspaceError('WORKSPACE_FILE_TYPE_REJECTED', 403);
    return handle;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof WorkspaceError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WorkspaceError('WORKSPACE_NOT_FOUND', 404);
    throw new WorkspaceError('WORKSPACE_PATH_UNAVAILABLE', 403);
  }
}
export async function readBounded(handle: FileHandle, root: WorkspaceRoot, max: number): Promise<Buffer> {
  const before = await handle.stat();
  if (before.size > max) throw new WorkspaceError('WORKSPACE_LIMIT', 413);
  const buffer = Buffer.alloc(before.size + 1);
  let length = 0;
  while (length < buffer.length) {
    const next = await handle.read(buffer, length, buffer.length - length, length);
    if (!next.bytesRead) break;
    length += next.bytesRead;
  }
  const after = await handle.stat(); await contained(handle, root);
  if (length !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.size !== before.size)
    throw new WorkspaceError('WORKSPACE_CHANGED_RETRY', 409);
  return buffer.subarray(0, length);
}
