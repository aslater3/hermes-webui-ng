import { WorkspaceClientError, type WorkspaceApi, type Root, type Tree, type Preview, type Repo, type GitStatus, type Diff } from './api.js';
export interface WorkspaceState {
  busy: boolean; error: string; roots: Root[]; root: string; git: boolean; tab: 'files' | 'git' | 'changes';
  tree?: Tree; preview?: Preview; repos?: Repo[]; discoveryTruncated?: boolean; status?: GitStatus; diff?: Diff;
}
const empty = (): WorkspaceState => ({ busy: false, error: '', roots: [], root: '', git: false, tab: 'files' });
/** One bounded disposable view. All reads, including nested ones, belong to a single selection generation. */
export class WorkspaceStore {
  state = empty();
  private controller = new AbortController();
  private epoch = 0;
  private disposed = false;
  private listeners = new Set<() => void>();
  constructor(readonly api: WorkspaceApi, private readonly expired: () => void = () => {}) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private publish(patch: Partial<WorkspaceState>) { if (!this.disposed) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); } }
  private async task(patch: Partial<WorkspaceState>, read: (signal: AbortSignal) => Promise<Partial<WorkspaceState>>) {
    if (this.disposed) return;
    this.controller.abort(); this.controller = new AbortController(); const epoch = ++this.epoch;
    this.publish({ ...patch, error: '', busy: true });
    try { const result = await read(this.controller.signal); if (epoch === this.epoch && !this.disposed) this.publish(result); }
    catch (error) {
      if (epoch === this.epoch && !this.disposed) {
        if (error instanceof WorkspaceClientError && [401, 403].includes(error.status)) {
          this.publish({ preview: undefined, diff: undefined, tree: undefined, status: undefined, repos: undefined });
          if (error.status === 401) this.expired();
        }
        this.publish({ error: error instanceof WorkspaceClientError ? error.message : 'Workspace connection interrupted. Refresh to try again.' });
      }
    } finally { if (epoch === this.epoch) this.publish({ busy: false }); }
  }
  load = () => this.task(empty(), async signal => {
    const data = await this.api.roots(signal); const root = data.roots[0]?.id ?? '';
    if (signal.aborted || this.disposed) throw new DOMException('Selection changed', 'AbortError');
    // Keep other roots selectable if the first root has unreadable contents.
    this.publish({ ...data, root });
    return { ...data, root, tree: root ? await this.api.tree(root, '', 0, signal) : undefined };
  });
  selectRoot = (root: string) => this.task({ root, tab: 'files', tree: undefined, preview: undefined, diff: undefined, repos: undefined, status: undefined }, async signal => ({ tree: await this.api.tree(root, '', 0, signal) }));
  directory = (path: string, offset = 0) => {
    const root = this.state.root;
    return this.task({ tab: 'files', tree: undefined, preview: undefined, diff: undefined }, async signal => ({ tree: await this.api.tree(root, path, offset, signal) }));
  };
  file = (path: string) => {
    const root = this.state.root;
    return this.task({ preview: undefined, diff: undefined }, async signal => ({ preview: await this.api.preview(root, path, signal) }));
  };
  discover = () => {
    const { root, tree } = this.state;
    return this.task({ tab: 'git', preview: undefined, diff: undefined, status: undefined, repos: undefined }, async signal => this.api.repos(root, tree?.path ?? '', signal).then(data => ({ repos: data.repos, discoveryTruncated: data.truncated })));
  };
  repository = (repo: string) => {
    const root = this.state.root;
    return this.task({ tab: 'changes', preview: undefined, diff: undefined, status: undefined }, async signal => ({ status: await this.api.status(root, repo, signal) }));
  };
  changes = () => this.state.status ? this.repository(this.state.status.repo) : this.discover();
  showDiff = (path: string, staged: boolean) => {
    const { root, status } = this.state;
    if (!status) return Promise.resolve();
    return this.task({ diff: undefined, preview: undefined }, async signal => ({ diff: await this.api.diff(root, status.repo, path, staged, signal) }));
  };
  clearPreview = () => { this.controller.abort(); ++this.epoch; this.publish({ preview: undefined, diff: undefined, busy: false, error: '' }); };
  clear() { this.controller.abort(); ++this.epoch; this.state = empty(); this.listeners.forEach(listener => listener()); }
  dispose() { this.clear(); this.disposed = true; this.listeners.clear(); }
}
