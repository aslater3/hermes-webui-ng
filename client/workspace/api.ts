/** The browser uses the native cookie-scoped LOCAL alias, never a host filesystem path. */
const PREFIX = '/__hermes/webui-local/';
export interface Root { id: string; label: string; writable: boolean }
export interface Entry { name: string; type: 'file' | 'directory' | 'blocked' }
export interface Tree { path: string; entries: Entry[]; offset: number; nextOffset: number | null; truncated: boolean }
export interface Preview { path: string; kind: 'text' | 'binary' | 'too-large'; size: number; text: string | null; version?: string }
export interface Repo { path: string; supported: boolean }
export interface Change { path: string; head: number; work: number; stage: number; staged: boolean; unstaged: boolean }
export interface GitStatus { repo: string; branch: string | null; head: string | null; files: Change[]; total: number; truncated: boolean }
export interface Diff { repo: string; path: string; staged: boolean; patch: string; truncated: boolean }
export class WorkspaceClientError extends Error {
  constructor(readonly code: string, readonly status = 0) {
    super(status === 401 ? 'Sign in again to read workspace files.' : status === 403 ? 'This path is not readable under the workspace policy.' :
      status === 409 ? 'The project changed while it was being read. Refresh and try again.' : status === 429 ? 'Workspace is busy. Wait a moment, then refresh.' :
      code === 'GIT_BINARY_DIFF' ? 'Binary file differences cannot be previewed.' : status === 413 ? 'This file or repository exceeds the preview limit.' :
      status === 422 ? 'This repository layout or object is not supported by the read-only reader.' : status === 404 ? 'This path or capability is no longer available.' :
      status >= 500 ? 'Workspace is temporarily unavailable. Check the connection and refresh.' : 'The workspace response could not be read safely.');
  }
}
function bad(): never { throw new WorkspaceClientError('WORKSPACE_INVALID_RESPONSE'); }
function obj(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad(); }
function str(value: unknown, max = 2048): string { return typeof value === 'string' && value.length <= max ? value : bad(); }
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : bad(); }
function num(value: unknown, max = Number.MAX_SAFE_INTEGER): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : bad(); }
function list(value: unknown, max: number): unknown[] { return Array.isArray(value) && value.length <= max ? value : bad(); }
export function validPath(input: unknown): string {
  const value = str(input);
  if (value && (value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..' || /[\x00-\x1f\x7f\\%\uFFFD]/.test(part)))) bad();
  return value;
}
function id(input: unknown): string { const value = str(input, 64); return /^workspace(?:-[2-8])?$/.test(value) ? value : bad(); }
export class WorkspaceApi {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private async get(route: string, params: Record<string, string>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.fetcher(PREFIX + route + (Object.keys(params).length ? '?' + new URLSearchParams(params) : ''), {
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    const reader = response.body?.getReader(); if (!reader) bad();
    let size = 0; const chunks: Uint8Array[] = [];
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 2_097_152) bad(); chunks.push(next.value); }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let data: Record<string, unknown>; try { data = obj(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); } catch { bad(); }
    if (!response.ok) {
      const error = obj(data.error), code = typeof error.code === 'string' && /^(WORKSPACE|GIT)_[A-Z_]+$/.test(error.code) ? error.code : 'WORKSPACE_UNAVAILABLE';
      throw new WorkspaceClientError(code, response.status);
    }
    return data;
  }
  async roots(signal: AbortSignal): Promise<{ roots: Root[]; git: boolean }> {
    const data = await this.get('workspaces', {}, signal);
    const roots = list(data.roots, 8).map(value => { const row = obj(value); return { id: id(row.id), label: str(row.label, 80), writable: bool(row.writable) }; });
    if (new Set(roots.map(row => row.id)).size !== roots.length) bad();
    return { roots, git: bool(data.git) };
  }
  async tree(root: string, path: string, offset: number, signal: AbortSignal): Promise<Tree> {
    const data = await this.get('files/tree', { root: id(root), path: validPath(path), offset: String(num(offset, 999)) }, signal);
    if (data.path !== path || data.offset !== offset) bad();
    return { path, offset, nextOffset: data.nextOffset === null ? null : num(data.nextOffset, 999), truncated: bool(data.truncated),
      entries: list(data.entries, 200).map(value => { const row = obj(value); const name = validPath(row.name); if (!name || name.includes('/') || !['file', 'directory', 'blocked'].includes(String(row.type))) bad(); return { name, type: row.type as Entry['type'] }; }) };
  }
  async preview(root: string, path: string, signal: AbortSignal): Promise<Preview> {
    const data = await this.get('files/read', { root: id(root), path: validPath(path) }, signal);
    if (data.path !== path || !['text', 'binary', 'too-large'].includes(String(data.kind))) bad();
    return { path, kind: data.kind as Preview['kind'], size: num(data.size), ...(data.version === undefined ? {} : { version: /^[a-f0-9]{64}$/.test(str(data.version, 64)) ? data.version as string : bad() }), text: data.kind === 'text' ? str(data.text, 262144) : data.text === null ? null : bad() };
  }
  async info(root: string, path: string, signal: AbortSignal) {
    const data = await this.get('files/info', { root: id(root), path: validPath(path) }, signal);
    if (data.path !== path || !['file', 'directory'].includes(String(data.kind)) || !/^[a-f0-9]{64}$/.test(str(data.version, 64))) bad();
    return { path, kind: data.kind as 'file' | 'directory', version: data.version as string, size: num(data.size) };
  }
  async repos(root: string, path: string, signal: AbortSignal) {
    const data = await this.get('git/repos', { root: id(root), path: validPath(path) }, signal);
    return { repos: list(data.repos, 32).map(value => { const row = obj(value); return { path: validPath(row.path), supported: bool(row.supported) }; }), truncated: bool(data.truncated) };
  }
  async status(root: string, repo: string, signal: AbortSignal): Promise<GitStatus> {
    const data = await this.get('git/status', { root: id(root), repo: validPath(repo) }, signal);
    if (data.repo !== repo) bad();
    return { repo, branch: data.branch === null ? null : str(data.branch, 200), head: data.head === null ? null : /^[a-f0-9]{40}$/.test(str(data.head, 40)) ? data.head as string : bad(),
      total: num(data.total), truncated: bool(data.truncated), files: list(data.files, 500).map(value => { const row = obj(value); return { path: validPath(row.path), head: num(row.head, 1), work: num(row.work, 2), stage: num(row.stage, 3), staged: bool(row.staged), unstaged: bool(row.unstaged) }; }) };
  }
  async diff(root: string, repo: string, path: string, staged: boolean, signal: AbortSignal): Promise<Diff> {
    const data = await this.get('git/diff', { root: id(root), repo: validPath(repo), path: validPath(path), staged: String(staged) }, signal);
    if (data.repo !== repo || data.path !== path || data.staged !== staged) bad();
    return { repo, path, staged, patch: str(data.patch, 262144), truncated: bool(data.truncated) };
  }
  download(root: string, path: string) { return PREFIX + 'files/download?' + new URLSearchParams({ root: id(root), path: validPath(path) }); }
}
