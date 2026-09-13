import type { ConnectionState, GatewayClient } from './gateway-client.js';
import { ClientError, record, textField, type GatewayEvent } from './protocol.js';

type Transport = Pick<GatewayClient, 'call' | 'onEvent' | 'onState' | 'state'>;
export interface Message {
  role: string;
  text: string;
  truncated?: boolean;
}
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
}

/** Disposable view of upstream state. Nothing is written to browser or server storage. */
export class NativeSession {
  state: SessionState = { phase: 'empty', messages: [], streaming: '', deliveryUnknown: false };
  private epoch = 0;
  private revision = 0;
  private streamRevision = 0;
  private disposed = false;
  private flight?: { epoch: number; promise: Promise<void> };
  private listeners = new Set<(state: SessionState) => void>();
  private unsubscribe: (() => void)[];
  private submission?: { epoch: number };
  private interruption?: { epoch: number; promise: Promise<void> };

  constructor(private readonly gateway: Transport) {
    this.unsubscribe = [
      gateway.onEvent((event) => this.event(event)),
      gateway.onState((connection) => this.connection(connection)),
    ];
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
      ++this.epoch;
      this.flight = undefined;
      if (this.state.storedId) this.publish({ phase: 'unknown', runtimeId: undefined,
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
    this.flight = undefined;
    this.submission = undefined; this.interruption = undefined;
    this.publish({
      phase: 'attaching',
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
      this.publish({ runtimeId, storedId: key, profile: typeof info.profile_name === 'string' ? info.profile_name : profile });
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
    this.publish({ phase: 'error', error: safe });
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
      const [rawHistory, rawLive] = await Promise.all([
        this.gateway.call('session.history', { session_id: runtimeId }),
        this.gateway.call('session.activate', { session_id: runtimeId, omit_messages: true }),
      ]);
      this.valid(epoch);
      // Completion can race BOTH snapshot RPCs. Retry rather than publishing stale history.
      if (revision !== this.revision) continue;
      const history = record(rawHistory);
      const live = record(rawLive);
      if (!Array.isArray(history.messages) || typeof live.running !== 'boolean')
        throw new ClientError('protocol', 'Unsupported native session snapshot');
      const messages = history.messages.slice(-100).map((item: unknown): Message => {
        const message = record(item);
        return {
          role: textField(message, 'role').slice(0, 32),
          text: typeof message.text === 'string' ? message.text.slice(0, 131072) : '[Non-text entry]',
          ...(typeof message.text === 'string' && message.text.length > 131072 ? { truncated: true } : {}),
        };
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
      this.publish({
        messages,
        totalMessages: history.messages.length,
        streaming,
        error: undefined,
        phase: live.status === 'waiting' ? 'waiting' : live.running || this.submission ? 'running' : 'idle',
      });
      return;
    }
    throw new ClientError('timeout', 'Session changed repeatedly during recovery; refresh required');
  }
  private event(event: GatewayEvent): void {
    if (!this.state.runtimeId || event.session_id !== this.state.runtimeId) return;
    if (event.type === 'message.delta') {
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
      event.type.endsWith('.request')
    ) {
      ++this.revision;
      void this.refresh().catch(() => {});
    }
  }
  async submit(text: string): Promise<void> {
    if (this.state.phase !== 'idle' || this.submission || !this.state.runtimeId || !text.trim() || text.length > 32768)
      throw new ClientError('protocol', 'Wait for an idle native session before submitting');
    const epoch = this.epoch;
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
      throw error; // Never retry a prompt: an absent acknowledgement does not mean non-delivery.
    }
  }
  interrupt(): Promise<void> {
    const epoch = this.epoch;
    if (this.interruption?.epoch === epoch) return this.interruption.promise;
    if (!this.state.runtimeId || !['running', 'waiting'].includes(this.state.phase) || this.state.submitting)
      return Promise.reject(new ClientError('protocol', 'No running native turn can be interrupted yet'));
    const runtimeId = this.state.runtimeId;
    this.publish({ interrupting: true });
    const promise = (async () => {
      this.valid(epoch);
      await this.gateway.call('session.interrupt', { session_id: runtimeId });
      this.valid(epoch);
      await this.refresh(); // The acknowledgement alone is NOT evidence of an idle agent.
    })().finally(() => {
      if (this.interruption?.epoch === epoch) this.interruption = undefined;
      if (this.epoch === epoch) this.publish({ interrupting: false });
    });
    this.interruption = { epoch, promise }; return promise;
  }
  dispose(): void {
    this.disposed = true;
    ++this.epoch;
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.listeners.clear();
  }
}
