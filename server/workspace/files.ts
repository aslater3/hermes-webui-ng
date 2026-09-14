import { constants, realpathSync, statSync } from 'node:fs';
import { open, opendir, readlink, type FileHandle } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

export class WorkspaceError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export interface WorkspaceRoot { id: string; label: string; path: string; dev: number; ino: number }
export const FILE_LIMITS = { previewBytes: 262_144, downloadBytes: 10_485_760, directoryEntries: 1000, pageEntries: 200 } as const;
const deniedNames = /^(?:\.hermes|\.git|\.ssh|\.aws|\.gnupg|\.local|\.env(?:\..*)?|state\.db(?:-.*)?|id_(?:rsa|ed25519|ecdsa)(?:\.pub)?)$/i;
const deniedExtensions = /\.(?:pem|key|p12|pfx)$/i;
const invalid = /[\x00-\x1f\x7f\\%\uFFFD]/;
export function allowedName(name: string): boolean {
  return !!name && !['.', '..'].includes(name) && !invalid.test(name) && !deniedNames.test(name) && !deniedExtensions.test(name);
}
export function relativeParts(path: string): string[] {
  if (path.length > 2048 || invalid.test(path) || isAbsolute(path)) throw new WorkspaceError('WORKSPACE_INVALID_PATH');
  if (!path) return [];
  const parts = path.split('/');
  if (parts.length > 32 || parts.some(part => !allowedName(part))) throw new WorkspaceError('WORKSPACE_INVALID_PATH');
  return parts;
}
/** Disabled unless explicitly configured. Docker/Linux is the supported filesystem boundary. */
export function workspaceRoots(value: string | undefined): WorkspaceRoot[] {
  if (!value?.trim()) return [];
  if (process.platform !== 'linux') throw new Error('Mounted workspace access currently requires Linux');
  const paths = value.split(',').map(part => part.trim());
  if (paths.length > 8 || new Set(paths).size !== paths.length) throw new Error('Configure at most eight distinct workspace roots');
  return paths.map((path, index) => {
    try {
      if (!isAbsolute(path) || invalid.test(path)) throw new Error();
      const canonical = realpathSync(path);
      if (resolve(path) !== canonical || canonical === '/' || canonical.split(sep).some(part => part && !allowedName(part)) ||
          /^\/(?:proc|sys|dev|etc|run|boot)(?:\/|$)/.test(canonical) || ['/home', '/root', '/app', '/usr', '/var', '/tmp'].includes(canonical)) throw new Error();
      const stat = statSync(canonical);
      if (!stat.isDirectory()) throw new Error();
      return { id: index ? `workspace-${index + 1}` : 'workspace', label: index ? `Workspace ${index + 1}` : 'Workspace', path: canonical, dev: stat.dev, ino: stat.ino };
    } catch { throw new Error('WORKSPACE_ROOTS must name existing project directories, not symlinks or system/Hermes directories'); }
  });
}
const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
async function contained(handle: FileHandle, root: WorkspaceRoot) {
  const actual = await readlink(`/proc/self/fd/${handle.fd}`);
  if (actual !== root.path && !actual.startsWith(`${root.path}/`)) throw new WorkspaceError('WORKSPACE_PATH_REJECTED', 403);
  if (actual.endsWith(' (deleted)')) throw new WorkspaceError('WORKSPACE_CHANGED_RETRY', 409);
}
/** Walk one component at a time through pinned parent descriptors; never follow a project symlink. */
export async function openWorkspacePath(root: WorkspaceRoot, path: string, directory = false): Promise<FileHandle> {
  const parts = relativeParts(path);
  let handle: FileHandle | undefined;
  try {
    handle = await open(root.path, flags | constants.O_DIRECTORY);
    const identity = await handle.stat();
    if (identity.dev !== root.dev || identity.ino !== root.ino) throw new WorkspaceError('WORKSPACE_ROOT_CHANGED', 409);
    for (let i = 0; i < parts.length; i++) {
      await contained(handle, root);
      const next = await open(`/proc/self/fd/${handle.fd}/${parts[i]}`, flags | (directory || i < parts.length - 1 ? constants.O_DIRECTORY : 0));
      await handle.close(); handle = next;
    }
    await contained(handle, root);
    const stat = await handle.stat();
    if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) throw new WorkspaceError('WORKSPACE_FILE_TYPE_REJECTED', 403);
    return handle;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof WorkspaceError) throw error;
    // Do not leak paths, syscall names, link targets or upstream secrets.
    throw new WorkspaceError('WORKSPACE_PATH_UNAVAILABLE', 403);
  }
}
export async function tree(root: WorkspaceRoot, path: string, offset = 0) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= FILE_LIMITS.directoryEntries || offset % FILE_LIMITS.pageEntries !== 0)
    throw new WorkspaceError('WORKSPACE_INVALID_PAGE');
  const handle = await openWorkspacePath(root, path, true);
  try {
    const dir = await opendir(`/proc/self/fd/${handle.fd}`);
    const entries: { name: string; type: 'directory' | 'file' | 'blocked' }[] = [];
    let scanned = 0, truncated = false;
    for await (const entry of dir) {
      if (++scanned > FILE_LIMITS.directoryEntries) { truncated = true; break; }
      if (!allowedName(entry.name)) continue;
      entries.push({ name: entry.name, type: entry.isSymbolicLink() ? 'blocked' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'blocked' });
    }
    await contained(handle, root);
    entries.sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name, 'en'));
    return { path, entries: entries.slice(offset, offset + FILE_LIMITS.pageEntries), offset,
      nextOffset: entries.length > offset + FILE_LIMITS.pageEntries ? offset + FILE_LIMITS.pageEntries : null, truncated };
  } finally { await handle.close(); }
}
export async function preview(root: WorkspaceRoot, path: string) {
  const handle = await openWorkspacePath(root, path);
  try {
    const before = await handle.stat();
    if (before.size > FILE_LIMITS.previewBytes) return { path, kind: 'too-large', size: before.size, text: null };
    const buffer = Buffer.alloc(FILE_LIMITS.previewBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat(); await contained(handle, root);
    if (length !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.size !== before.size)
      throw new WorkspaceError('WORKSPACE_CHANGED_RETRY', 409);
    let text: string;
    try {
      const data = buffer.subarray(0, length);
      if (data.includes(0)) throw new Error();
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch { return { path, kind: 'binary', size: before.size, text: null }; }
    return { path, kind: 'text', size: before.size, text };
  } finally { await handle.close(); }
}
