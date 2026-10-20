import type { DashboardClient } from './dashboard-client.js';
import { ClientError } from './protocol.js';
import type { McpServer } from './mcp.js';

export interface McpState {
  phase: 'empty' | 'loading' | 'ready' | 'error';
  /** Profile these rows belong to. A profile switch clears them before the new read starts. */
  profile?: string;
  rows: McpServer[];
  /** Last good list is kept for the same profile when a refresh fails. */
  stale: boolean;
  error?: ClientError;
}
function failure(error: unknown): ClientError {
  return error instanceof ClientError ? error : new ClientError('protocol', 'MCP request failed');
}

/** Profile-scoped, read-only MCP server list. Superseded responses never reach the state. */
export class McpBrowser {
  state: McpState = { phase: 'empty', rows: [], stale: false };
  private epoch = 0;
  private abort?: AbortController;
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(private readonly dashboard: Pick<DashboardClient, 'mcpServers'>, private readonly onAuthFailure?: (error: ClientError) => void) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener); listener(); return () => { this.listeners.delete(listener); };
  }
  private publish(): void { if (!this.disposed) for (const listener of this.listeners) listener(); }
  async load(profile?: string): Promise<void> {
    if (this.disposed) return;
    const epoch = ++this.epoch;
    this.abort?.abort(); this.abort = new AbortController();
    const sameProfile = this.state.profile === profile;
    this.state = sameProfile ? { ...this.state, phase: 'loading' } : { phase: 'loading', profile, rows: [], stale: false };
    this.publish();
    try {
      const rows = await this.dashboard.mcpServers(profile, this.abort.signal);
      if (this.disposed || epoch !== this.epoch) return;
      this.state = { phase: 'ready', profile, rows, stale: false };
    } catch (error) {
      if (this.disposed || epoch !== this.epoch) return;
      const safe = failure(error);
      this.state = { phase: 'error', profile, rows: sameProfile ? this.state.rows : [], stale: sameProfile && this.state.rows.length > 0, error: safe };
      if (safe.kind === 'auth-required') this.onAuthFailure?.(safe);
    }
    this.publish();
  }
  dispose(): void { this.disposed = true; ++this.epoch; this.abort?.abort(); this.listeners.clear(); }
}
