import type { DashboardClient } from './dashboard-client.js';
import { HttpError } from './dashboard-client.js';
import { ClientError } from './protocol.js';
import type { CronActionKind, CronJob, CronRun } from './cron.js';

type Reader = Pick<DashboardClient, 'cronJobs' | 'cronJob' | 'cronRuns' | 'cronAction'>;
export interface CronListState {
  phase: 'empty' | 'loading' | 'ready' | 'error';
  profile?: string;
  rows: CronJob[];
  stale: boolean;
  error?: ClientError;
}
export interface CronDetailState {
  phase: 'empty' | 'loading' | 'ready' | 'error';
  jobId?: string;
  job?: CronJob;
  runs: CronRun[];
  error?: ClientError;
  runsError?: ClientError;
}
/**
 * `pending` blocks every action button (single-flight across all jobs) until the job is re-read.
 * `unknown` means the request may have reached Hermes: nothing is retried and the user must refresh.
 */
export interface CronActionState {
  phase: 'idle' | 'pending' | 'done' | 'failed' | 'unknown';
  kind?: CronActionKind;
  jobId?: string;
  message?: string;
}

export const ACTION_LABELS: Record<CronActionKind, { verb: string; done: string }> = {
  pause: { verb: 'Pause', done: 'Paused.' },
  resume: { verb: 'Resume', done: 'Resumed.' },
  trigger: { verb: 'Run now', done: 'Run started. Check the run history for the outcome.' },
};

function failure(error: unknown): ClientError {
  return error instanceof ClientError ? error : new ClientError('protocol', 'Cron request failed');
}
/** Maps an action failure to honest copy. Only status codes Hermes documents for these routes are named. */
export function actionFailureMessage(error: ClientError): { message: string; unknown: boolean } {
  const status = error instanceof HttpError ? error.status : undefined;
  if (status === 404) return { message: 'This job no longer exists in Hermes. Refresh the list.', unknown: false };
  if (status === 409) return { message: 'Hermes did not run this job: it is already running or was claimed by another scheduler.', unknown: false };
  if (status === 401) return { message: 'Sign in to Hermes again, then retry.', unknown: false };
  if (status === 403) return { message: 'Hermes refused this action.', unknown: false };
  if (status !== undefined && status < 500) return { message: 'Hermes rejected this action.', unknown: false };
  // Network, timeout, 5xx: the request may have been applied. Never retried automatically.
  return { message: 'The outcome is unknown: the connection failed or Hermes did not answer. Nothing was retried. Refresh the job to check its state before acting again.', unknown: true };
}

/**
 * Profile-scoped cron view. Every async result is checked against an epoch, so an older profile or job can never
 * overwrite the current selection. Actions are single-flight and never retried; the job is re-read afterwards.
 */
export class CronBrowser {
  list: CronListState = { phase: 'empty', rows: [], stale: false };
  detail: CronDetailState = { phase: 'empty', runs: [] };
  action: CronActionState = { phase: 'idle' };
  private listEpoch = 0;
  private detailEpoch = 0;
  private actionEpoch = 0;
  private listAbort?: AbortController;
  private detailAbort?: AbortController;
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(private readonly dashboard: Reader, private readonly onAuthFailure?: (error: ClientError) => void) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener); listener(); return () => { this.listeners.delete(listener); };
  }
  private publish(): void { if (!this.disposed) for (const listener of this.listeners) listener(); }
  async load(profile: string): Promise<void> {
    if (this.disposed) return;
    const epoch = ++this.listEpoch;
    this.listAbort?.abort(); this.listAbort = new AbortController();
    const sameProfile = this.list.profile === profile;
    if (!sameProfile) {
      // Profile is an isolation boundary: drop the previous profile's jobs, detail and action state.
      this.resetJobState();
      this.list = { phase: 'loading', profile, rows: [], stale: false };
    } else this.list = { ...this.list, phase: 'loading' };
    this.publish();
    try {
      const rows = await this.dashboard.cronJobs(profile, this.listAbort.signal);
      if (this.disposed || epoch !== this.listEpoch) return;
      this.list = { phase: 'ready', profile, rows, stale: false };
    } catch (error) {
      if (this.disposed || epoch !== this.listEpoch) return;
      const safe = failure(error);
      this.list = { phase: 'error', profile, rows: sameProfile ? this.list.rows : [], stale: sameProfile && this.list.rows.length > 0, error: safe };
      if (safe.kind === 'auth-required') this.onAuthFailure?.(safe);
    }
    this.publish();
  }
  private resetJobState(): void {
    ++this.detailEpoch; this.detailAbort?.abort();
    ++this.actionEpoch;
    this.detail = { phase: 'empty', runs: [] };
    this.action = { phase: 'idle' };
  }
  /** Reads the job and its bounded run history. A runs failure leaves the job visible. */
  async open(jobId: string): Promise<void> {
    if (this.disposed) return;
    const profile = this.list.profile;
    if (!profile) return;
    const epoch = ++this.detailEpoch;
    this.detailAbort?.abort(); this.detailAbort = new AbortController();
    const signal = this.detailAbort.signal;
    this.detail = { phase: 'loading', jobId, runs: [] }; this.publish();
    const [job, runs] = await Promise.allSettled([
      this.dashboard.cronJob(jobId, profile, signal),
      this.dashboard.cronRuns(jobId, profile, 20, signal),
    ]);
    if (this.disposed || epoch !== this.detailEpoch || profile !== this.list.profile) return;
    if (job.status === 'rejected') {
      const safe = failure(job.reason);
      this.detail = { phase: 'error', jobId, runs: [], error: safe };
      if (safe.kind === 'auth-required') this.onAuthFailure?.(safe);
    } else {
      this.detail = {
        phase: 'ready', jobId, job: job.value, runs: runs.status === 'fulfilled' ? runs.value : [],
        runsError: runs.status === 'rejected' ? failure(runs.reason) : undefined,
      };
    }
    this.publish();
  }
  closeDetail(): void {
    ++this.detailEpoch; this.detailAbort?.abort();
    this.detail = { phase: 'empty', runs: [] }; this.publish();
  }
  /** Returns false (and does nothing) while any action is pending, so a double tap cannot send two requests. */
  async runAction(kind: CronActionKind, jobId: string): Promise<boolean> {
    if (this.disposed || this.action.phase === 'pending') return false;
    const profile = this.list.profile;
    if (!profile) return false;
    const epoch = ++this.actionEpoch;
    this.action = { phase: 'pending', kind, jobId }; this.publish();
    let settled: CronActionState;
    try {
      await this.dashboard.cronAction(kind, jobId, profile);
      settled = { phase: 'done', kind, jobId, message: ACTION_LABELS[kind].done };
    } catch (error) {
      const safe = failure(error);
      const outcome = actionFailureMessage(safe);
      settled = { phase: outcome.unknown ? 'unknown' : 'failed', kind, jobId, message: outcome.message };
      if (safe.kind === 'auth-required') this.onAuthFailure?.(safe);
    }
    // The button stays disabled while the job is re-read. The action itself is never repeated.
    await this.reread(jobId, profile, epoch, settled);
    return true;
  }
  private async reread(jobId: string, profile: string, epoch: number, settled: CronActionState): Promise<void> {
    if (this.disposed || epoch !== this.actionEpoch) return;
    try {
      const job = await this.dashboard.cronJob(jobId, profile);
      if (this.disposed || epoch !== this.actionEpoch || profile !== this.list.profile) return;
      if (this.detail.jobId === jobId) this.detail = { ...this.detail, job };
      this.list = { ...this.list, rows: this.list.rows.map(row => row.id === jobId ? job : row) };
      this.action = settled;
    } catch (error) {
      if (this.disposed || epoch !== this.actionEpoch || profile !== this.list.profile) return;
      const safe = failure(error);
      this.action = { phase: 'unknown', kind: settled.kind, jobId,
        message: `${settled.message ?? 'Hermes did not confirm this action.'} The job could not be re-read (${safe.message}). Refresh before acting again.` };
    }
    this.publish();
  }
  dismissAction(): void {
    if (this.action.phase === 'pending') return;
    this.action = { phase: 'idle' }; this.publish();
  }
  dispose(): void {
    this.disposed = true; ++this.listEpoch; ++this.detailEpoch; ++this.actionEpoch;
    this.listAbort?.abort(); this.detailAbort?.abort(); this.listeners.clear();
  }
}
