import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeText } from '../../src/hermes/safe-text.js';
import { memoryStatus, MEMORY_PROVIDER_LIMIT } from '../../src/hermes/memory.js';
import { cronJob, cronJobId, cronJobList, cronRunPage, CRON_JOB_LIMIT, CRON_RUN_LIMIT, type CronRun } from '../../src/hermes/cron.js';
import { CronBrowser, actionFailureMessage } from '../../src/hermes/cron-browser.js';
import type { CronActionKind } from '../../src/hermes/cron.js';
import { MemoryBrowser } from '../../src/hermes/memory-browser.js';
import { CapabilitiesStore } from '../../src/hermes/capabilities.js';
import { ClientError } from '../../src/hermes/protocol.js';
import { HttpError } from '../../src/hermes/dashboard-client.js';

const SECRET = 'FIXTURE_SECRET_VALUE_123';

test('safe text removes control characters and redacts credential-looking pairs and bearer tokens', () => {
  assert.equal(safeText('ok\u0007 done', 50), 'ok done');
  assert.equal(safeText(`api_key=${SECRET}`, 100), 'api_key=[redacted]');
  assert.equal(safeText(`token: ${SECRET} rest`, 100), 'token: [redacted] rest');
  assert.equal(safeText(`Authorization: Bearer ${SECRET}`, 100).includes(SECRET), false);
  assert.equal(safeText('sk-abcdefghijklmnop', 100), '[redacted]');
  assert.equal(safeText('x'.repeat(40), 10).length, 10);
  assert.equal(safeText(42, 10), '');
});

test('memory projection keeps display fields and drops provider setup, env and config material', () => {
  const status = memoryStatus({
    active: 'honcho', builtin_files: { memory: 2048, user: -1 },
    providers: [{ name: 'honcho', description: 'Long-term model', available: true, configured: true, status: 'ready',
      env: { HONCHO_API_KEY: SECRET }, config: { api_key: SECRET }, setup: { required_env: ['HONCHO_API_KEY'], pip_dependencies: ['x'] } },
    { name: 'weird', status: 'exploding', available: 'yes' }],
  });
  assert.deepEqual(status.providers[0], { name: 'honcho', description: 'Long-term model', available: true, configured: true, status: 'ready' });
  assert.deepEqual(status.providers[1], { name: 'weird', description: '', available: false, configured: false, status: 'unknown' });
  assert.deepEqual(status.builtinFiles, { memory: 2048, user: 0 });
  assert.equal(JSON.stringify(status).includes(SECRET), false);
  assert.equal(JSON.stringify(status).includes('HONCHO_API_KEY'), false);
});

test('memory projection fails closed on malformed or oversize payloads', () => {
  assert.throws(() => memoryStatus({ active: 'x' }), ClientError);
  assert.throws(() => memoryStatus({ providers: [{ description: 'nameless' }] }), ClientError);
  assert.throws(() => memoryStatus({ providers: Array.from({ length: MEMORY_PROVIDER_LIMIT + 1 }, () => ({ name: 'p' })) }), ClientError);
});

const upstreamJob = {
  id: 'a1b2c3d4e5f6', name: 'backup-check', prompt: 'do the thing', script: '/srv/x.sh', base_url: 'https://u:pw@example.test',
  workdir: '/srv/work', deliver: 'telegram:123', model: 'm', profile_name: 'default', schedule_display: 'every 6h',
  enabled: true, state: 'scheduled', next_run_at: '2026-10-21T00:00:00+00:00', last_run_at: 1760950800.5, last_status: 'error',
  last_error: `Delivery failed: api_key=${SECRET}`, last_failure: { at: 1760950800, detail: `Bearer ${SECRET}` },
  failure_streak: 3, no_agent: true, repeat: { times: 4, completed: 1 }, paused_reason: null,
};

test('cron job projection drops prompt, script, URLs, workdir and delivery targets, and redacts errors', () => {
  const job = cronJob(upstreamJob);
  assert.deepEqual(Object.keys(job).sort(), ['failureStreak', 'enabled', 'id', 'lastError', 'lastFailure', 'lastRunAt', 'lastStatus',
    'name', 'nextRunAt', 'noAgent', 'pausedReason', 'profile', 'repeat', 'schedule', 'state'].sort());
  assert.equal(job.nextRunAt, Date.parse('2026-10-21T00:00:00+00:00'));
  assert.equal(job.lastRunAt, 1760950800500);
  assert.equal(job.lastError, 'Delivery failed: api_key=[redacted]');
  assert.equal(job.lastFailure?.detail, 'Bearer [redacted]');
  assert.deepEqual(job.repeat, { total: 4, completed: 1 });
  const serialized = JSON.stringify(cronJobList([upstreamJob]));
  for (const forbidden of ['do the thing', '/srv/', 'pw@example', 'telegram:123', SECRET]) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test('cron projection tolerates legacy nulls and rejects unusable identifiers and oversize pages', () => {
  const job = cronJob({ id: 'legacy1', name: null, state: 'mystery', last_failure: 'string', repeat: 7 });
  assert.equal(job.name, 'legacy1'); assert.equal(job.state, 'unknown'); assert.equal(job.lastFailure, undefined);
  assert.equal(job.enabled, true); assert.equal(job.nextRunAt, undefined);
  assert.throws(() => cronJobId('../etc'), ClientError);
  assert.throws(() => cronJobId('a/b'), ClientError);
  assert.throws(() => cronJobList({ jobs: [] }), ClientError);
  assert.throws(() => cronJobList(Array.from({ length: CRON_JOB_LIMIT + 1 }, () => upstreamJob)), ClientError);
});

test('cron run projection bounds previews and drops token and model accounting', () => {
  const runs = cronRunPage({ limit: 20, runs: [{ id: 'run-1', title: 'FAILED · Backup', preview: 'x'.repeat(2000), started_at: 1760950800,
    ended_at: null, is_active: false, model: 'm', input_tokens: 99, output_tokens: 12, cwd: '/srv' }] });
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.preview.length, 512);
  assert.equal(runs[0]!.startedAt, 1760950800000);
  assert.equal(runs[0]!.endedAt, undefined);
  assert.equal(JSON.stringify(runs).includes('/srv'), false);
  assert.throws(() => cronRunPage({ runs: [{ title: 'no id' }] }), ClientError);
  assert.throws(() => cronRunPage({ runs: Array.from({ length: CRON_RUN_LIMIT + 1 }, () => ({ id: 'r' })) }), ClientError);
});

test('capabilities: cron list needs detail and runs too, and actions need POST routes plus a mode that permits writes', () => {
  const full = { openapi: '3.1.0', paths: {
    '/api/memory': { get: {} }, '/api/cron/jobs': { get: {} }, '/api/cron/jobs/{job_id}': { get: {} }, '/api/cron/jobs/{job_id}/runs': { get: {} },
    '/api/cron/jobs/{job_id}/pause': { post: {} }, '/api/cron/jobs/{job_id}/resume': { post: {} }, '/api/cron/jobs/{job_id}/trigger': { post: {} } } };
  const store = new CapabilitiesStore();
  store.applySchema(store.begin(), full, true);
  const snap = store.snapshot();
  assert.equal(snap.memory.state, 'available'); assert.equal(snap.cronJobs.state, 'available'); assert.equal(snap.cronActions.state, 'available');

  const trusted = new CapabilitiesStore(); trusted.applySchema(trusted.begin(), full, false);
  assert.equal(trusted.snapshot().cronActions.state, 'unavailable');
  assert.equal(trusted.snapshot().cronJobs.state, 'available');

  const noRuns = structuredClone(full); delete (noRuns.paths as Record<string, unknown>)['/api/cron/jobs/{job_id}/runs'];
  const partial = new CapabilitiesStore(); partial.applySchema(partial.begin(), noRuns, true);
  assert.equal(partial.snapshot().cronJobs.state, 'unavailable');

  const onlyGetActions = structuredClone(full); (onlyGetActions.paths as Record<string, Record<string, unknown>>)['/api/cron/jobs/{job_id}/pause'] = { get: {} };
  const getOnly = new CapabilitiesStore(); getOnly.applySchema(getOnly.begin(), onlyGetActions, true);
  assert.equal(getOnly.snapshot().cronActions.state, 'unavailable');

  const failed = new CapabilitiesStore(); failed.schemaFailed(failed.begin(), new HttpError(403));
  assert.equal(failed.snapshot().cronActions.state, 'forbidden');
  assert.equal(failed.snapshot().memory.state, 'forbidden');
});

type Fake = {
  calls: string[];
  jobs: Record<string, unknown>[];
  cronJobs(profile?: string): Promise<CronJobRow[]>;
  cronJob(id: string, profile?: string): Promise<CronJobRow>;
  cronRuns(): Promise<CronRun[]>;
  cronAction(kind: CronActionKind, id: string, profile?: string): Promise<CronJobRow>;
};
type CronJobRow = ReturnType<typeof cronJob>;

function fakeDashboard(options: { action?: () => Promise<unknown>; reread?: () => Promise<unknown>; runs?: () => Promise<unknown> } = {}): Fake {
  const calls: string[] = [];
  const base = cronJob(upstreamJob);
  let enabled = true;
  const view = (): CronJobRow => ({ ...base, enabled, state: enabled ? 'scheduled' : 'paused' });
  return {
    calls, jobs: [],
    async cronJobs(profile) { calls.push(`list:${profile}`); return [view()]; },
    async cronJob(id, profile) { calls.push(`read:${id}:${profile}`); await options.reread?.(); return view(); },
    async cronRuns() { calls.push('runs'); await options.runs?.(); return []; },
    async cronAction(kind: CronActionKind, id, profile) { calls.push(`${kind}:${id}:${profile}`); await options.action?.(); enabled = kind !== 'pause'; return view(); },
  };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('cron browser: a second action is refused while one is pending, and the job is re-read after success', async () => {
  const dash = fakeDashboard({ action: async () => { await tick(); } });
  const browser = new CronBrowser(dash);
  await browser.load('default');
  const first = browser.runAction('pause', 'a1b2c3d4e5f6');
  assert.equal(browser.action.phase, 'pending');
  assert.equal(await browser.runAction('trigger', 'a1b2c3d4e5f6'), false);
  assert.equal(await first, true);
  assert.deepEqual(dash.calls.filter(call => call.startsWith('pause') || call.startsWith('trigger')), ['pause:a1b2c3d4e5f6:default']);
  assert.equal(browser.action.phase, 'done');
  assert.equal(dash.calls.at(-1), 'read:a1b2c3d4e5f6:default');
  assert.equal(browser.list.rows[0]!.enabled, false);
});

test('cron browser: an unknown outcome is never retried and asks for a refresh', async () => {
  const dash = fakeDashboard({ action: async () => { throw new ClientError('network', 'socket closed'); } });
  const browser = new CronBrowser(dash);
  await browser.load('default');
  await browser.runAction('trigger', 'a1b2c3d4e5f6');
  assert.equal(dash.calls.filter(call => call.startsWith('trigger')).length, 1);
  assert.equal(browser.action.phase, 'unknown');
  assert.match(browser.action.message ?? '', /outcome is unknown.*Nothing was retried/);
  assert.equal(dash.calls.at(-1), 'read:a1b2c3d4e5f6:default');
});

test('cron browser: documented HTTP refusals get specific copy and are not treated as unknown', async () => {
  assert.equal(actionFailureMessage(new HttpError(409)).unknown, false);
  assert.match(actionFailureMessage(new HttpError(409)).message, /already running/);
  assert.match(actionFailureMessage(new HttpError(404)).message, /no longer exists/);
  assert.equal(actionFailureMessage(new ClientError('timeout', 'slow')).unknown, true);
  assert.equal(actionFailureMessage(new HttpError(502)).unknown, true);
  const dash = fakeDashboard({ action: async () => { throw new HttpError(409); } });
  const browser = new CronBrowser(dash);
  await browser.load('default');
  await browser.runAction('trigger', 'a1b2c3d4e5f6');
  assert.equal(browser.action.phase, 'failed');
});

test('cron browser: a profile switch while an action is pending drops the result and the open job', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const dash = fakeDashboard({ action: async () => { await gate; } });
  const browser = new CronBrowser(dash);
  await browser.load('default');
  await browser.open('a1b2c3d4e5f6');
  const pending = browser.runAction('pause', 'a1b2c3d4e5f6');
  await browser.load('work');
  assert.equal(browser.detail.phase, 'empty');
  assert.equal(browser.action.phase, 'idle');
  release(); await pending;
  assert.equal(browser.action.phase, 'idle');
  assert.equal(browser.detail.phase, 'empty');
});

test('cron browser: a failed runs read keeps the job visible and reports only the runs error', async () => {
  const dash = fakeDashboard({ runs: async () => { throw new ClientError('network', 'down'); } });
  const browser = new CronBrowser(dash);
  await browser.load('default');
  await browser.open('a1b2c3d4e5f6');
  assert.equal(browser.detail.phase, 'ready');
  assert.equal(browser.detail.job?.name, 'backup-check');
  assert.equal(browser.detail.runsError?.kind, 'network');
});

test('cron browser: a failed refresh keeps rows for the same profile as stale and clears them across profiles', async () => {
  let fail = false;
  const dash = fakeDashboard();
  dash.cronJobs = async (profile) => { if (fail) throw new ClientError('network', 'offline'); return [cronJob(upstreamJob)].map(job => ({ ...job, profile: profile ?? '' })); };
  const browser = new CronBrowser(dash);
  await browser.load('default');
  fail = true; await browser.load('default');
  assert.equal(browser.list.phase, 'error'); assert.equal(browser.list.stale, true); assert.equal(browser.list.rows.length, 1);
  await browser.load('work');
  assert.equal(browser.list.rows.length, 0);
  assert.equal(browser.list.stale, false);
});

test('memory browser: a refresh failure keeps the last status for the same profile only', async () => {
  let fail = false;
  const status = memoryStatus({ active: '', providers: [], builtin_files: { memory: 1, user: 2 } });
  const browser = new MemoryBrowser({ memory: async () => { if (fail) throw new ClientError('network', 'offline'); return status; } });
  await browser.load('default');
  fail = true; await browser.load('default');
  assert.equal(browser.state.stale, true); assert.deepEqual(browser.state.status, status);
  fail = false; await browser.load('work');
  assert.equal(browser.state.status, status);
  assert.equal(browser.state.stale, false);
});
