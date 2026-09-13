import { ClientError, record, textField } from './protocol.js';
import { WsAuthClient } from './ws-auth.js';
import type { DiagnosticsRing } from './diagnostics.js';
export { WS_PROTOCOL, type WsCredential } from './ws-auth.js';
export interface Identity { user_id: string; provider: string }
export interface Provider { name: string; display_name: string; supports_password: boolean }
export class HttpError extends ClientError {
  constructor(readonly status: number, readonly expired = false) {
    super(status === 401 ? 'auth-required' : status === 403 ? 'forbidden' :
      status >= 500 ? 'network' : 'protocol', `Hermes Dashboard returned HTTP ${status}`);
  }
}
const ROUTES = {
  status: '/__hermes/api/status', providers: '/__hermes/api/auth/providers',
  identity: '/__hermes/api/auth/me', ticket: '/__hermes/api/auth/ws-ticket',
  login: '/__hermes/auth/password-login', logout: '/__hermes/auth/logout',
  schema: '/__hermes/openapi.json', capabilities: '/api/webui/capabilities',
} as const;
type Route = keyof typeof ROUTES;

/** Bounded reads protect clients even when content-length is absent or dishonest. */
export async function boundedJson(response: Response, maxBytes = 4_194_304): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new ClientError('protocol', 'Empty response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > maxBytes) throw new ClientError('protocol', 'Response exceeds the configured limit');
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return record(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof ClientError) throw error;
    throw new ClientError('protocol', 'Hermes Dashboard returned invalid JSON');
  } finally { await reader.cancel().catch(() => {}); }
}

/** Hermes alone owns auth cookies; neither credentials nor raw responses are persisted. */
export class DashboardClient {
  readonly origin: string;
  constructor(origin: string, private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 15_000, private readonly diagnostics?: DiagnosticsRing) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash)
      throw new ClientError('protocol', 'Expected the public WebUI origin');
    this.origin = url.origin;
  }
  private async response(route: Route, method = 'GET', body?: unknown, signal?: AbortSignal,
    redirect: RequestRedirect = 'error'): Promise<Response> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const started = Date.now();
    this.diagnostics?.add({ event: 'rest.request', route });
    try {
      const response = await this.fetcher.call(globalThis, this.origin + ROUTES[route], {
        method, credentials: route === 'capabilities' ? 'omit' : 'include', cache: 'no-store', redirect,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
      if (signal?.aborted) { await response.body?.cancel(); throw new ClientError('disconnected', 'Request superseded'); }
      this.diagnostics?.add({ event: 'rest.response', route, status: response.status, durationMs: Date.now() - started });
      return response;
    } catch (error) {
      const kind = signal?.aborted ? 'disconnected' : deadline.aborted ? 'timeout' : 'network';
      this.diagnostics?.add({ event: 'rest.failed', route, kind });
      if (error instanceof ClientError) throw error;
      throw new ClientError(kind, kind === 'disconnected' ? 'Request superseded' : 'Hermes Dashboard request failed');
    }
  }
  private async request(route: Route, method = 'GET', body?: unknown, signal?: AbortSignal) {
    const response = await this.response(route, method, body, signal);
    if (!response.ok) {
      const detail = await boundedJson(response, 8192).catch(() => ({}));
      throw new HttpError(response.status, 'error' in detail && detail.error === 'session_expired');
    }
    const data = await boundedJson(response);
    if (signal?.aborted) throw new ClientError('disconnected', 'Request superseded');
    return data;
  }
  async status(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const data = await this.request('status', 'GET', undefined, signal);
    if (data.auth_required !== true)
      throw new ClientError('protocol', 'An authenticated Hermes Dashboard is required');
    // Status includes local paths and platform errors upstream: discard them here.
    return { auth_required: true, version: typeof data.version === 'string' &&
      /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]+)?$/.test(data.version) ? data.version : null };
  }
  async providers(signal?: AbortSignal): Promise<Provider[]> {
    const data = await this.request('providers', 'GET', undefined, signal);
    if (!Array.isArray(data.providers) || data.providers.length > 64)
      throw new ClientError('protocol', 'Invalid auth provider list');
    return data.providers.map((item: unknown) => {
      const row = record(item);
      return { name: textField(row, 'name').slice(0, 256),
        display_name: textField(row, 'display_name').slice(0, 256), supports_password: row.supports_password === true };
    });
  }
  async me(signal?: AbortSignal): Promise<Identity> {
    const data = await this.request('identity', 'GET', undefined, signal);
    return { user_id: textField(data, 'user_id'), provider: textField(data, 'provider') };
  }
  async login(provider: string, username: string, password: string, signal?: AbortSignal): Promise<Identity> {
    const data = await this.request('login', 'POST', { provider, username, password }, signal);
    if (data.ok !== true) throw new ClientError('auth-required', 'Sign-in was not accepted');
    const identity = await this.me(signal);
    this.diagnostics?.add({ event: 'auth.login' });
    return identity;
  }
  async logout(signal?: AbortSignal): Promise<void> {
    // Browser manual redirects are opaqueredirect (status 0); never follow into upstream HTML/SSO.
    const response = await this.response('logout', 'POST', undefined, signal, 'manual');
    await response.body?.cancel();
    if (response.type !== 'opaqueredirect' && response.status !== 302 && !response.ok)
      throw new HttpError(response.status);
    try { await this.me(signal); } catch (error) {
      if (error instanceof ClientError && error.kind === 'auth-required') {
        this.diagnostics?.add({ event: 'auth.logout' }); return;
      }
      throw error;
    }
    throw new ClientError('protocol', 'Hermes sign-out could not be verified');
  }
  async ticket(signal?: AbortSignal): Promise<{ ticket: string; ttl_seconds: number }> {
    const data = await this.request('ticket', 'POST', undefined, signal);
    if (typeof data.ttl_seconds !== 'number') throw new ClientError('protocol', 'Invalid ticket lifetime');
    this.diagnostics?.add({ event: 'auth.ticket' });
    return { ticket: textField(data, 'ticket'), ttl_seconds: data.ttl_seconds };
  }
  /** Compatibility facade for the Phase 0 runner; new callers use WsAuthClient. */
  credential(signal?: AbortSignal) { return new WsAuthClient(this).credential(signal); }
  schema(signal?: AbortSignal) { return this.request('schema', 'GET', undefined, signal); }
  capabilities(signal?: AbortSignal) { return this.request('capabilities', 'GET', undefined, signal); }
}
