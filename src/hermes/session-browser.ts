import type { DashboardClient } from './dashboard-client.js';
import { ClientError } from './protocol.js';
import type { HistoryPage, SessionRef, SessionRow } from './session-rest.js';

type Reader = Pick<DashboardClient, 'sessions' | 'searchSessions' | 'sessionMessages'>;
export interface IndexState {
  phase: 'empty' | 'loading' | 'ready' | 'error';
  rows: SessionRow[];
  query: string;
  profile?: string;
  offset: number;
  total: number;
  hasNext: boolean;
  error?: ClientError;
}
export interface HistoryState {
  phase: 'empty' | 'loading' | 'ready' | 'error';
  requested?: SessionRef;
  page?: HistoryPage;
  error?: ClientError;
}
function failure(error: unknown): ClientError {
  return error instanceof ClientError ? error : new ClientError('protocol', 'Session request failed');
}

/** Bounded, disposable view state. No caching of full transcripts or browser persistence. */
export class SessionBrowser {
  index: IndexState = { phase: 'empty', rows: [], query: '', offset: 0, total: 0, hasNext: false };
  history: HistoryState = { phase: 'empty' };
  private listEpoch = 0;
  private historyEpoch = 0;
  private listAbort?: AbortController;
  private historyAbort?: AbortController;
  private disposed = false;
  private listeners = new Set<() => void>();
  constructor(private readonly dashboard: Reader, private readonly onAuthFailure?: (error: ClientError) => void) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener); listener(); return () => { this.listeners.delete(listener); };
  }
  private publish(): void { if (!this.disposed) for (const listener of this.listeners) listener(); }
  async list(query = this.index.query, offset = 0, profile = this.index.profile): Promise<void> {
    if (this.disposed) return;
    const epoch = ++this.listEpoch;
    this.listAbort?.abort(); this.listAbort = new AbortController();
    const same = query === this.index.query && profile === this.index.profile && offset === this.index.offset;
    this.index = { phase: 'loading', query, profile, offset, rows: same ? this.index.rows : [],
      total: same ? this.index.total : 0, hasNext: false };
    this.publish();
    try {
      const page = query.trim()
        ? { rows: await this.dashboard.searchSessions(query, profile, this.listAbort.signal), total: 0, offset: 0, limit: 50 }
        : await this.dashboard.sessions({ limit: 20, offset, profile }, this.listAbort.signal);
      if (this.disposed || epoch !== this.listEpoch) return;
      this.index = { ...this.index, phase: 'ready', rows: page.rows,
        total: query.trim() ? page.rows.length : page.total, offset: page.offset,
        hasNext: !query.trim() && page.rows.length > 0 && page.offset + page.limit < page.total };
    } catch (error) {
      if (this.disposed || epoch !== this.listEpoch) return;
      const safe = failure(error);
      this.index = { ...this.index, phase: 'error', error: safe };
      if (safe.kind === 'auth-required') this.onAuthFailure?.(safe);
    }
    this.publish();
  }
  refresh(): Promise<void> { return this.list(this.index.query, this.index.offset, this.index.profile); }
  async open(ref: SessionRef, offset = 0): Promise<HistoryPage | undefined> {
    if (this.disposed) return;
    const epoch = ++this.historyEpoch;
    this.historyAbort?.abort(); this.historyAbort = new AbortController();
    // Clear the old selection immediately: stale content is never labelled with the new ID.
    this.history = { phase: 'loading', requested: { ...ref } }; this.publish();
    try {
      const page = await this.dashboard.sessionMessages(ref, offset, this.historyAbort.signal);
      if (this.disposed || epoch !== this.historyEpoch) return;
      this.history = { phase: 'ready', requested: { ...ref }, page }; this.publish(); return page;
    } catch (error) {
      if (this.disposed || epoch !== this.historyEpoch) return;
      const safe = failure(error);
      this.history = { phase: 'error', requested: { ...ref }, error: safe };
      if (safe.kind === 'auth-required') this.onAuthFailure?.(safe);
      this.publish(); return undefined;
    }
  }
  clearHistory(): void {
    ++this.historyEpoch; this.historyAbort?.abort(); this.history = { phase: 'empty' }; this.publish();
  }
  clear(): void {
    ++this.listEpoch; this.listAbort?.abort(); this.clearHistory();
    this.index = { phase: 'empty', rows: [], query: '', offset: 0, total: 0, hasNext: false }; this.publish();
  }
  dispose(): void { this.disposed = true; this.clear(); this.listeners.clear(); }
}
