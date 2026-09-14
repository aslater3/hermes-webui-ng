import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { readBounded, WorkspaceError, type WorkspaceRoot } from './safe-open.js';
import { WRITE_LIMITS } from './write-policy.js';

/** Opaque revision: contents AND inode/metadata, never mtime alone or a browser-supplied stat. */
export function fileVersion(stat: Stats, content: Uint8Array): string {
  return createHash('sha256').update(JSON.stringify([
    stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode, stat.uid, stat.gid, stat.nlink,
  ])).update('\0').update(content).digest('hex');
}
export async function fileSnapshot(handle: FileHandle, root: WorkspaceRoot) {
  const stat = await handle.stat();
  const content = await readBounded(handle, root, WRITE_LIMITS.fileBytes);
  const after = await handle.stat();
  if (fileVersion(stat, content) !== fileVersion(after, content)) throw new WorkspaceError('WORKSPACE_CHANGED_RETRY', 409);
  let text: string;
  try {
    if (content.includes(0)) throw new Error();
    // Preserve an existing UTF-8 BOM and CRLF exactly; no implicit newline/encoding conversion.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
  } catch { throw new WorkspaceError('WORKSPACE_NOT_TEXT', 415); }
  return { stat, content, text, version: fileVersion(stat, content) };
}
export function saveInput(value: unknown): { root: string; path: string; text: string; expectedVersion: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkspaceError('WORKSPACE_INVALID_SAVE');
  const data = value as Record<string, unknown>;
  const fields = ['root', 'path', 'text', 'expectedVersion'];
  if (Object.keys(data).length !== fields.length || Object.keys(data).some(key => !fields.includes(key)) ||
      typeof data.root !== 'string' || !/^workspace(?:-[2-8])?$/.test(data.root) ||
      typeof data.path !== 'string' || !data.path || typeof data.text !== 'string')
    throw new WorkspaceError('WORKSPACE_INVALID_SAVE');
  if (typeof data.expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(data.expectedVersion))
    throw new WorkspaceError('WORKSPACE_VERSION_REQUIRED', 428);
  if (data.text.includes('\0') || Buffer.from(data.text, 'utf8').toString('utf8') !== data.text) throw new WorkspaceError('WORKSPACE_NOT_TEXT', 415);
  if (Buffer.byteLength(data.text, 'utf8') > WRITE_LIMITS.fileBytes) throw new WorkspaceError('WORKSPACE_SAVE_TOO_LARGE', 413);
  return { root: data.root, path: data.path, text: data.text, expectedVersion: data.expectedVersion };
}
