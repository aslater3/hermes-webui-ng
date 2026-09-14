import { opendir } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { allowedName, relativeParts } from './files.js';
import { contained, openChecked, readBounded, WorkspaceError, type WorkspaceRoot } from './safe-open.js';

export const GIT_LIMITS = { operations: 20_000, bytesRead: 67_108_864, objectBytes: 8_388_608, packBytes: 33_554_432, entries: 12_000, files: 500, diffBytes: 262_144, timeoutMs: 10_000 } as const;
const metadata = /^(?:\.git(?:\/(?:HEAD|index|packed-refs|shallow|config|objects(?:\/(?:[a-f0-9]{2}(?:\/[a-f0-9]{38})?|pack(?:\/pack-[a-f0-9]{40}\.(?:pack|idx))?))?|refs(?:\/(?:heads|tags)(?:\/[A-Za-z0-9_.\/-]+)?)?))?)$/;
export function projectPath(path: string): boolean { try { relativeParts(path); return true; } catch { return false; } }
const missing = () => Object.assign(new Error('Git path unavailable'), { code: 'ENOENT' });
function variable(data: Buffer, start: number) {
  let n = 0, shift = 0, at = start;
  for (; at < data.length && shift <= 49; at++, shift += 7) {
    const byte = data[at]!; n += (byte & 127) * 2 ** shift;
    if (!(byte & 128)) return { value: n, end: at + 1 };
  }
  throw new WorkspaceError('GIT_INVALID_OBJECT', 422);
}
/** Validate compressed expansion before the Git library can allocate from untrusted headers. */
function validatePack(data: Buffer) {
  if (data.length < 32 || data.toString('ascii', 0, 4) !== 'PACK' || ![2, 3].includes(data.readUInt32BE(4))) throw new WorkspaceError('GIT_INVALID_OBJECT', 422);
  const count = data.readUInt32BE(8); if (count > 20_000) throw new WorkspaceError('GIT_LIMIT', 413);
  let at = 12, expanded = 0;
  for (let i = 0; i < count; i++) {
    let c = data[at++]!; const type = (c >> 4) & 7; let size = c & 15, shift = 4;
    while (c & 128) {
      if (at >= data.length || shift > 49) throw new WorkspaceError('GIT_INVALID_OBJECT', 422);
      c = data[at++]!; size += (c & 127) * 2 ** shift; shift += 7;
    }
    if (![1, 2, 3, 4, 6, 7].includes(type) || size > GIT_LIMITS.objectBytes) throw new WorkspaceError('GIT_LIMIT', 413);
    if (type === 6) { let bytes = 0; do { if (++bytes > 10 || at >= data.length) throw new WorkspaceError('GIT_INVALID_OBJECT', 422); c = data[at++]!; } while (c & 128); }
    if (type === 7) at += 20;
    const result = inflateSync(data.subarray(at), { maxOutputLength: GIT_LIMITS.objectBytes, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    if (result.buffer.length !== size || !result.engine.bytesWritten) throw new WorkspaceError('GIT_INVALID_OBJECT', 422);
    at += result.engine.bytesWritten; expanded += size;
    if (expanded > GIT_LIMITS.bytesRead) throw new WorkspaceError('GIT_LIMIT', 413);
    if (type === 6 || type === 7) {
      const source = variable(result.buffer, 0), target = variable(result.buffer, source.end);
      if (source.value > GIT_LIMITS.objectBytes || target.value > GIT_LIMITS.objectBytes) throw new WorkspaceError('GIT_LIMIT', 413);
    }
  }
  if (at !== data.length - 20) throw new WorkspaceError('GIT_INVALID_OBJECT', 422);
  return expanded;
}

/** Pure-JS Git gets ONLY this virtual /project filesystem. It never gets Node's raw fs. */
export function gitFileSystem(root: WorkspaceRoot) {
  let operations = 0, bytes = 0, entries = 0, inflated = 0;
  let failure: WorkspaceError | undefined;
  const fail = (error: WorkspaceError): never => { failure = error; throw error; };
  function path(input: string) {
    if (++operations > GIT_LIMITS.operations) fail(new WorkspaceError('GIT_LIMIT', 413));
    if (typeof input !== 'string') throw missing();
    if (input === '/project' || input === '/project/' || input === '/project/.') return '';
    if (!input.startsWith('/project/')) return fail(new WorkspaceError('GIT_PATH_REJECTED', 403));
    const value = input.slice(9);
    if (value.length > 2048 || value.split('/').some(p => !p || p === '.' || p === '..' || /[\x00-\x1f\x7f\\%\uFFFD]/.test(p))) return fail(new WorkspaceError('GIT_PATH_REJECTED', 403));
    if (value === '.git' || value.startsWith('.git/')) { if (!metadata.test(value)) throw missing(); }
    else if (!projectPath(value)) throw missing();
    return value;
  }
  async function handle(value: string, directory?: boolean) {
    try { return await openChecked(root, value ? value.split('/') : [], directory); }
    catch (error) {
      if (error instanceof WorkspaceError && error.code === 'WORKSPACE_NOT_FOUND') throw missing();
      return fail(error instanceof WorkspaceError ? error : new WorkspaceError('GIT_UNAVAILABLE', 503));
    }
  }
  async function stat(input: string) {
    const fd = await handle(path(input));
    try { return await fd.stat(); } finally { await fd.close(); }
  }
  async function readFile(input: string, options?: string | { encoding?: string }) {
    const value = path(input);
    // Ignore repository config completely: no includes, filters, helpers, external object dirs or fsmonitor.
    if (value === '.git/config') {
      const config = '[core]\nrepositoryformatversion = 0\nfilemode = true\nbare = false\n';
      return options ? config : Buffer.from(config);
    }
    const fd = await handle(value, false);
    try {
      const data = await readBounded(fd, root, value.startsWith('.git/') ? GIT_LIMITS.packBytes : GIT_LIMITS.objectBytes);
      bytes += data.length; if (bytes > GIT_LIMITS.bytesRead) fail(new WorkspaceError('GIT_LIMIT', 413));
      if (/^\.git\/objects\/[a-f0-9]{2}\/[a-f0-9]{38}$/.test(value)) inflated += inflateSync(data, { maxOutputLength: GIT_LIMITS.objectBytes }).length;
      else if (value.endsWith('.pack')) inflated += validatePack(data);
      if (inflated > GIT_LIMITS.bytesRead) fail(new WorkspaceError('GIT_LIMIT', 413));
      const encoding = typeof options === 'string' ? options : options?.encoding;
      if (encoding && !['utf8', 'utf-8'].includes(encoding)) fail(new WorkspaceError('GIT_INVALID_ENCODING', 400));
      return encoding ? new TextDecoder('utf-8', { fatal: true }).decode(data) : data;
    } catch (error) {
      return fail(error instanceof WorkspaceError ? error : new WorkspaceError('GIT_INVALID_OBJECT', 422));
    } finally { await fd.close(); }
  }
  async function readdir(input: string) {
    const value = path(input), fd = await handle(value, true);
    try {
      const dir = await opendir(`/proc/self/fd/${fd.fd}`), names: string[] = [];
      for await (const entry of dir) {
        if (++entries > GIT_LIMITS.entries) fail(new WorkspaceError('GIT_LIMIT', 413));
        const child = value ? `${value}/${entry.name}` : entry.name;
        if (child === '.git' || child.startsWith('.git/')) { if (metadata.test(child) && !entry.isSymbolicLink()) names.push(entry.name); }
        else if (allowedName(entry.name) && (entry.isFile() || entry.isDirectory())) names.push(entry.name);
      }
      await contained(fd, root); return names.sort();
    } finally { await fd.close(); }
  }
  const deny = async () => fail(new WorkspaceError('GIT_READ_ONLY', 403));
  return { fs: { promises: { readFile, readdir, stat, lstat: stat, readlink: deny, writeFile: deny, unlink: deny, mkdir: deny, rmdir: deny, symlink: deny, chmod: deny } },
    check: () => { if (failure) throw failure; }, readFile,
  };
}
