import { ClientError, record } from './protocol.js';
import { commandCatalogue, commandChoice, slashInput, COMMAND_LIMITS, type CommandAction, type CommandCatalogue } from './command-catalog.js';

interface Rpc { call(method: string, params?: Record<string, unknown>): Promise<unknown> }
interface Target {
  read(): { ready: boolean; idle: boolean; runtimeId?: string; profile?: string };
  notify(): void;
}
export interface CommandsState {
  catalogue?: CommandCatalogue;
  loading: boolean;
  busy: boolean;
  error?: string;
  unavailable: boolean;
  executionUnavailable: boolean;
  action?: { kind: Exclude<CommandAction, 'native' | 'unavailable'>; query: string };
  result?: { command: string; output: string; truncated: boolean };
}
const initial = (): CommandsState => ({ loading: false, busy: false, unavailable: false, executionUnavailable: false });
function problem(error: unknown): string {
  if (error instanceof ClientError && error.rpcCode === -32601) return 'Not supported by this Hermes version.';
  if (error instanceof ClientError && (error.kind === 'forbidden' || error.rpcCode === 403)) return 'Hermes denied access to commands.';
  return 'Could not read commands from Hermes. Retry after checking the connection.';
}

/** Selected-session command lane. No shell, config mutation, alias expansion or implicit prompt fallback. */
export class NativeCommands {
  state = initial();
  private epoch = 0;
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
  reset(): void {
    ++this.epoch; ++this.loadId; this.flight = undefined; this.state = initial(); this.changed();
  }
  setVisible(visible: boolean): void { if (visible !== this.visible) { this.visible = visible; this.reset(); this.target.notify(); } }
  dismissAction(): void { this.publish({ action: undefined }); }
  dismissResult(): void { this.publish({ result: undefined }); }
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
  async execute(text: string): Promise<void> {
    const target = this.target.read(), epoch = this.epoch;
    const input = slashInput(text);
    if (!input || !this.visible || !target.ready || !target.idle || !target.runtimeId || this.state.busy)
      throw new ClientError('protocol', 'Wait for an attached idle conversation before using a command.');
    this.publish({ busy: true, result: undefined, action: undefined, error: undefined });
    try {
      // Revalidate discovery at the deliberate send; the displayed catalogue may be old.
      await this.load(true); this.current(epoch, target.runtimeId, target.profile);
      if (!this.target.read().idle) throw new ClientError('protocol', 'The agent started working; no command was sent.');
      if (!this.state.catalogue) throw new ClientError('protocol', this.state.error ?? 'Command discovery is unavailable. Nothing was sent.');
      const choice = commandChoice(this.state.catalogue, input);
      if (choice.action === 'unavailable') throw new ClientError('protocol', 'Command unavailable.');
      if (choice.action !== 'native') { this.publish({ action: { kind: choice.action, query: input.argument } }); return; }
      if (this.state.executionUnavailable) throw new ClientError('protocol', 'Native commands are not supported by this Hermes version.');
      const result = record(await this.rpc.call('slash.exec', { session_id: target.runtimeId,
        ...(target.profile ? { profile: target.profile } : {}), command: choice.name }));
      this.current(epoch, target.runtimeId, target.profile);
      // Never execute a returned directive or downgrade a new result shape to a prompt.
      if (typeof result.output !== 'string' || 'type' in result || 'message' in result || 'target' in result)
        throw new ClientError('protocol', 'Hermes returned an unsupported command result. Nothing was forwarded or replayed.');
      this.publish({ result: { command: choice.name, output: result.output.slice(0, COMMAND_LIMITS.output),
        truncated: result.output.length > COMMAND_LIMITS.output } });
    } catch (error) {
      if (epoch === this.epoch) {
        const missing = error instanceof ClientError && error.rpcCode === -32601;
        this.publish({ error: missing ? problem(error) : error instanceof ClientError && error.kind !== 'rpc' ? error.message :
          'The native command failed. Nothing was forwarded or replayed.', executionUnavailable: this.state.executionUnavailable || missing });
      }
      throw error;
    } finally { if (epoch === this.epoch) this.publish({ busy: false }); }
  }
}
