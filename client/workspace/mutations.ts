import { type WorkspaceApi, WorkspaceClientError, validPath, type Preview } from './api.js';
export type Operation = 'save' | 'mkdir' | 'rename' | 'delete' | 'upload';
export interface MutationState {
  operation?: Operation; root: string; path: string; target: string; text: string; original: string; version: string;
  phase: 'closed' | 'loading' | 'ready' | 'sending' | 'conflict' | 'unknown' | 'checking' | 'done'; note: string; remote?: Preview;
}
const empty = (): MutationState => ({ root: '', path: '', target: '', text: '', original: '', version: '', phase: 'closed', note: '' });
export class WorkspaceMutations {
  state = empty();
  private epoch = 0;
  private abort = new AbortController();
  private upload?: File;
  private listeners = new Set<() => void>();
  constructor(readonly api: WorkspaceApi, private readonly fetcher: typeof fetch = fetch, private readonly admitted: () => boolean = () => true, private readonly expired: () => void = () => {}) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.state;
  private publish(patch: Partial<MutationState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  get dirty() { return this.state.operation === 'save' && this.state.text !== this.state.original; }
  get pending() { return ['loading', 'sending', 'checking'].includes(this.state.phase); }
  blocker = () => this.pending ? 'Wait for the workspace operation to settle.' : this.state.phase === 'unknown' ? 'Read back the unconfirmed workspace operation before reloading.' : this.dirty ? 'Save or discard your workspace edit before reloading.' : '';
  change = (value: string) => { if (!this.pending && !['unknown', 'done'].includes(this.state.phase)) this.publish({ text: value }); };
  target = (value: string) => { if (!this.pending) this.publish({ target: value }); };
  private reset() { this.abort.abort(); this.abort = new AbortController(); ++this.epoch; this.upload = undefined; }
  clear = () => { this.reset(); this.publish(empty()); };
  pause = () => { if (this.pending) { this.abort.abort(); ++this.epoch; this.publish({ phase: this.state.phase === 'loading' ? 'done' : 'unknown', note: 'Connection changed. Nothing will be resent automatically.' }); } };
  private start(operation: Operation, root: string, path: string) {
    if (this.state.phase !== 'closed' || !this.admitted()) return false;
    this.reset(); this.publish({ ...empty(), operation, root, path, phase: 'ready' }); return true;
  }
  edit = (root: string, preview: Preview) => {
    if (preview.kind !== 'text' || !preview.version || !this.start('save', root, preview.path)) return;
    const text = preview.text ?? '';
    if (/\r\n/.test(text) && /(?<!\r)\n/.test(text)) { this.publish({ phase: 'done', note: 'Mixed newline styles are read-only here to avoid silently normalising this file.' }); return; }
    this.publish({ text, original: text, version: preview.version });
  };
  open = async (operation: Exclude<Operation, 'save'>, root: string, path: string, file?: File) => {
    if (!this.start(operation, root, path)) return;
    this.upload = file; const epoch = this.epoch;
    this.publish({ target: operation === 'mkdir' || operation === 'upload' ? [path, file?.name ?? ''].filter(Boolean).join('/') : path });
    if (operation === 'rename' || operation === 'delete') {
      this.publish({ phase: 'loading' });
      try { const info = await this.api.info(root, path, this.abort.signal); if (epoch === this.epoch) this.publish({ version: info.version, phase: 'ready' }); }
      catch (error) { if (epoch === this.epoch) this.publish({ phase: 'done', note: error instanceof Error ? error.message : 'Cannot read current file.' }); }
    }
  };
  private async response(response: Response): Promise<Record<string, unknown>> {
    const reader = response.body?.getReader(); if (!reader) throw new Error('No acknowledgement');
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 65536) throw new Error('Invalid acknowledgement'); chunks.push(next.value); } }
    finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid acknowledgement');
    const data = value as Record<string, unknown>;
    if (!response.ok) {
      const error = data.error as { code?: unknown } | undefined;
      throw new WorkspaceClientError(typeof error?.code === 'string' ? error.code : 'WORKSPACE_UNAVAILABLE', response.status);
    }
    return data;
  }
  perform = async () => {
    const state = this.state;
    if (!this.admitted() || state.phase !== 'ready' || !state.operation || (state.operation === 'save' && !this.dirty)) return;
    let path = state.path, body: BodyInit, method: string, route: string, type = 'application/json';
    try {
      const base = { root: state.root, path: validPath(state.path) };
      if (state.operation === 'upload') {
        if (!this.upload || this.upload.size > 10_485_760 || this.upload.name.includes('/') || this.upload.name.includes('\\')) throw new Error('Choose one file no larger than 10 MiB.');
        path = validPath(state.target); body = this.upload; type = 'application/octet-stream'; method = 'POST'; route = 'upload?' + new URLSearchParams({ root: state.root, path });
      } else if (state.operation === 'save') {
        if (new TextEncoder().encode(state.text).length > 262144) throw new Error('Edited text must not exceed 256 KiB.');
        body = JSON.stringify({ ...base, text: state.text, expectedVersion: state.version }); method = 'PUT'; route = 'write';
      } else if (state.operation === 'mkdir') { path = validPath(state.target); body = JSON.stringify({ ...base, path, confirm: true }); method = 'POST'; route = 'mkdir'; }
      else if (state.operation === 'rename') { path = validPath(state.target); body = JSON.stringify({ ...base, target: path, expectedVersion: state.version, confirm: true }); method = 'POST'; route = 'rename'; }
      else { body = JSON.stringify({ ...base, expectedVersion: state.version, confirm: true }); method = 'DELETE'; route = 'delete'; }
      if (!path) throw new Error('A project-relative path is required.');
    } catch (error) { this.publish({ note: error instanceof Error ? error.message : 'Invalid operation.' }); return; }
    this.abort = new AbortController(); const epoch = ++this.epoch;
    this.publish({ phase: 'sending', note: '' });
    try {
      const raw = await this.fetcher('/__hermes/webui-local/files/' + route, { method, body, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': type, 'X-WebUI-Request': 'workspace-write' }, signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(20_000)]) });
      const result = await this.response(raw);
      if (epoch !== this.epoch) return;
      const outcomes = state.operation === 'save' ? ['saved', 'unchanged'] : state.operation === 'rename' ? ['renamed', 'unchanged'] : state.operation === 'delete' ? ['deleted'] : ['created'];
      if (result.path !== path || !outcomes.includes(String(result.outcome)) || (state.operation !== 'delete' && (typeof result.version !== 'string' || !/^[a-f0-9]{64}$/.test(result.version)))) throw new Error('Unconfirmed acknowledgement');
      this.upload = undefined;
      this.publish({ phase: 'done', original: state.text, version: typeof result.version === 'string' ? result.version : '', note: 'HermesUI confirmed the workspace operation. No prompt was sent to the agent.' });
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('webui-workspace-changed'));
    } catch (error) {
      if (epoch !== this.epoch) return;
      const rejected = error instanceof WorkspaceClientError && error.status >= 400 && error.status < 500 && error.status !== 408;
      if (error instanceof WorkspaceClientError && error.status === 401) this.expired();
      if (epoch !== this.epoch) return;
      this.publish({ phase: rejected ? error.status === 409 ? 'conflict' : 'ready' : 'unknown', note: rejected ? error.message : 'The result was not confirmed. Read current state before trying again; nothing will be resent.' });
    }
  };
  reconcile = async () => {
    if (!this.admitted() || this.pending || !this.state.operation) return;
    const state = this.state, epoch = ++this.epoch; this.abort = new AbortController();
    this.publish({ phase: 'checking' });
    try {
      const path = ['rename', 'mkdir', 'upload'].includes(state.operation!) ? state.target : state.path;
      if (state.operation === 'save') {
        const remote = await this.api.preview(state.root, state.path, this.abort.signal);
        if (epoch !== this.epoch) return;
        if (remote.text === state.text && remote.version) this.publish({ phase: 'done', original: state.text, version: remote.version, note: 'Current file matches your draft. No save was resent.' });
        else this.publish({ phase: 'conflict', remote, note: 'The current file differs. Review it before deliberately keeping your draft or discarding edits.' });
      } else {
        const info = await this.api.info(state.root, path, this.abort.signal);
        if (epoch === this.epoch) this.publish({ phase: 'done', note: `Current state: ${info.kind} exists at ${path}. Review the project before starting a fresh operation. Nothing was resent.` });
      }
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof WorkspaceClientError && error.status === 401) this.expired();
      if (epoch !== this.epoch) return;
      const absent = error instanceof WorkspaceClientError && error.status === 404;
      this.publish({ phase: absent && state.operation !== 'save' ? 'done' : 'unknown', note: absent ? 'The target is absent. Review the project before starting another operation; nothing was resent.' : 'Readback failed. Reconnect and check current state.' });
    }
  };
  useCurrentBase = () => {
    const remote = this.state.remote;
    if (this.state.phase === 'conflict' && remote?.version && remote.kind === 'text') this.publish({ phase: 'ready', version: remote.version, original: remote.text ?? '', remote: undefined, note: 'Current version selected as the base. Review your draft, then choose Save explicitly.' });
  };
}
