import { ClientError, record } from './protocol.js';
import { effortValue, modelCatalogue, profileCatalogue, type ModelCatalogue, type ProfileChoice, type Effort } from './model-catalog.js';
import type { Availability } from './capabilities.js';
interface Rpc { call(method: string, params?: Record<string, unknown>): Promise<unknown> }
export interface CatalogueState {
  models?: ModelCatalogue;
  profiles: ProfileChoice[];
  effort?: Effort;
  loading: boolean;
  modelError?: string;
  profileError?: string;
}
function failure(error: unknown): { message: string; state: Availability } {
  if (error instanceof ClientError && error.rpcCode === -32601)
    return { message: 'Not supported by this Hermes version.', state: 'unavailable' };
  if (error instanceof ClientError && error.kind === 'forbidden')
    return { message: 'Hermes denied access to these settings.', state: 'forbidden' };
  return { message: 'Could not read these settings from Hermes. Reconnect or retry.', state: 'unknown' };
}
/** Read-only, disposable native inventory. Selection/generation changes discard late replies. */
export class AgentCatalogue {
  state: CatalogueState = { profiles: [], loading: false };
  private epoch = 0;
  private revision = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly rpc: Rpc,
    private readonly evidence: (name: 'models' | 'profiles' | 'reasoning', state: Availability) => void = () => {}) {}
  getSnapshot = () => this.revision;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<CatalogueState>) {
    this.state = { ...this.state, ...patch }; this.revision++; for (const fn of this.listeners) fn();
  }
  clear(): void { ++this.epoch; this.publish({ models: undefined, profiles: [], effort: undefined, loading: false, modelError: undefined, profileError: undefined }); }
  async load(context: { runtimeId?: string; profile?: string } = {}, refresh = false): Promise<void> {
    const epoch = ++this.epoch;
    const params = { ...(context.runtimeId ? { session_id: context.runtimeId } : {}), ...(context.profile ? { profile: context.profile } : {}) };
    this.publish({ loading: true, models: undefined, profiles: [], effort: undefined, modelError: undefined, profileError: undefined });
    await Promise.all([
      this.rpc.call('model.options', { ...params, refresh }).then(input => {
        if (epoch !== this.epoch) return;
        const models = modelCatalogue(input); this.publish({ models }); this.evidence('models', 'available');
        const current = models.choices.find(row => row.model === models.model && row.provider === models.provider);
        this.evidence('reasoning', current?.reasoning === true ? 'available' : current?.reasoning === false ? 'unavailable' : 'unknown');
      }).catch(error => {
        if (epoch !== this.epoch) return;
        const problem = failure(error); this.publish({ modelError: problem.message }); this.evidence('models', problem.state);
      }),
      this.rpc.call('profiles.list', { include_sessions: false }).then(input => {
        if (epoch !== this.epoch) return;
        this.publish({ profiles: profileCatalogue(input) }); this.evidence('profiles', 'available');
      }).catch(error => {
        if (epoch !== this.epoch) return;
        const problem = failure(error); this.publish({ profileError: problem.message }); this.evidence('profiles', problem.state);
      }),
      this.rpc.call('config.get', { ...params, key: 'reasoning' }).then(input => {
        if (epoch === this.epoch) this.publish({ effort: effortValue(record(input).value) });
      }).catch(() => { /* Unknown effort is displayed honestly; never guess from a model name. */ }),
    ]);
    if (epoch === this.epoch) this.publish({ loading: false });
  }
  dispose(): void { ++this.epoch; this.listeners.clear(); }
}
