import type { DashboardClient } from './dashboard-client.js';
import { ClientError } from './protocol.js';
import type { HermesHealth, HermesStatus, SystemStats } from './hermes-status.js';

/** Each section succeeds or fails on its own. A failed section never blanks the others. */
export interface DiagnosticsSection<T> { value?: T; error?: ClientError; stale: boolean }
export interface DiagnosticsState {
  phase: 'empty' | 'loading' | 'ready';
  /** Profile for the gateway status. A switch clears every section before the new read starts. */
  profile?: string;
  status: DiagnosticsSection<HermesStatus>;
  health: DiagnosticsSection<HermesHealth>;
  stats: DiagnosticsSection<SystemStats>;
}
const empty = <T>(): DiagnosticsSection<T> => ({ stale: false });
function failure(error: unknown): ClientError {
  return error instanceof ClientError ? error : new ClientError('protocol', 'Diagnostics request failed');
}
/** Keep the last good value for the same profile when a refresh fails, marked stale. */
function keep<T>(previous: DiagnosticsSection<T>, error: unknown, same: boolean): DiagnosticsSection<T> {
  return { value: same ? previous.value : undefined, stale: same && previous.value !== undefined, error: failure(error) };
}

export class DiagnosticsBrowser {
  state: DiagnosticsState = { phase: 'empty', status: empty(), health: empty(), stats: empty() };
  private epoch = 0;
  private abort?: AbortController;
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(private readonly dashboard: Pick<DashboardClient, 'hermesStatus' | 'hermesHealth' | 'systemStats'>,
    private readonly onAuthFailure?: (error: ClientError) => void) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener); listener(); return () => { this.listeners.delete(listener); };
  }
  private publish(): void { if (!this.disposed) for (const listener of this.listeners) listener(); }
  /** `stats` is false when Hermes does not advertise `/api/system/stats`: that section is then not requested at all. */
  async load(profile?: string, withStats = true): Promise<void> {
    if (this.disposed) return;
    const epoch = ++this.epoch;
    this.abort?.abort(); this.abort = new AbortController();
    const signal = this.abort.signal;
    const same = this.state.profile === profile;
    const prior = this.state;
    this.state = { phase: 'loading', profile, status: same ? prior.status : empty(), health: same ? prior.health : empty(), stats: same ? prior.stats : empty() };
    this.publish();
    const [status, health, stats] = await Promise.allSettled([
      this.dashboard.hermesStatus(profile, signal),
      this.dashboard.hermesHealth(signal),
      withStats ? this.dashboard.systemStats(signal) : Promise.resolve(undefined as never),
    ]);
    if (this.disposed || epoch !== this.epoch) return;
    // An unrequested section is empty and error-free: the UI hides it, it is not a failure.
    const pick = <T>(result: PromiseSettledResult<T>, old: DiagnosticsSection<T>): DiagnosticsSection<T> =>
      result.status === 'fulfilled' ? { value: result.value, stale: false } : keep(old, result.reason, same);
    this.state = {
      phase: 'ready', profile,
      status: pick(status, prior.status), health: pick(health, prior.health), stats: pick(stats, prior.stats),
    };
    for (const result of [status, health, stats]) {
      if (result.status === 'rejected' && failure(result.reason).kind === 'auth-required') { this.onAuthFailure?.(failure(result.reason)); break; }
    }
    this.publish();
  }
  dispose(): void { this.disposed = true; ++this.epoch; this.abort?.abort(); this.listeners.clear(); }
}
