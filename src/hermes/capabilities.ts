import { HttpError } from './dashboard-client.js';
import { ClientError, record } from './protocol.js';
import type { Phase } from './gateway-client.js';
export type Availability = 'unknown' | 'available' | 'unavailable' | 'requires-configuration' |
  'unreachable' | 'forbidden' | 'auth-required';
const REST = {
  sessionsList: '/api/sessions', sessionsSearch: '/api/sessions/search',
  profiles: '/api/profiles', models: '/api/model/options',
} as const;
export type Feature = keyof typeof REST | 'gateway' | 'heartbeat' | 'changeEvents' | 'workspace' | 'pwa';
export interface Capability { state: Availability; evidence: 'unverified' | 'gateway' | 'schema' | 'webui'; implemented: boolean }
export type CapabilityMap = Record<Feature, Capability>;
function initial(): CapabilityMap {
  return Object.fromEntries(
    ['gateway', 'heartbeat', 'changeEvents', ...Object.keys(REST), 'workspace', 'pwa'].map((name) => [name, {
      state: 'unknown', evidence: 'unverified', implemented: ['gateway', 'heartbeat', 'changeEvents', 'sessionsList', 'sessionsSearch'].includes(name),
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
  applySchema(epoch: number, input: unknown): void {
    if (epoch !== this.epoch) return;
    const schema = record(input);
    if (typeof schema.openapi !== 'string' || !schema.openapi.startsWith('3.'))
      throw new ClientError('protocol', 'Unsupported API schema');
    const paths = record(schema.paths);
    for (const [name, path] of Object.entries(REST)) {
      const item = paths[path];
      const supported = typeof item === 'object' && item !== null && !Array.isArray(item) &&
        'get' in item && typeof item.get === 'object' && item.get !== null;
      this.set(name as keyof typeof REST, supported ? 'available' : 'unavailable', 'schema');
    }
    this.discovery = 'available'; this.publish();
  }
  schemaFailed(epoch: number, error: unknown): void {
    if (epoch !== this.epoch) return;
    const state: Availability = error instanceof HttpError && error.status === 401 ? 'auth-required' :
      error instanceof HttpError && error.status === 403 ? 'forbidden' :
      error instanceof ClientError && error.retryable ? 'unreachable' : 'unknown';
    // Missing introspection is not proof that individual routes are unavailable.
    for (const name of Object.keys(REST)) this.set(name as keyof typeof REST, state, 'unverified');
    this.discovery = state; this.publish();
  }
  applyWebui(epoch: number, input: unknown): void {
    if (epoch !== this.epoch) return;
    const data = record(input);
    if (data.schemaVersion !== 1) throw new ClientError('protocol', 'Unsupported WebUI capability schema');
    const workspace = record(data.workspace); const features = record(data.features);
    this.set('workspace', workspace.available === true ? 'requires-configuration' : 'unavailable', 'webui');
    this.set('pwa', features.pwa === true ? 'available' : 'unavailable', 'webui');
    this.publish();
  }
  gateway(phase: Phase, payload: unknown = {}): void {
    const ready = phase === 'ready';
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
