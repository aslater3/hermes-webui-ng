import type { DashboardClient } from './dashboard-client.js';
import { ClientError } from './protocol.js';
import type { MemoryStatus } from './memory.js';

export interface MemoryState {
  phase: 'empty' | 'loading' | 'ready' | 'error';
  /** Profile these values belong to. A profile switch clears them before the new read starts. */
  profile?: string;
  status?: MemoryStatus;
  /** Last good status is kept for the same profile when a refresh fails. */
  stale: boolean;
  error?: ClientError;
}
function failure(error: unknown): ClientError {
  return error instanceof ClientError ? error : new ClientError('protocol', 'Memory request failed');
}

/** Profile-scoped, read-only memory status. Results from superseded requests never reach the state. */
export class MemoryBrowser {
  state: MemoryState = { phase: 'empty', stale: false };
  private epoch = 0;
  private abort?: AbortController;
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(private readonly dashboard: Pick<DashboardClient, 'memory'>, private readonly onAuthFailure?: (error: ClientError) => void) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener); listener(); return () => { this.listeners.delete(listener); };
  }
  private publish(): void { if (!this.disposed) for (const listener of this.listeners) listener(); }
  async load(profile?: string): Promise<void> {
    if (this.disposed) return;
    const epoch = ++this.epoch;
    this.abort?.abort(); this.abort = new AbortController();
    const sameProfile = this.state.profile === profile;
    this.state = sameProfile ? { ...this.state, phase: 'loading' } : { phase: 'loading', profile, stale: false };
    this.publish();
    try {
      const status = await this.dashboard.memory(profile, this.abort.signal);
      if (this.disposed || epoch !== this.epoch) return;
      this.state = { phase: 'ready', profile, status, stale: false };
    } catch (error) {
      if (this.disposed || epoch !== this.epoch) return;
      const safe = failure(error);
      this.state = { phase: 'error', profile, status: sameProfile ? this.state.status : undefined, stale: sameProfile && !!this.state.status, error: safe };
      if (safe.kind === 'auth-required') this.onAuthFailure?.(safe);
    }
    this.publish();
  }
  dispose(): void { this.disposed = true; ++this.epoch; this.abort?.abort(); this.listeners.clear(); }
}
