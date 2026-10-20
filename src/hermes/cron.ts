import { ClientError, record } from './protocol.js';
import { safeText } from './safe-text.js';

/**
 * Projections of Hermes cron routes (hermes_cli/web_routers/cron.py, cron/jobs.py). Wire contract:
 * NousResearch/hermes-agent c5a3c0f8767a72203363d249add14142dbcf3cc7.
 * Dropped on purpose: prompt, script, base_url, monitor_url, workdir, model/provider, deliver targets,
 * enabled toolsets, origin, and the latest_execution ledger. They can hold paths, URLs or credentials,
 * and the Management view only needs status and scheduling.
 */
export const CRON_JOB_LIMIT = 500;
export const CRON_RUN_LIMIT = 100;
export const CRON_ACTIONS = ['pause', 'resume', 'trigger'] as const;
export type CronActionKind = (typeof CRON_ACTIONS)[number];
export type CronJobState = 'scheduled' | 'paused' | 'completed' | 'error' | 'unknown';
const STATES: readonly CronJobState[] = ['scheduled', 'paused', 'completed', 'error'];

export interface CronFailure { at?: number; detail: string }
export interface CronJob {
  id: string; name: string; profile: string; schedule: string; state: CronJobState; enabled: boolean;
  /** Epoch milliseconds. Undefined when Hermes has no next run (paused, completed, or unknown). */
  nextRunAt?: number; lastRunAt?: number; lastStatus: string; lastError: string; failureStreak: number;
  lastFailure?: CronFailure; noAgent: boolean; repeat: { total?: number; completed: number }; pausedReason: string;
}
export interface CronRun { id: string; title: string; preview: string; startedAt?: number; endedAt?: number; active: boolean }

export function cronJobId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) throw new ClientError('protocol', 'Unsupported Hermes job id');
  return value;
}

/** Hermes stores timestamps as ISO strings or as epoch seconds (float). Both become epoch milliseconds. */
function time(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}
function objectOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function cronJob(input: unknown): CronJob {
  const row = record(input);
  const id = cronJobId(typeof row.id === 'string' ? row.id : '');
  const state = typeof row.state === 'string' && (STATES as readonly string[]).includes(row.state) ? row.state as CronJobState : 'unknown';
  const failure = objectOrEmpty(row.last_failure);
  const hasFailure = typeof row.last_failure === 'object' && row.last_failure !== null && !Array.isArray(row.last_failure);
  const repeat = objectOrEmpty(row.repeat);
  const total = typeof repeat.times === 'number' && Number.isSafeInteger(repeat.times) && repeat.times >= 0 ? repeat.times : undefined;
  return {
    id,
    name: safeText(row.name, 200) || id,
    profile: safeText(row.profile_name ?? row.profile, 128),
    schedule: safeText(row.schedule_display, 200),
    state,
    enabled: row.enabled !== false,
    nextRunAt: time(row.next_run_at),
    lastRunAt: time(row.last_run_at),
    lastStatus: safeText(row.last_status, 64),
    lastError: safeText(row.last_error, 1024),
    failureStreak: count(row.failure_streak),
    lastFailure: hasFailure ? { at: time(failure.at), detail: safeText(failure.detail, 1024) } : undefined,
    noAgent: row.no_agent === true,
    repeat: { total, completed: count(repeat.completed) },
    pausedReason: safeText(row.paused_reason, 256),
  };
}

/** The upstream list is a bare JSON array. A malformed row fails the whole page, as skills do. */
export function cronJobList(input: unknown): CronJob[] {
  if (!Array.isArray(input) || input.length > CRON_JOB_LIMIT) throw new ClientError('protocol', 'Invalid Hermes cron job list');
  return input.map(cronJob);
}

/** `GET /api/cron/jobs/{id}/runs` returns `{runs, limit}`, newest first. */
export function cronRunPage(input: unknown): CronRun[] {
  const data = record(input);
  if (!Array.isArray(data.runs) || data.runs.length > CRON_RUN_LIMIT) throw new ClientError('protocol', 'Invalid Hermes cron run history');
  return data.runs.map((item: unknown) => {
    const row = record(item);
    const id = safeText(row.id, 256);
    if (!id.trim()) throw new ClientError('protocol', 'Hermes cron run omitted an id');
    return {
      id,
      title: safeText(row.title, 256) || 'Run',
      preview: safeText(row.preview, 512),
      startedAt: time(row.started_at),
      endedAt: time(row.ended_at),
      active: row.is_active === true,
    };
  });
}
