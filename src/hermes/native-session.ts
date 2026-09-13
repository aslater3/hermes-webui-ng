import type { ConnectionState, GatewayClient } from './gateway-client.js';
import { ClientError, record, textField, type GatewayEvent } from './protocol.js';

type Transport = Pick<GatewayClient, 'call' | 'onEvent' | 'onState' | 'state'>;
export interface Message {
  role: string;
  text: string;
}
export interface SessionState {
  phase: 'empty' | 'attaching' | 'idle' | 'running' | 'waiting' | 'unknown' | 'error';
  storedId?: string;
  runtimeId?: string;
  profile?: string;
  messages: Message[];
  streaming: string;
  deliveryUnknown: boolean;
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
      if (this.state.storedId) this.publish({ phase: 'unknown', runtimeId: undefined });
    } else if (this.state.storedId) {
      void this.resume(this.state.storedId, this.state.profile).catch(() => {});
    }
  }
  async create(profile?: string): Promise<void> {
    await this.attach('session.create', undefined, profile);
  }
  async resume(storedId: string, profile?: string): Promise<void> {
    if (!storedId.trim()) throw new ClientError('protocol', 'A durable Hermes session key is required');
    await this.attach('session.resume', storedId, profile);
  }
  private async attach(method: string, storedId?: string, profile?: string): Promise<void> {
    const epoch = ++this.epoch;
    this.flight = undefined;
    this.publish({
      phase: 'attaching',
      storedId,
      profile,
      runtimeId: undefined,
      messages: [],
      streaming: '',
      error: undefined,
      deliveryUnknown: false,
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
      this.publish({ runtimeId, storedId: key });
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
      const messages = history.messages.slice(-500).map((item: unknown): Message => {
        const message = record(item);
        return {
          role: textField(message, 'role'),
          text: typeof message.text === 'string' ? message.text.slice(0, 131072) : '[Non-text entry]',
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
        streaming,
        error: undefined,
        phase: live.status === 'waiting' ? 'waiting' : live.running ? 'running' : 'idle',
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
      ['message.complete', 'error', 'session.interrupted'].includes(event.type) ||
      event.type.endsWith('.request')
    ) {
      ++this.revision;
      void this.refresh().catch(() => {});
    }
  }
  async submit(text: string): Promise<void> {
    if (this.state.phase !== 'idle' || !this.state.runtimeId || !text.trim())
      throw new ClientError('protocol', 'Wait for an idle native session before submitting');
    const epoch = this.epoch;
    this.publish({ phase: 'running', streaming: '', error: undefined, deliveryUnknown: false });
    try {
      await this.gateway.call('prompt.submit', { session_id: this.state.runtimeId, text });
      this.valid(epoch);
      await this.refresh();
    } catch (error) {
      if (epoch === this.epoch) {
        this.publish({ deliveryUnknown: !(error instanceof ClientError && error.kind === 'rpc') });
        this.failure(epoch, error);
      }
      throw error; // Never retry a prompt: an absent acknowledgement does not mean non-delivery.
    }
  }
  async interrupt(): Promise<void> {
    const epoch = this.epoch;
    if (!this.state.runtimeId) throw new ClientError('disconnected', 'No attached native session');
    await this.gateway.call('session.interrupt', { session_id: this.state.runtimeId });
    this.valid(epoch);
    await this.refresh();
  }
  dispose(): void {
    this.disposed = true;
    ++this.epoch;
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.listeners.clear();
  }
}
