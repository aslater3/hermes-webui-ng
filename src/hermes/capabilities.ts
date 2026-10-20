import { HttpError } from './dashboard-client.js';
import { ClientError, record } from './protocol.js';
import type { Phase } from './gateway-client.js';
export type Availability = 'unknown' | 'available' | 'unavailable' | 'requires-configuration' |
  'unreachable' | 'forbidden' | 'auth-required';
const REST = {
  sessionsList: '/api/sessions', sessionsSearch: '/api/sessions/search',
  profiles: '/api/profiles', models: '/api/model/options',
  skills: '/api/skills', skillContent: '/api/skills/content',
  memory: '/api/memory',
  cronJobs: '/api/cron/jobs', cronJob: '/api/cron/jobs/{job_id}', cronRuns: '/api/cron/jobs/{job_id}/runs',
} as const;
/** Operator actions on one cron job. All three must be advertised before the Cron tab offers any action. */
const CRON_ACTION_PATHS = ['/api/cron/jobs/{job_id}/pause', '/api/cron/jobs/{job_id}/resume', '/api/cron/jobs/{job_id}/trigger'] as const;
export type Feature = keyof typeof REST | 'cronActions' | 'gateway' | 'heartbeat' | 'changeEvents' | 'workspace' | 'pwa' | 'reasoning';
export interface Capability { state: Availability; evidence: 'unverified' | 'gateway' | 'schema' | 'webui' | 'rpc'; implemented: boolean }
export type CapabilityMap = Record<Feature, Capability>;
function initial(): CapabilityMap {
  return Object.fromEntries(
    ['gateway', 'heartbeat', 'changeEvents', ...Object.keys(REST), 'cronActions', 'workspace', 'pwa', 'reasoning'].map((name) => [name, {
      state: 'unknown', evidence: 'unverified', implemented: ['gateway', 'heartbeat', 'changeEvents', 'sessionsList', 'sessionsSearch', 'models', 'profiles', 'reasoning', 'pwa', 'workspace', 'skills', 'skillContent', 'memory', 'cronJobs', 'cronJob', 'cronRuns', 'cronActions'].includes(name),
    }]),
  ) as CapabilityMap;
}
/** A disposable evidence projection. An advertised route is NOT a permission/configuration check. */
export class CapabilitiesStore {
  private values = initial();
  private epoch = 0;
  private listeners = new Set<() => void>();
  discovery: Availability = 'unknown';
  begin(): number { return ++this.epoch; }
  reset(): void { ++this.epoch; this.values = initial(); this.discovery = 'unknown'; this.publish(); }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private publish() { for (const listener of this.listeners) listener(); }
  snapshot(): CapabilityMap {
    return Object.fromEntries(Object.entries(this.values).map(([key, value]) => [key, { ...value }])) as CapabilityMap;
  }
  private set(name: Feature, state: Availability, evidence: Capability['evidence']) {
    this.values[name] = { ...this.values[name], state, evidence };
  }
  /**
   * `actionsPermitted` is false in trusted-local mode, whose allowlist is GET-only. An advertised POST route is
   * therefore not enough: actions need both the OpenAPI evidence and a mode that can carry writes.
   */
  applySchema(epoch: number, input: unknown, actionsPermitted = false): void {
    if (epoch !== this.epoch) return;
    const schema = record(input);
    if (typeof schema.openapi !== 'string' || !schema.openapi.startsWith('3.'))
      throw new ClientError('protocol', 'Unsupported API schema');
    const paths = record(schema.paths);
    const advertised = (path: string, method: 'get' | 'post') => {
      const item = paths[path];
      return typeof item === 'object' && item !== null && !Array.isArray(item) &&
        method in item && typeof item[method as keyof typeof item] === 'object' && item[method as keyof typeof item] !== null;
    };
    for (const [name, path] of Object.entries(REST)) {
      if (this.values[name as Feature].evidence === 'rpc') continue;
      this.set(name as keyof typeof REST, advertised(path, 'get') ? 'available' : 'unavailable', 'schema');
    }
    // The Cron tab reads three routes; a list without detail or runs is not a usable Cron surface.
    const cronReadable = advertised(REST.cronJobs, 'get') && advertised(REST.cronJob, 'get') && advertised(REST.cronRuns, 'get');
    this.set('cronJobs', cronReadable ? 'available' : 'unavailable', 'schema');
    const cronWritable = CRON_ACTION_PATHS.every(path => advertised(path, 'post'));
    this.set('cronActions', cronWritable && actionsPermitted ? 'available' : 'unavailable', 'schema');
    this.discovery = 'available'; this.publish();
  }
  schemaFailed(epoch: number, error: unknown): void {
    if (epoch !== this.epoch) return;
    const state: Availability = error instanceof HttpError && error.status === 401 ? 'auth-required' :
      error instanceof HttpError && error.status === 403 ? 'forbidden' :
      error instanceof ClientError && error.retryable ? 'unreachable' : 'unknown';
    // Missing introspection is not proof that individual routes are unavailable.
    for (const name of Object.keys(REST)) if (this.values[name as Feature].evidence !== 'rpc') this.set(name as keyof typeof REST, state, 'unverified');
    this.set('cronActions', state, 'unverified');
    this.discovery = state; this.publish();
  }
  applyWebui(epoch: number, input: unknown): void {
    if (epoch !== this.epoch) return;
    const data = record(input);
    if (data.schemaVersion !== 1) throw new ClientError('protocol', 'Unsupported WebUI capability schema');
    const workspace = record(data.workspace); const features = record(data.features);
    this.set('workspace', workspace.available === true ? 'available' : workspace.available === false ? 'unavailable' : 'unknown', 'webui');
    this.set('pwa', features.pwa === true ? 'available' : features.pwa === false ? 'unavailable' : 'unknown', 'webui');
    this.publish();
  }
  observeNative(name: 'models' | 'profiles' | 'reasoning', state: Availability): void {
    this.set(name, state, 'rpc'); this.publish();
  }
  gateway(phase: Phase, payload: unknown = {}): void {
    const ready = phase === 'ready';
    if (!ready) for (const name of ['models', 'profiles', 'reasoning'] as const)
      if (this.values[name].evidence === 'rpc') this.set(name, 'unknown', 'unverified');
    this.set('gateway', ready ? 'available' : phase === 'auth-required' ? 'auth-required' :
      phase === 'reconnecting' ? 'unreachable' : 'unknown', ready ? 'gateway' : 'unverified');
    const data = ready ? record(payload) : {};
    for (const [name, field] of [['heartbeat', 'heartbeat'], ['changeEvents', 'change_events']] as const) {
      const flag = data[field];
      this.set(name, flag === true ? 'available' : flag === false ? 'unavailable' : 'unknown', ready ? 'gateway' : 'unverified');
    }
    this.publish();
  }
}
