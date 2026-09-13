import type { DashboardClient, Identity, Provider } from './dashboard-client.js';
import type { GatewayClient, ConnectionState } from './gateway-client.js';
import { ClientError } from './protocol.js';
import { CapabilitiesStore } from './capabilities.js';
import { DiagnosticsRing } from './diagnostics.js';

type Dashboard = Pick<DashboardClient, 'status' | 'providers' | 'me' | 'login' | 'logout' | 'schema' | 'capabilities'>;
type Gateway = Pick<GatewayClient, 'state' | 'onState' | 'close' | 'connect' | 'suspend' | 'ensureLive' | 'advertised' | 'telemetry'>;
export interface FoundationState {
  rest: 'checking' | 'healthy' | 'unreachable' | 'error';
  auth: 'checking' | 'signed-in' | 'auth-required' | 'signed-out' | 'unconfirmed' | 'error';
  busy: boolean;
  offline: boolean;
  checkedAt?: number;
  error?: ClientError;
}
function safe(error: unknown): ClientError {
  return error instanceof ClientError ? error : new ClientError('protocol', 'Connection check failed');
}

/** Coordinates authority checks, not conversations. All account data is disposable memory. */
export class ConnectionStore {
  state: FoundationState = { rest: 'checking', auth: 'checking', busy: false, offline: false };
  providers: Provider[] = [];
  readonly capabilities = new CapabilitiesStore();
  private identity?: Identity;
  private scope = 0;
  private abort = new AbortController();
  private capabilityAbort?: AbortController;
  private probe?: Promise<void>;
  private desired = false;
  private disposed = false;
  private polling?: ReturnType<typeof setInterval>;
  private listeners = new Set<() => void>();
  private boundaries = new Set<() => void>();
  private removeGateway: () => void;
  private removeCapabilities: () => void;

  constructor(readonly dashboard: Dashboard, readonly gateway: Gateway, readonly diagnostics = new DiagnosticsRing()) {
    this.removeCapabilities = this.capabilities.subscribe(() => this.publish());
    this.removeGateway = gateway.onState((state) => this.transport(state));
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener); listener(); return () => { this.listeners.delete(listener); };
  }
  /** Clear transcript/composer/navigation BEFORE the next identity can attach a native session. */
  onIdentityBoundary(listener: () => void): () => void {
    this.boundaries.add(listener); return () => { this.boundaries.delete(listener); };
  }
  private publish(patch: Partial<FoundationState> = {}): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private current(scope: number): boolean { return !this.disposed && scope === this.scope; }
  private supersede(): number {
    ++this.scope; this.abort.abort(); this.abort = new AbortController(); this.probe = undefined;
    this.capabilityAbort?.abort(); this.capabilities.reset(); return this.scope;
  }
  private clearAccount(): void {
    // Subscribers must see admission disabled BEFORE any boundary/reset publishes.
    this.state = { ...this.state, auth: 'checking' };
    this.identity = undefined;
    for (const listener of this.boundaries) listener();
    this.capabilities.reset();
  }
  private requireAuth(error: ClientError): void {
    this.desired = false;
    this.supersede(); this.clearAccount();
    this.diagnostics.add({ event: 'auth.required', kind: error.kind });
    this.publish({ auth: 'auth-required', error });
    if (this.gateway.state.phase !== 'auth-required') this.gateway.suspend(error);
  }
  private transport(state: ConnectionState): void {
    if (this.disposed) return;
    if (state.phase === 'auth-required' && this.state.auth !== 'auth-required') {
      this.requireAuth(state.error ?? new ClientError('auth-required', 'Sign in again'));
      return;
    }
    if (state.phase === 'error') this.desired = false;
    this.capabilityAbort?.abort(); this.capabilities.begin();
    this.capabilities.gateway(state.phase, this.gateway.advertised());
    this.publish();
    if (state.phase === 'ready') void this.refreshCapabilities();
  }
  private accept(identity: Identity): boolean {
    const changed = !!this.identity && (identity.user_id !== this.identity.user_id || identity.provider !== this.identity.provider);
    if (changed) {
      this.clearAccount(); this.gateway.close(); this.diagnostics.add({ event: 'auth.changed' });
    }
    this.identity = identity;
    this.publish({ auth: 'signed-in', error: undefined });
    return changed;
  }
  /** Called by WsAuthClient before EVERY admission, including transport-owned retries. */
  async verifyAdmission(signal?: AbortSignal): Promise<void> {
    const scope = this.scope;
    const identity = await this.dashboard.me(signal);
    if (!this.current(scope) || signal?.aborted)
      throw new ClientError('disconnected', 'Admission verification superseded');
    if (this.state.auth !== 'signed-in' || !this.identity)
      throw new ClientError('auth-required', 'Sign in before opening the Gateway');
    if (identity.user_id !== this.identity.user_id || identity.provider !== this.identity.provider) {
      const error = new ClientError('auth-required', 'The signed-in account changed. Sign in again.');
      this.requireAuth(error);
      throw error;
    }
  }
  /** Explicit initial connection or user-requested retry; never invoked by a polling timer. */
  async start(): Promise<void> {
    if (this.state.busy) return;
    this.desired = true; this.supersede(); this.gateway.close(); await this.refresh(true);
  }
  refresh(connect = false): Promise<void> {
    if (this.state.busy || this.state.offline || this.disposed) return Promise.resolve();
    if (this.probe) return this.probe;
    const scope = this.scope; const signal = this.abort.signal;
    const task = (async () => {
      let restComplete = false;
      this.publish({ rest: 'checking' });
      try {
        await this.dashboard.status(signal);
        if (!this.current(scope)) return;
        this.publish({ rest: 'healthy', checkedAt: Date.now() });
        if (!this.providers.length || connect) {
          const providers = await this.dashboard.providers(signal);
          if (!this.current(scope)) return;
          this.providers = providers; this.publish();
        }
        const identity = await this.dashboard.me(signal);
        if (!this.current(scope)) return;
        restComplete = true;
        const changed = this.accept(identity);
        if ((connect || changed) && this.desired && !this.state.offline) await this.gateway.connect();
        else if (this.state.auth === 'signed-in') await this.refreshCapabilities();
      } catch (error) {
        if (!this.current(scope)) return;
        const failure = safe(error);
        if (failure.kind === 'auth-required') this.requireAuth(failure);
        else this.publish({ rest: restComplete ? this.state.rest : failure.retryable ? 'unreachable' : 'error',
          auth: this.identity ? 'signed-in' : 'error', error: failure });
      }
    })();
    const settled = task.finally(() => { if (this.probe === settled) this.probe = undefined; });
    this.probe = settled; return settled;
  }
  async login(provider: string, username: string, password: string): Promise<void> {
    if (this.state.busy) throw new ClientError('protocol', 'An authentication operation is already in progress');
    const scope = this.supersede(); this.clearAccount(); this.gateway.close();
    this.publish({ busy: true, auth: 'checking', error: undefined });
    try {
      const identity = await this.dashboard.login(provider, username, password, this.abort.signal);
      if (!this.current(scope)) return;
      this.accept(identity); this.publish({ rest: 'healthy', checkedAt: Date.now() }); this.desired = true;
      if (!this.state.offline) await this.gateway.connect();
    } catch (error) {
      if (this.current(scope)) {
        const failure = safe(error);
        if (failure.kind === 'auth-required') this.requireAuth(failure);
        else this.publish({ auth: this.identity ? 'signed-in' : 'error', error: failure });
      }
      throw error;
    } finally { this.publish({ busy: false }); }
  }
  async logout(): Promise<void> {
    if (this.state.busy) throw new ClientError('protocol', 'An authentication operation is already in progress');
    this.desired = false;
    const scope = this.supersede(); this.clearAccount(); this.gateway.close();
    this.publish({ busy: true, auth: 'unconfirmed', error: undefined });
    try {
      await this.dashboard.logout(this.abort.signal);
      if (this.current(scope)) this.publish({ auth: 'signed-out', rest: 'healthy', checkedAt: Date.now() });
    } catch (error) {
      if (this.current(scope)) this.publish({ auth: 'unconfirmed', error: safe(error) });
      throw error;
    } finally { this.publish({ busy: false }); }
  }
  disconnect(): void {
    if (this.state.busy) return;
    this.desired = false; this.supersede(); this.gateway.close(); this.publish();
  }
  async resume(): Promise<void> {
    this.diagnostics.add({ event: 'visibility.resume' });
    if (this.state.busy || this.state.offline || this.state.auth !== 'signed-in') return;
    await this.refresh();
    if (this.desired && this.state.auth === 'signed-in') await this.gateway.ensureLive();
  }
  async setOffline(offline: boolean): Promise<void> {
    const wasOffline = this.state.offline;
    this.publish({ offline });
    if (offline) { if (!this.state.busy) this.supersede(); this.gateway.close(); return; }
    if (wasOffline && this.desired && this.state.auth === 'signed-in') await this.refresh(true);
    else await this.resume();
  }
  poll(intervalMs = 30_000): void {
    clearInterval(this.polling);
    if (intervalMs <= 0) return;
    this.polling = setInterval(() => {
      if (this.state.auth === 'signed-in' && this.gateway.state.phase === 'ready') void this.refresh();
    }, intervalMs);
  }
  async refreshCapabilities(): Promise<void> {
    if (this.disposed || this.state.offline) return;
    this.capabilityAbort?.abort(); this.capabilityAbort = new AbortController();
    const signal = this.capabilityAbort.signal; const scope = this.scope;
    const generation = this.gateway.state.generation; const token = this.capabilities.begin();
    const valid = () => this.current(scope) && !signal.aborted && generation === this.gateway.state.generation;
    this.diagnostics.add({ event: 'capabilities.probe', generation });
    await Promise.all([
      this.dashboard.capabilities(signal).then((data) => { if (valid()) this.capabilities.applyWebui(token, data); }).catch(() => {}),
      this.state.auth === 'signed-in' ? this.dashboard.schema(signal).then((data) => {
        if (valid()) this.capabilities.applySchema(token, data);
      }).catch((error: unknown) => { if (valid()) this.capabilities.schemaFailed(token, error); }) : Promise.resolve(),
    ]);
    if (valid()) this.diagnostics.add({ event: 'capabilities.updated', generation });
  }
  report() {
    // Deliberate projection: never serialise this.state, identity, providers, or raw exceptions.
    return { schemaVersion: 1, webui: { version: '0.0.1', phase: 2 },
      connection: { rest: this.state.rest, auth: this.state.auth, offline: this.state.offline,
        checkedAt: this.state.checkedAt, gateway: this.gateway.state.phase,
        generation: this.gateway.state.generation, attempt: this.gateway.state.attempt,
        ...this.gateway.telemetry() }, capabilities: this.capabilities.snapshot(), events: this.diagnostics.snapshot() };
  }
  dispose(): void {
    this.disposed = true; this.desired = false; clearInterval(this.polling);
    this.supersede(); this.removeGateway(); this.removeCapabilities(); this.gateway.close();
    this.listeners.clear(); this.boundaries.clear(); this.identity = undefined; this.providers = [];
  }
}
