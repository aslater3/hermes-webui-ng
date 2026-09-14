import { ClientError, record } from './protocol.js';
import { modelCatalogue, modelChangeResult, modelSetParams, reasoningSetParams, effortValue,
  type AgentMetadata, type ModelChoice, type Effort } from './model-catalog.js';

interface Target {
  read(): { runtimeId?: string; profile?: string; idle: boolean; starting?: boolean; agent?: AgentMetadata };
  refresh(): Promise<void>;
  notify(): void;
}
interface Rpc { call(method: string, params?: Record<string, unknown>): Promise<unknown> }
export interface NativeSettingsState {
  busy: boolean;
  outcome: 'idle' | 'applied' | 'deferred' | 'unknown' | 'rejected';
  note?: string;
  confirmation?: { model: string; provider: string; message: string };
}
/** Session-owned mutation lane, independent of React. No setter is retried automatically. */
export class NativeSettings {
  state: NativeSettingsState = { busy: false, outcome: 'idle' };
  private epoch = 0;
  private pending?: { epoch: number; choice: ModelChoice; expires: number; model?: string; provider?: string };
  constructor(private readonly rpc: Rpc, private readonly target: Target) {}
  reset(): void { ++this.epoch; this.pending = undefined; this.state = { busy: false, outcome: 'idle' }; }
  cancelConfirmation(): void { this.pending = undefined; this.publish({ confirmation: undefined }); }
  private publish(patch: Partial<NativeSettingsState>): void {
    this.state = { ...this.state, ...patch }; this.target.notify();
  }
  private assertCurrent(epoch: number, id: string): void {
    if (epoch !== this.epoch || this.target.read().runtimeId !== id)
      throw new ClientError('disconnected', 'The conversation or connection changed; no setting was replayed');
  }
  /** A session can be idle before its lazy agent has been constructed. Only reads wait here. */
  private async waitForAgent(epoch: number, id: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (let attempt = 0; attempt < 100 && Date.now() < deadline; attempt++) {
      await this.target.refresh(); this.assertCurrent(epoch, id);
      const target = this.target.read();
      if (!target.idle) throw new ClientError('protocol', 'The agent started working; settings were not changed');
      if (!target.starting) return;
      await new Promise<void>(resolve => setTimeout(resolve, 100));
      this.assertCurrent(epoch, id);
    }
    throw new ClientError('protocol', 'Hermes is still preparing this agent. No setting was sent; try again after it finishes.');
  }
  private async transaction(action: (id: string, profile: string | undefined, epoch: number, send: (params: Record<string, unknown>) => Promise<unknown>) => Promise<void>): Promise<void> {
    const target = this.target.read(), id = target.runtimeId;
    if (!id || !target.idle || this.state.busy || this.state.outcome === 'unknown')
      throw new ClientError('protocol', 'Wait for an attached idle conversation and resolve any unconfirmed setting');
    const epoch = this.epoch;
    let dispatched = false;
    this.publish({ busy: true, note: undefined, outcome: 'idle' });
    try {
      // Refresh validates the runtime still exists; never send a sessionless config setter.
      await this.waitForAgent(epoch, id);
      await action(id, target.profile, epoch, params => {
        this.assertCurrent(epoch, id);
        dispatched = true;
        return this.rpc.call('config.set', params);
      });
    } catch (error) {
      if (epoch === this.epoch) {
        const uncertain = (error instanceof ClientError && ['network', 'timeout', 'disconnected'].includes(error.kind)) ||
          (dispatched && !(error instanceof ClientError && error.kind === 'rpc'));
        this.publish({ outcome: uncertain ? 'unknown' : 'rejected', confirmation: undefined,
          note: uncertain ? 'The setting was not confirmed. Read current settings before trying again; nothing will be replayed.' :
            error instanceof ClientError && error.rpcCode === -32601 ? 'This Hermes version does not support this control.' :
              error instanceof ClientError ? error.message : 'Hermes could not apply this setting.' });
        this.pending = undefined;
      }
      throw error;
    } finally { if (epoch === this.epoch) this.publish({ busy: false }); }
  }
  async changeModel(choice: ModelChoice): Promise<void> {
    modelSetParams('validate', undefined, choice);
    this.cancelConfirmation(); await this.setModel(choice, false);
  }
  async confirmModel(): Promise<void> {
    const pending = this.pending, current = this.target.read();
    if (!pending || pending.epoch !== this.epoch || Date.now() > pending.expires ||
      current.agent?.model !== pending.model || current.agent?.provider !== pending.provider) {
      this.cancelConfirmation(); throw new ClientError('protocol', 'Model confirmation expired; choose the model again');
    }
    this.pending = undefined; this.publish({ confirmation: undefined });
    await this.setModel(pending.choice, true, pending);
  }
  private async setModel(choice: ModelChoice, confirm: boolean, expected?: { model?: string; provider?: string }): Promise<void> {
    await this.transaction(async (id, profile, epoch, send) => {
      const inventory = modelCatalogue(await this.rpc.call('model.options', { session_id: id, ...(profile ? { profile } : {}) }));
      this.assertCurrent(epoch, id);
      if (!inventory.choices.some(row => row.model === choice.model && row.provider === choice.provider && row.authenticated !== false))
        throw new ClientError('protocol', 'That model is no longer available in the configured provider inventory');
      if (!this.target.read().idle) throw new ClientError('protocol', 'The agent is working; choose the model after it finishes');
      const before = this.target.read().agent;
      if (expected && (before?.model !== expected.model || before?.provider !== expected.provider))
        throw new ClientError('protocol', 'The active model changed; choose the model again before confirming');
      const raw = await send(modelSetParams(id, profile, choice, confirm));
      const result = modelChangeResult(raw);
      this.assertCurrent(epoch, id);
      if (result.confirmation) {
        const agent = this.target.read().agent;
        this.pending = { epoch, choice: { ...choice }, expires: Date.now() + 120_000, model: agent?.model, provider: agent?.provider };
        this.publish({ confirmation: { model: choice.model, provider: choice.provider, message: result.confirmation } });
        return;
      }
      await this.target.refresh(); this.assertCurrent(epoch, id);
      if (!result.deferred && this.target.read().agent?.model !== record(raw).value)
        throw new ClientError('timeout', 'The model acknowledgement does not yet match the native snapshot');
      // The backend may defer a model pick if another client starts a turn during the RPC.
      this.publish({ outcome: result.deferred ? 'deferred' : 'applied', note: result.deferred
        ? 'Hermes queued this model for the next turn.' : result.warning || 'Model updated for this conversation.' });
    });
  }
  async changeReasoning(effort: Effort): Promise<void> {
    effortValue(effort); this.cancelConfirmation();
    await this.transaction(async (id, profile, epoch, send) => {
      const observed = { ...this.target.read().agent };
      const params = { session_id: id, ...(profile ? { profile } : {}) };
      const inventory = modelCatalogue(await this.rpc.call('model.options', params));
      this.assertCurrent(epoch, id);
      const current = inventory.choices.find(row => row.model === inventory.model && row.provider === inventory.provider);
      if (current?.reasoning !== true || (effort === 'none' && current.canDisableReasoning === false))
        throw new ClientError('protocol', 'This model does not advertise that reasoning control');
      // Revalidate after the potentially slow provider probe, then use only explicit session scope.
      await this.target.refresh(); this.assertCurrent(epoch, id);
      if (!this.target.read().idle) throw new ClientError('protocol', 'The agent is working; reasoning was not changed');
      const latest = this.target.read().agent;
      if (latest?.model !== observed.model || latest?.provider !== observed.provider)
        throw new ClientError('protocol', 'The active model changed while checking capabilities; choose the effort again');
      const result = record(await send(reasoningSetParams(id, profile, effort)));
      this.assertCurrent(epoch, id);
      if (result.key !== 'reasoning' || result.value !== effort)
        throw new ClientError('protocol', 'Hermes did not confirm the requested reasoning effort');
      await this.target.refresh(); this.assertCurrent(epoch, id);
      if (this.target.read().agent?.reasoningEffort !== effort)
        throw new ClientError('timeout', 'The reasoning acknowledgement does not yet match the native snapshot');
      this.publish({ outcome: 'applied', note: 'Reasoning effort updated for this conversation. Provider support may vary.' });
    });
  }
  /** Read-only reconciliation. It never repeats the setting mutation. */
  async recover(): Promise<void> {
    if (this.state.busy) return;
    const id = this.target.read().runtimeId, epoch = this.epoch;
    if (!id) throw new ClientError('disconnected', 'Reconnect to read current settings');
    this.publish({ busy: true });
    try {
      await this.target.refresh(); this.assertCurrent(epoch, id);
      this.publish({ outcome: 'idle', note: 'Current settings re-read from Hermes. No change was resent.' });
    } finally { if (epoch === this.epoch) this.publish({ busy: false }); }
  }
}
