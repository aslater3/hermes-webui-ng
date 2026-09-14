import { dispatchCommand } from './command-dispatch.js';
import { readOnlyCommandResult } from './command-result.js';
import { ClientError } from './protocol.js';
import { commandCatalogue, commandChoice, slashInput, type CommandAction, type CommandCatalogue } from './command-catalog.js';

interface Rpc { call(method: string, params?: Record<string, unknown>): Promise<unknown> }
interface Target {
  read(): { ready: boolean; idle: boolean; runtimeId?: string; profile?: string };
  notify(): void;
  refresh?(): Promise<void>;
  submitGenerated?(message: string): Promise<void>;
}
export interface CommandsState {
  catalogue?: CommandCatalogue;
  loading: boolean;
  busy: boolean;
  error?: string;
  unavailable: boolean;
  executionUnavailable: boolean;
  action?: { kind: Exclude<CommandAction, 'native' | 'confirm-native' | 'unavailable'>; query: string };
  result?: { command: string; output: string; truncated: boolean; native?: boolean; pending?: boolean };
  confirmation?: { text: string; expires: number; source: 'composer' | 'catalogue' };
  recovered?: { text: string; kind: 'prefill' | 'alias'; notice?: string };
  uncertain?: boolean;
}
const initial = (): CommandsState => ({ loading: false, busy: false, unavailable: false, executionUnavailable: false });
function problem(error: unknown): string {
  if (error instanceof ClientError && error.rpcCode === -32601) return 'Not supported by this Hermes version.';
  if (error instanceof ClientError && (error.kind === 'forbidden' || error.rpcCode === 403)) return 'Hermes denied access to commands.';
  return 'Could not read commands from Hermes. Retry after checking the connection.';
}

/** Selected-session native command transactions. Hermes owns effects; the browser never executes shell code. */
export class NativeCommands {
  state = initial();
  private epoch = 0;
  private issued = false;
  private pending?: { text: string; epoch: number; runtimeId: string; profile?: string; expires: number };
  get blocked(): boolean { return this.state.busy || !!this.state.confirmation || !!this.state.uncertain; }
  private visible = true;
  private loadId = 0;
  private listeners = new Set<() => void>();
  private flight?: { id: number; promise: Promise<void> };
  constructor(private readonly rpc: Rpc, private readonly target: Target) {}
  // Control completion must not wait for the shell's animation-frame transcript batching.
  getSnapshot = () => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private changed(): void { for (const listener of this.listeners) listener(); }
  private publish(patch: Partial<CommandsState>): void {
    this.state = { ...this.state, ...patch }; this.changed(); this.target.notify();
  }
  reset(preserveUncertainty = false): void {
    const uncertain = preserveUncertainty && (this.state.uncertain || (this.state.busy && this.issued));
    ++this.epoch; this.pending = undefined; this.issued = false; ++this.loadId; this.flight = undefined;
    this.state = { ...initial(), ...(uncertain ? { uncertain: true } : {}) }; this.changed();
  }
  setVisible(visible: boolean): void { if (visible !== this.visible) { this.visible = visible; this.reset(true); this.target.notify(); } }
  dismissAction(): void { this.publish({ action: undefined }); }
  dismissResult(): void { this.publish({ result: undefined, recovered: undefined }); }
  cancelConfirmation(): void { this.pending = undefined; this.publish({ confirmation: undefined }); }
  async acknowledgeUncertain(): Promise<void> {
    const owner = this.target.read(), epoch = this.epoch;
    if (this.state.busy) return;
    await this.target.refresh?.(); this.current(epoch, owner.runtimeId, owner.profile);
    this.publish({ uncertain: false, error: undefined });
  }
  private current(epoch: number, id?: string, profile?: string): void {
    const target = this.target.read();
    if (epoch !== this.epoch || !this.visible || !target.ready || target.runtimeId !== id || target.profile !== profile)
      throw new ClientError('disconnected', 'The conversation or connection changed. No command was replayed.');
  }
  load(refresh = false): Promise<void> {
    if (this.flight) return this.flight.promise;
    if (!refresh && (this.state.catalogue || this.state.unavailable)) return Promise.resolve();
    const target = this.target.read(), epoch = this.epoch, id = ++this.loadId;
    if (!this.visible || !target.ready) return Promise.resolve();
    this.publish({ loading: true, catalogue: undefined, error: undefined, unavailable: false });
    const promise = this.rpc.call('commands.catalog', {
      ...(target.runtimeId ? { session_id: target.runtimeId } : {}), ...(target.profile ? { profile: target.profile } : {}),
    }).then(raw => {
      this.current(epoch, target.runtimeId, target.profile);
      if (id === this.loadId) this.publish({ catalogue: commandCatalogue(raw) });
    }).catch(error => {
      if (epoch === this.epoch && id === this.loadId) this.publish({ error: problem(error),
        unavailable: error instanceof ClientError && error.rpcCode === -32601 });
    }).finally(() => {
      if (this.flight?.id === id) this.flight = undefined;
      if (epoch === this.epoch && id === this.loadId) this.publish({ loading: false });
    });
    this.flight = { id, promise }; return promise;
  }
  async execute(text: string, source: 'composer' | 'catalogue' = 'catalogue'): Promise<void> {
    const target = this.target.read(), epoch = this.epoch;
    const input = slashInput(text);
    if (!input || !this.visible || !target.ready || !target.idle || !target.runtimeId || this.blocked)
      throw new ClientError('protocol', 'Wait for an attached idle conversation before using a command.');
    this.publish({ busy: true, result: undefined, recovered: undefined, action: undefined, error: undefined });
    try {
      // Revalidate discovery at the deliberate send; the displayed catalogue may be old.
      await this.load(true); this.current(epoch, target.runtimeId, target.profile);
      if (!this.target.read().idle) throw new ClientError('protocol', 'The agent started working; no command was sent.');
      if (!this.state.catalogue) throw new ClientError('protocol', this.state.error ?? 'Command discovery is unavailable. Nothing was sent.');
      const choice = commandChoice(this.state.catalogue, input);
      if (choice.action === 'unavailable') throw new ClientError('protocol', 'Command unavailable.');
      if (choice.action === 'confirm-native') {
        const expires = Date.now() + 120_000;
        this.pending = { text, epoch, runtimeId: target.runtimeId, profile: target.profile, expires };
        this.publish({ confirmation: { text, expires, source } }); return;
      }
      if (choice.action !== 'native') { this.publish({ action: { kind: choice.action, query: input.argument } }); return; }
      if (this.state.executionUnavailable) throw new ClientError('protocol', 'Native commands are not supported by this Hermes version.');
      const raw = await this.rpc.call('slash.exec', { session_id: target.runtimeId,
        ...(target.profile ? { profile: target.profile } : {}), command: choice.name });
      this.current(epoch, target.runtimeId, target.profile);
      const result = readOnlyCommandResult(raw);
      this.publish({ result: { command: choice.name, output: result.output, truncated: result.truncated } });
    } catch (error) {
      if (epoch === this.epoch) {
        const missing = error instanceof ClientError && error.rpcCode === -32601;
        this.publish({ error: missing ? problem(error) : error instanceof ClientError && error.kind !== 'rpc' ? error.message :
          'The native command failed. Nothing was forwarded or replayed.', executionUnavailable: this.state.executionUnavailable || missing });
      }
      throw error;
    } finally { if (epoch === this.epoch) this.publish({ busy: false }); }
  }
  async confirm(): Promise<void> {
    const pending = this.pending;
    if (this.state.busy) throw new ClientError('protocol', 'A native command is already in progress. Nothing was replayed.');
    if (!pending || this.state.uncertain || Date.now() >= pending.expires) {
      this.cancelConfirmation(); throw new ClientError('protocol', 'The command confirmation expired or is unavailable. Prepare it again.');
    }
    this.current(pending.epoch, pending.runtimeId, pending.profile);
    if (!this.target.read().idle) throw new ClientError('protocol', 'Wait for an idle session before confirming.');
    this.pending = undefined;
    this.publish({ confirmation: undefined, busy: true, error: undefined, recovered: undefined, result: undefined });
    let issued = false;
    const current = () => this.current(pending.epoch, pending.runtimeId, pending.profile);
    try {
      await this.load(true); current();
      const input = slashInput(pending.text);
      if (!input || !this.state.catalogue) throw new ClientError('protocol', 'Command discovery failed. Nothing was executed.');
      const choice = commandChoice(this.state.catalogue, input);
      const result = await dispatchCommand(this.rpc, { ...input, name: choice.name, category: choice.category },
        { runtimeId: pending.runtimeId, profile: pending.profile || 'default' }, current, () => { issued = true; this.issued = true; });
      current();
      if (result.kind === 'send') {
        if (!this.target.submitGenerated) throw new ClientError('protocol', 'The native prompt hand-off is unavailable. Check native state before retrying.');
        await this.target.refresh?.(); current();
        await this.target.submitGenerated(result.message); current();
      } else {
        await this.target.refresh?.(); current();
        if (result.kind === 'output') this.publish({ result: { command: choice.name, output: result.output +
          (result.warning ? `\n\n${result.warning}` : ''), truncated: result.truncated, native: true, pending: result.pending },
          uncertain: result.pending });
        else this.publish({ recovered: result.kind === 'alias' ? { text: result.target, kind: 'alias' } :
          { text: result.message, kind: 'prefill', notice: result.notice } });
      }
    } catch (error) {
      if (pending.epoch === this.epoch) this.publish({ uncertain: issued, error: error instanceof ClientError && error.kind !== 'rpc'
        ? error.message : 'The native command did not complete successfully. Check its effects before retrying; nothing was replayed.' });
      throw error;
    } finally { if (pending.epoch === this.epoch) { this.issued = false; this.publish({ busy: false }); } }
  }

}
