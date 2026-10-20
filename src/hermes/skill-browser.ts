import type { DashboardClient } from './dashboard-client.js';
import { ClientError } from './protocol.js';
import type { SkillDocument, SkillRow } from './skills.js';

type Reader = Pick<DashboardClient, 'skills' | 'skillContent'>;
export interface SkillListState {
  phase: 'empty' | 'loading' | 'ready' | 'error';
  /** Profile these rows belong to. Rows from another profile are never displayed. */
  profile?: string;
  rows: SkillRow[];
  /** Last successful rows are kept when a refresh fails; the UI shows them as stale with the error. */
  stale: boolean;
  error?: ClientError;
}
export interface SkillDetailState {
  phase: 'empty' | 'loading' | 'ready' | 'error';
  name?: string;
  document?: SkillDocument;
  error?: ClientError;
}
function failure(error: unknown): ClientError {
  return error instanceof ClientError ? error : new ClientError('protocol', 'Skill request failed');
}

/**
 * Profile-scoped, read-only skill view state. Every async result is checked against an epoch so an
 * old profile or an older request can never overwrite the current selection. Profile changes clear rows.
 */
export class SkillBrowser {
  list: SkillListState = { phase: 'empty', rows: [], stale: false };
  detail: SkillDetailState = { phase: 'empty' };
  private listEpoch = 0;
  private detailEpoch = 0;
  private listAbort?: AbortController;
  private detailAbort?: AbortController;
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(private readonly dashboard: Reader, private readonly onAuthFailure?: (error: ClientError) => void) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener); listener(); return () => { this.listeners.delete(listener); };
  }
  private publish(): void { if (!this.disposed) for (const listener of this.listeners) listener(); }
  async load(profile?: string): Promise<void> {
    if (this.disposed) return;
    const epoch = ++this.listEpoch;
    this.listAbort?.abort(); this.listAbort = new AbortController();
    const sameProfile = this.list.profile === profile;
    if (!sameProfile) {
      // Profile is an isolation boundary: drop the previous profile's rows and open detail immediately.
      ++this.detailEpoch; this.detailAbort?.abort();
      this.detail = { phase: 'empty' };
      this.list = { phase: 'loading', profile, rows: [], stale: false };
    } else this.list = { ...this.list, phase: 'loading' };
    this.publish();
    try {
      const rows = await this.dashboard.skills(profile, this.listAbort.signal);
      if (this.disposed || epoch !== this.listEpoch) return;
      this.list = { phase: 'ready', profile, rows, stale: false };
    } catch (error) {
      if (this.disposed || epoch !== this.listEpoch) return;
      const safe = failure(error);
      // A failed refresh keeps cached rows for the same profile, labelled stale, instead of showing "no skills".
      this.list = { phase: 'error', profile, rows: sameProfile ? this.list.rows : [], stale: sameProfile && this.list.rows.length > 0, error: safe };
      if (safe.kind === 'auth-required') this.onAuthFailure?.(safe);
    }
    this.publish();
  }
  async open(name: string, profile = this.list.profile): Promise<void> {
    if (this.disposed) return;
    const epoch = ++this.detailEpoch;
    this.detailAbort?.abort(); this.detailAbort = new AbortController();
    this.detail = { phase: 'loading', name }; this.publish();
    try {
      const document = await this.dashboard.skillContent(name, profile, this.detailAbort.signal);
      if (this.disposed || epoch !== this.detailEpoch || profile !== this.list.profile) return;
      this.detail = { phase: 'ready', name, document }; this.publish();
    } catch (error) {
      if (this.disposed || epoch !== this.detailEpoch) return;
      const safe = failure(error);
      this.detail = { phase: 'error', name, error: safe };
      if (safe.kind === 'auth-required') this.onAuthFailure?.(safe);
      this.publish();
    }
  }
  closeDetail(): void { ++this.detailEpoch; this.detailAbort?.abort(); this.detail = { phase: 'empty' }; this.publish(); }
  dispose(): void {
    this.disposed = true; ++this.listEpoch; ++this.detailEpoch;
    this.listAbort?.abort(); this.detailAbort?.abort(); this.listeners.clear();
  }
}
