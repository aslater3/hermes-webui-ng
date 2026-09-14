import { NativeCommands } from './native-commands.js';
import { displayMessage, type DisplayMessage } from './history-message.js';
import { infoUsage, type SessionUsage } from './session-usage.js';
import { NativeSettings } from './native-settings.js';
import { agentMetadata, yoloSetParams, type AgentMetadata } from './model-catalog.js';
import { AgentActivity, inputRpc } from './agent-activity.js';
import type { ConnectionState, GatewayClient } from './gateway-client.js';
import { ClientError, record, textField, type GatewayEvent } from './protocol.js';

type Transport = Pick<GatewayClient, 'call' | 'onEvent' | 'onState' | 'state'>;
export type Message = DisplayMessage;
export interface SessionState {
  phase: 'empty' | 'attaching' | 'idle' | 'running' | 'waiting' | 'unknown' | 'error';
  storedId?: string;
  runtimeId?: string;
  profile?: string;
  messages: Message[];
  streaming: string;
  deliveryUnknown: boolean;
  submitting?: boolean;
  interrupting?: boolean;
  totalMessages?: number;
  error?: ClientError;
  agent?: AgentMetadata;
  agentStarting?: boolean;
  usage?: SessionUsage;
}

/** Disposable view of upstream state. Nothing is written to browser or server storage. */
export class NativeSession {
  readonly activity = new AgentActivity();
  readonly settings: NativeSettings;
  readonly commands: NativeCommands;
  state: SessionState = { phase: 'empty', messages: [], streaming: '', deliveryUnknown: false };
  private epoch = 0;
  private revision = 0;
  private streamRevision = 0;
  private usageRevision = 0;
  private disposed = false;
  private foreground = true;
  private flight?: { epoch: number; promise: Promise<void> };
  private listeners = new Set<(state: SessionState) => void>();
  private unsubscribe: (() => void)[];
  private submission?: { epoch: number };
  private interruption?: { epoch: number; promise: Promise<void> };
  private yoloFlight?: { epoch: number; enabled: boolean; promise: Promise<void> };

  constructor(private readonly gateway: Transport) {
    this.settings = new NativeSettings(gateway, {
      read: () => ({ runtimeId: this.state.runtimeId, profile: this.state.profile, starting: this.state.agentStarting,
        idle: this.foreground && !this.disposed && gateway.state.phase === 'ready' && this.state.phase === 'idle' && !this.submission && !this.commands?.state.busy, agent: this.state.agent }),
      refresh: () => this.refresh(), notify: () => this.publish({}),
    });
    this.commands = new NativeCommands(gateway, {
      read: () => ({ runtimeId: this.state.runtimeId, profile: this.state.profile,
        ready: this.foreground && !this.disposed && gateway.state.phase === 'ready',
        idle: this.state.phase === 'idle' && !this.submission && !this.yoloFlight &&
          !this.settings.state.busy && this.settings.state.outcome !== 'unknown' && !this.settings.state.confirmation }),
      notify: () => this.publish({}),
    });
    this.unsubscribe = [
      gateway.onEvent((event) => this.event(event)),
      gateway.onState((connection) => this.connection(connection)),
    ];
  }
  /** Keep live descriptors, not hidden transcripts, while the operator views another conversation. */
  setForeground(value: boolean): void {
    if (value !== this.foreground) { ++this.revision; ++this.usageRevision; }
    this.foreground = value;
    if (!value) { this.commands.reset(); this.settings.reset(); this.publish({ messages: [], streaming: '', usage: undefined }); }
  }
  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(patch: Partial<SessionState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
  private valid(epoch: number): void {
    if (this.disposed || epoch !== this.epoch || this.gateway.state.phase !== 'ready')
      throw new ClientError('disconnected', 'Session selection or connection changed');
  }
  private connection(connection: ConnectionState): void {
    if (connection.phase !== 'ready') {
      this.commands.reset();
      this.settings.reset();
      this.activity.disconnect();
      ++this.epoch;
      this.flight = undefined; this.yoloFlight = undefined;
      if (this.state.storedId) this.publish({ phase: 'unknown', runtimeId: undefined, agentStarting: undefined, usage: undefined,
        deliveryUnknown: this.state.deliveryUnknown || !!this.submission, submitting: false, interrupting: false });
      this.submission = undefined; this.interruption = undefined;
    } else if (this.state.storedId) {
      void this.attach('session.resume', this.state.storedId, this.state.profile, true).catch(() => {});
    }
  }
  async create(profile?: string): Promise<void> {
    await this.attach('session.create', undefined, profile);
  }
  async resume(storedId: string, profile?: string): Promise<void> {
    if (!storedId.trim()) throw new ClientError('protocol', 'A durable Hermes session key is required');
    await this.attach('session.resume', storedId, profile);
  }
  private async attach(method: string, storedId?: string, profile?: string, reconnect = false): Promise<void> {
    const epoch = ++this.epoch;
    this.commands.reset();
    this.settings.reset();
    if (!reconnect) this.activity.reset();
    this.flight = undefined; this.yoloFlight = undefined;
    this.submission = undefined; this.interruption = undefined;
    this.publish({
      phase: 'attaching',
      agent: undefined, agentStarting: undefined, usage: undefined,
      storedId,
      profile,
      runtimeId: undefined,
      messages: [],
      streaming: '',
      error: undefined,
      deliveryUnknown: reconnect && this.state.deliveryUnknown,
      submitting: false, interrupting: false, totalMessages: 0,
    });
    try {
      this.valid(epoch);
      const result = record(
        await this.gateway.call(method, {
          ...(storedId ? { session_id: storedId } : {}),
          ...(profile ? { profile } : {}),
          source: 'webui-ng',
          close_on_disconnect: false,
        }),
      );
      this.valid(epoch);
      const runtimeId = textField(result, 'session_id');
      const key = result.stored_session_id ?? result.session_key ?? result.resumed ?? storedId;
      if (typeof key !== 'string' || !key)
        throw new ClientError('protocol', 'Hermes omitted the durable session key');
      const info = typeof result.info === 'object' && result.info !== null ? record(result.info) : {};
      this.publish({ runtimeId, storedId: key, usage: this.foreground ? infoUsage(info) : undefined, agent: agentMetadata(info), agentStarting: info.lazy === true, profile: typeof info.profile_name === 'string' ? info.profile_name : profile });
      await this.refresh();
    } catch (error) {
      this.failure(epoch, error);
      throw error;
    }
  }
  private failure(epoch: number, error: unknown): void {
    if (epoch !== this.epoch || this.disposed) return;
    const safe =
      error instanceof ClientError ? error : new ClientError('protocol', 'Session recovery failed');
    this.publish({ phase: 'error', error: safe, usage: undefined });
  }
  refresh(): Promise<void> {
    const epoch = this.epoch;
    if (this.flight?.epoch === epoch) return this.flight.promise;
    const promise = this.reconcile(epoch)
      .catch((error: unknown) => {
        this.failure(epoch, error);
        throw error;
      })
      .finally(() => {
        if (this.flight?.epoch === epoch) this.flight = undefined;
      });
    this.flight = { epoch, promise };
    return promise;
  }
  private async reconcile(epoch: number): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt++) {
      this.valid(epoch);
      const runtimeId = this.state.runtimeId;
      if (!runtimeId) throw new ClientError('disconnected', 'No attached native session');
      const revision = this.revision;
      const streamRevision = this.streamRevision;
      const usageRevision = this.usageRevision;
      const [rawHistory, rawLive] = await Promise.all([
        this.foreground ? this.gateway.call('session.history', { session_id: runtimeId }) : Promise.resolve({ messages: [] }),
        this.gateway.call('session.activate', { session_id: runtimeId, omit_messages: true }),
      ]);
      this.valid(epoch);
      // Completion can race BOTH snapshot RPCs. Retry rather than publishing stale history.
      if (revision !== this.revision) continue;
      const history = record(rawHistory);
      const live = record(rawLive);
      if (!Array.isArray(history.messages) || typeof live.running !== 'boolean')
        throw new ClientError('protocol', 'Unsupported native session snapshot');
      const messages = history.messages.slice(-100).flatMap((item: unknown): Message[] => {
        const message = displayMessage(item, 'native');
        return message ? [message] : [];
      });
      const inflight =
        typeof live.inflight === 'object' && live.inflight !== null ? record(live.inflight) : {};
      const streaming = live.running
        ? streamRevision !== this.streamRevision
          ? this.state.streaming
          : typeof inflight.assistant === 'string'
            ? inflight.assistant.slice(-131072)
            : ''
        : '';
      this.activity.snapshot(live);
      this.publish({
        messages: this.foreground ? messages : [],
        // A usage ticker must not invalidate/retry the entire transcript snapshot.
        // Preserve a newer event while a slower history/activate pair is in flight.
        usage: !this.foreground ? undefined : usageRevision === this.usageRevision ? infoUsage(live.info) : this.state.usage,
        totalMessages: history.messages.length,
        agent: { ...this.state.agent, ...agentMetadata(live.info) },
        agentStarting: live.status === 'starting' || (live.info !== null && typeof live.info === 'object' && !Array.isArray(live.info) && record(live.info).lazy === true),
        streaming: this.foreground ? streaming : '',
        error: undefined,
        phase: live.status === 'waiting' || this.activity.state.inputs.some(input => ['pending', 'sending'].includes(input.status)) ? 'waiting' : live.running || this.submission ? 'running' : 'idle',
      });
      return;
    }
    throw new ClientError('timeout', 'Session changed repeatedly during recovery; refresh required');
  }
  private event(event: GatewayEvent): void {
    if (!this.state.runtimeId || event.session_id !== this.state.runtimeId) return;
    if (this.foreground && ['session.usage', 'session.info', 'message.complete'].includes(event.type)) {
      const payload = event.payload;
      if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'usage' in payload) {
        ++this.usageRevision;
        this.publish({ usage: infoUsage(payload) });
      }
    }
    if (this.activity.receive(event)) this.publish({});
    if (event.type === 'message.delta') {
      if (!this.foreground) return;
      const payload = record(event.payload);
      if (typeof payload.text === 'string') {
        ++this.streamRevision;
        this.publish({ streaming: (this.state.streaming + payload.text).slice(-131072) });
      }
    } else if (event.type === 'message.start') {
      ++this.revision;
      this.publish({ phase: 'running', streaming: '' });
    } else if (
      // Completion precedes upstream cleanup; settled session.info must invalidate the
      // current snapshot too. Do not guess idle from message.complete alone.
      ['message.complete', 'session.info', 'error', 'session.interrupted'].includes(event.type) ||
      event.type.endsWith('.request') || event.type.endsWith('.expire')
    ) {
      ++this.revision;
      void this.refresh().catch(() => {});
    }
  }
  async submit(text: string): Promise<void> {
    if (!this.foreground || this.state.phase !== 'idle' || this.commands.state.busy || this.settings.state.busy || this.settings.state.outcome === 'unknown' || this.settings.state.confirmation || this.submission || !this.state.runtimeId || !text.trim() || text.length > 32768)
      throw new ClientError('protocol', 'Wait for an idle native session before submitting');
    const epoch = this.epoch;
    this.settings.cancelConfirmation();
    const submission = { epoch }; this.submission = submission; ++this.revision;
    this.publish({ phase: 'running', streaming: '', error: undefined, deliveryUnknown: false, submitting: true });
    try {
      await this.gateway.call('prompt.submit', { session_id: this.state.runtimeId, text });
      this.valid(epoch);
      if (this.submission === submission) this.submission = undefined;
      this.publish({ submitting: false });
      await this.refresh();
    } catch (error) {
      if (epoch === this.epoch) {
        this.submission = undefined;
        this.publish({ submitting: false, deliveryUnknown: !(error instanceof ClientError && error.kind === 'rpc') });
        this.failure(epoch, error);
      }
      throw error;
    }
  }
  interrupt(): Promise<void> {
    const epoch = this.epoch;
    if (this.interruption?.epoch === epoch) return this.interruption.promise;
    if (!this.foreground || !this.state.runtimeId || !['running', 'waiting'].includes(this.state.phase) || this.state.submitting)
      return Promise.reject(new ClientError('protocol', 'No running native turn can be interrupted yet'));
    const runtimeId = this.state.runtimeId;
    this.publish({ interrupting: true });
    const promise = (async () => {
      this.valid(epoch);
      await this.gateway.call('session.interrupt', { session_id: runtimeId });
      this.valid(epoch);
      await this.refresh();
    })().finally(() => {
      if (this.interruption?.epoch === epoch) this.interruption = undefined;
      if (this.epoch === epoch) this.publish({ interrupting: false });
    });
    this.interruption = { epoch, promise }; return promise;
  }
  /** Session-only approval bypass. Explicit deny rules and Hermes hardline blocks remain authoritative upstream. */
  setYolo(enabled: boolean): Promise<void> {
    const epoch = this.epoch;
    if (this.yoloFlight?.epoch === epoch) {
      if (this.yoloFlight.enabled === enabled) return this.yoloFlight.promise;
      return Promise.reject(new ClientError('protocol', 'Wait for the current YOLO change to finish'));
    }
    const promise = (async () => {
      this.valid(epoch);
      const runtimeId = this.state.runtimeId;
      if (!this.foreground || !runtimeId || !['idle', 'waiting'].includes(this.state.phase) || this.state.interrupting || this.state.submitting || this.commands.state.busy || this.settings.state.busy)
        throw new ClientError('protocol', 'YOLO can be changed only for the selected idle or approval-waiting conversation');
      const raw = record(await this.gateway.call('config.set', yoloSetParams(runtimeId, this.state.profile, enabled)));
      this.valid(epoch);
      if (raw.key !== 'yolo' || raw.value !== (enabled ? '1' : '0') || (raw.scope !== undefined && raw.scope !== 'session'))
        throw new ClientError('protocol', 'Hermes did not confirm the session YOLO setting');
      ++this.revision;
      await this.refresh(); this.valid(epoch);
      if (enabled && this.state.agent?.yolo !== true)
        throw new ClientError('timeout', 'Hermes acknowledged YOLO but the native session snapshot did not enable it');
      if (!enabled && this.state.agent?.yolo === true)
        throw new ClientError('protocol', 'YOLO remains active because Hermes has a broader approval bypass enabled');
    })().finally(() => {
      if (this.yoloFlight?.epoch === epoch && this.yoloFlight.enabled === enabled) this.yoloFlight = undefined;
    });
    this.yoloFlight = { epoch, enabled, promise }; return promise;
  }
  /** Enable session YOLO deliberately, then approve the exact request once. Nothing is replayed on uncertainty. */
  async enableYoloAndApprove(key: string): Promise<void> {
    const before = this.activity.state.inputs.find(input => input.key === key);
    if (!before || before.kind !== 'approval' || before.status !== 'pending' || before.blocked || !before.choices.includes('once'))
      throw new ClientError('protocol', 'No YOLO-eligible approval request is pending');
    await this.setYolo(true);
    const current = this.activity.state.inputs.find(input => input.key === key);
    if (!current || current.kind !== 'approval' || current.status !== 'pending' || current.blocked || !current.choices.includes('once'))
      throw new ClientError('protocol', 'The approval expired while YOLO was being enabled');
    await this.respond(key, 'once');
  }
  /** The active request and session generation authorise one deliberate response, never a replay. */
  async respond(key: string, value: string, questionId?: string): Promise<void> {
    const epoch = this.epoch;
    this.valid(epoch);
    if (!this.foreground) throw new ClientError('disconnected', 'Select this conversation before answering its request');
    const runtimeId = this.state.runtimeId;
    const input = this.activity.state.inputs.find((p) => p.key === key);
    if (!runtimeId || !input || this.state.interrupting)
      throw new ClientError('disconnected', 'No active agent request');
    const rpc = inputRpc(input, { value, questionId }, runtimeId);
    value = '';
    this.activity.status(key, 'sending'); ++this.revision; this.publish({});
    try {
      const pending = this.gateway.call(rpc.method, rpc.params);
      for (const field of ['password', 'value', 'answer']) delete rpc.params[field];
      const result = await pending;
      this.valid(epoch);
      this.activity.result(key, result, questionId);
      ++this.revision; this.publish({});
      await this.refresh();
    } catch (error) {
      if (epoch === this.epoch && !this.disposed) {
        const current = this.activity.state.inputs.find((p) => p.key === key);
        if (current?.status === 'sending') this.activity.status(key,
          error instanceof ClientError && error.rpcCode === -32601 ? 'unsupported' :
          error instanceof ClientError && error.rpcCode === 4009 ? 'expired' : 'unknown');
        this.publish({});
      }
      throw error instanceof ClientError ? error : new ClientError('protocol', 'Agent response failed');
    } finally {
      for (const field of ['password', 'value', 'answer']) delete rpc.params[field];
    }
  }
  dispose(): void {
    this.disposed = true;
    this.state = { ...this.state, usage: undefined };
    this.commands.reset();
    this.settings.reset();
    this.activity.reset();
    ++this.epoch;
    this.yoloFlight = undefined;
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.listeners.clear();
  }
}
