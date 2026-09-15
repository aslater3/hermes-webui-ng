import { PeerRequests } from './peer-requests.js';
import { WS_PROTOCOL, type WsCredential } from './ws-auth.js';
import type { DiagnosticsRing } from './diagnostics.js';
import { ClientError, parseFrames, record, type GatewayEvent } from './protocol.js';

export type Phase =
  'disconnected' | 'authenticating' | 'connecting' | 'ready' | 'reconnecting' | 'auth-required' | 'error';
export interface ConnectionState {
  phase: Phase;
  generation: number;
  attempt: number;
  error?: ClientError;
}
export interface GatewayOptions {
  socketFactory?: (url: string, protocols: string[]) => WebSocket;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  heartbeatMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  maxRetries?: number;
  random?: () => number;
  diagnostics?: DiagnosticsRing;
}
interface Pending {
  method: string;
  started: number;
  resolve: (value: unknown) => void;
  reject: (error: ClientError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Transport only: no sessions, prompt queue, transcript persistence, or automatic RPC replay. */
export class GatewayClient {
  readonly requests = new PeerRequests(frame => {
    if (this.state.phase !== 'ready' || this.socket?.readyState !== 1)
      throw new ClientError('disconnected', 'The native response could not be sent. It was not replayed.');
    const encoded = JSON.stringify(frame);
    if (encoded.length > 1_048_576) throw new ClientError('protocol', 'Native response is too large.');
    // Interactive values and IDs are deliberately excluded from diagnostics.
    this.socket.send(encoded);
  });
  private socket?: WebSocket;
  private resumeCheck?: Promise<void>;
  private metrics: { readyAt?: number; lastEventAt?: number; latencyMs?: number; closeCode?: number } = {};
  telemetry() { return { ...this.metrics }; }
  advertised(): Record<string, boolean> {
    if (this.state.phase !== 'ready') return {};
    return Object.fromEntries(['heartbeat', 'change_events'].flatMap((key) =>
      typeof this.readyPayload[key] === 'boolean' ? [[key, this.readyPayload[key]]] : []));
  }
  /** Terminal local admission revocation after the official REST identity check fails. */
  suspend(error: ClientError): void {
    this.enabled = false;
    this.invalidate(error);
    this.publish(error.kind === 'auth-required' ? 'auth-required' : 'error', error);
  }
  private abort?: AbortController;
  private generation = 0;
  private sequence = 0;
  private attempts = 0;
  private enabled = false;
  private timer?: ReturnType<typeof setTimeout>;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private connecting?: Promise<Record<string, unknown>>;
  private resolveConnect?: (value: Record<string, unknown>) => void;
  private rejectConnect?: (error: ClientError) => void;
  private readyPayload: Record<string, unknown> = {};
  private pending = new Map<string | number, Pending>();
  private events = new Set<(event: GatewayEvent) => void>();
  private states = new Set<(state: ConnectionState) => void>();
  state: ConnectionState = { phase: 'disconnected', generation: 0, attempt: 0 };

  constructor(
    private readonly auth: { credential(signal?: AbortSignal): Promise<WsCredential> },
    private readonly options: GatewayOptions = {},
  ) {}
  onEvent(handler: (event: GatewayEvent) => void): () => void {
    this.events.add(handler);
    return () => { this.events.delete(handler); };
  }
  onState(handler: (state: ConnectionState) => void): () => void {
    this.states.add(handler);
    handler(this.state);
    return () => { this.states.delete(handler); };
  }
  private publish(phase: Phase, error?: ClientError): void {
    this.state = { phase, generation: this.generation, attempt: this.attempts, error };
    this.options.diagnostics?.add({ event: 'connection.state', phase, generation: this.generation,
      attempt: this.attempts, kind: error?.kind });
    for (const listener of this.states) this.notify(() => listener(this.state));
  }
  private notify(callback: () => void): void {
    try { callback(); } catch { console.error('Gateway observer failed'); }
  }
  connect(): Promise<Record<string, unknown>> {
    if (this.connecting) return this.connecting;
    if (this.state.phase === 'ready') return Promise.resolve(this.readyPayload);
    this.enabled = true;
    this.attempts = 0;
    clearTimeout(this.retry);
    return this.begin();
  }
  reconnect(): Promise<Record<string, unknown>> {
    this.invalidate(new ClientError('disconnected', 'Connection superseded; pending delivery is unknown'));
    this.publish('reconnecting');
    return this.connect();
  }
  close(): void {
    this.enabled = false;
    this.invalidate(new ClientError('disconnected', 'Connection closed; pending delivery is unknown'));
    this.publish('disconnected');
  }
  /** Called on visibility/pageshow/online. Never silently retries terminal auth or protocol failures. */
  ensureLive(): Promise<void> {
    if (this.resumeCheck) return this.resumeCheck;
    const check = (async () => {
      if (!this.enabled || ['auth-required', 'error'].includes(this.state.phase)) return;
      if (this.connecting) { await this.connecting; return; }
      // A scheduled network retry owns its backoff; lifecycle events must not reset it.
      if (this.state.phase === 'reconnecting') return;
      const generation = this.generation;
      if (this.state.phase === 'ready' && this.readyPayload.heartbeat === true) {
        try { await this.call('gateway.ping', {}, 5000); return; } catch {
          // A concurrently revoked admission or changed transport must stay revoked.
          if (generation !== this.generation || !this.enabled) return;
        }
      }
      if (generation === this.generation && this.enabled) await this.reconnect();
    })();
    const settled = check.finally(() => { if (this.resumeCheck === settled) this.resumeCheck = undefined; });
    this.resumeCheck = settled;
    return settled;
  }
  private begin(): Promise<Record<string, unknown>> {
    const generation = ++this.generation;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    this.connecting = promise;
    this.publish('authenticating');
    this.timer = setTimeout(
      () => this.fail(generation, new ClientError('timeout', 'Gateway readiness timed out')),
      this.options.connectTimeoutMs ?? 15_000,
    );
    void (async () => {
      const credential = await this.auth.credential(signal);
      if (generation !== this.generation) return;
      this.publish('connecting');
      const socket = (this.options.socketFactory ?? ((url, protocols) => new WebSocket(url, protocols)))(
        credential.url, credential.protocols,
      );
      this.socket = socket;
      socket.addEventListener('open', () => {
        if (generation === this.generation) this.options.diagnostics?.add({ event: 'websocket.open', generation });
        if (generation === this.generation && socket.protocol !== WS_PROTOCOL)
          this.fail(generation, new ClientError('protocol', 'Hermes did not negotiate the supported Gateway protocol'));
      });
      socket.addEventListener('message', (message) => {
        if (generation !== this.generation) return;
        this.metrics.lastEventAt = Date.now();
        try {
          for (const frame of parseFrames(message.data)) {
            if (generation !== this.generation) return;
            if (frame.kind === 'request') {
              if (this.state.phase === 'ready') this.requests.receive(frame);
            } else if (frame.kind === 'reply') {
              const pending = this.pending.get(frame.id);
              if (!pending) continue;
              clearTimeout(pending.timer);
              this.pending.delete(frame.id);
              const durationMs = Date.now() - pending.started;
              if (pending.method === 'gateway.ping' && !frame.error) this.metrics.latencyMs = durationMs;
              this.options.diagnostics?.add({ event: frame.error ? 'rpc.failed' : 'rpc.reply',
                method: pending.method, generation, durationMs, rpcCode: frame.error?.code });
              if (frame.error) pending.reject(new ClientError('rpc', `Hermes RPC rejected (${frame.error.code})`, frame.error.code));
              else pending.resolve(frame.result);
            } else if (frame.event.type === 'gateway.ready' && this.state.phase !== 'ready') {
              this.readyPayload = record(frame.event.payload);
              this.metrics.readyAt = Date.now();
              this.options.diagnostics?.add({ event: 'gateway.ready', generation });
              clearTimeout(this.timer);
              const resolve = this.resolveConnect;
              this.resolveConnect = undefined;
              this.rejectConnect = undefined;
              this.connecting = undefined;
              this.attempts = 0;
              this.publish('ready');
              resolve?.(this.readyPayload);
              this.startHeartbeat(generation);
            } else if (this.state.phase === 'ready') {
              this.options.diagnostics?.add({ event: 'gateway.event', generation });
              this.requests.cancel(frame.event);
              for (const listener of this.events) this.notify(() => listener(frame.event));
            }
          }
        } catch { this.fail(generation, new ClientError('protocol', 'Invalid Gateway protocol data')); }
      });
      socket.addEventListener('error', () => {
        /* close/handshake deadline classifies browser handshake failures */
      });
      socket.addEventListener('close', (event) => {
        if (generation !== this.generation) return;
        this.metrics.closeCode = event.code;
        this.options.diagnostics?.add({ event: 'websocket.close', closeCode: event.code, generation });
        const kind = event.code === 4401 ? 'auth-required' : event.code === 4403 ? 'forbidden' :
          [1002, 1003, 1007, 1008, 1009, 4404, 4408].includes(event.code) ? 'protocol' : 'network';
        this.fail(generation, new ClientError(kind, `Gateway closed (${event.code}); pending delivery is unknown`));
      });
    })().catch((error: unknown) => this.fail(generation,
      error instanceof ClientError ? error : new ClientError('network', 'Gateway connection failed')));
    return promise;
  }
  private startHeartbeat(generation: number): void {
    const interval = this.options.heartbeatMs ?? 15_000;
    if (generation !== this.generation || !interval || this.readyPayload.heartbeat !== true) return;
    let busy = false;
    this.heartbeat = setInterval(() => {
      if (busy || generation !== this.generation) return;
      busy = true;
      void this.call('gateway.ping', {}, 5000)
        .catch(() => this.fail(generation, new ClientError('network', 'Gateway heartbeat failed')))
        .finally(() => { busy = false; });
    }, interval);
  }
  private invalidate(error: ClientError): void {
    ++this.generation; // invalidate before closing: old callbacks must not mutate the new attempt
    clearTimeout(this.timer);
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    this.abort?.abort();
    this.socket?.close();
    this.socket = undefined;
    this.rejectConnect?.(error);
    this.resolveConnect = this.rejectConnect = undefined;
    this.connecting = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.requests.clear();
  }
  private fail(generation: number, error: ClientError): void {
    if (generation !== this.generation) return;
    this.invalidate(error);
    if (this.enabled && error.retryable && this.attempts < (this.options.maxRetries ?? 5)) {
      const delay = Math.min(this.options.retryMaxMs ?? 15_000, (this.options.retryBaseMs ?? 500) * 2 ** this.attempts);
      this.attempts++;
      this.publish('reconnecting', error);
      this.retry = setTimeout(() => { void this.begin().catch(() => {}); },
        delay * (0.5 + (this.options.random ?? Math.random)() / 2));
    } else this.publish(error.kind === 'auth-required' ? 'auth-required' : 'error', error);
  }
  call(method: string, params: Record<string, unknown> = {}, timeoutMs = this.options.requestTimeoutMs ?? 30_000): Promise<unknown> {
    const socket = this.socket;
    if (this.state.phase !== 'ready' || socket?.readyState !== 1)
      return Promise.reject(new ClientError('disconnected', 'Gateway is not ready'));
    if (this.pending.size >= 128) return Promise.reject(new ClientError('protocol', 'Too many pending Gateway requests'));
    const id = `ng-${this.generation}-${++this.sequence}`;
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    if (frame.length > 1_048_576) return Promise.reject(new ClientError('protocol', 'Gateway request is too large'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.options.diagnostics?.add({ event: 'rpc.failed', method, kind: 'timeout', generation: this.generation });
        reject(new ClientError('timeout', 'RPC acknowledgement timed out; delivery is unknown'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method, started: Date.now() });
      this.options.diagnostics?.add({ event: 'rpc.sent', method, generation: this.generation });
      try { socket.send(frame); } catch {
        this.fail(this.generation, new ClientError('network', 'Gateway send failed; delivery is unknown'));
      }
    });
  }
}
