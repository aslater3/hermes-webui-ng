import { ClientError, record, textField } from './protocol.js';

export const WS_PROTOCOL = 'hermes-gateway-v1';
export interface WsCredential {
  url: string;
  protocols: string[];
}
export interface Identity {
  user_id: string;
  provider: string;
}
export interface Provider {
  name: string;
  display_name: string;
  supports_password: boolean;
}

/** Hermes alone owns auth cookies. Credentials and responses are never persisted here. */
export class DashboardClient {
  readonly origin: string;
  constructor(
    origin: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {
    const url = new URL(origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new ClientError('protocol', 'Expected the public WebUI origin');
    }
    this.origin = url.origin;
  }
  private async request(
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, `${this.origin}/__hermes${path}`, {
        method,
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
    } catch {
      if (signal?.aborted) throw new ClientError('disconnected', 'Request superseded');
      throw new ClientError(deadline.aborted ? 'timeout' : 'network', 'Hermes Dashboard request failed');
    }
    if (!response.ok) {
      const kind =
        response.status === 401
          ? 'auth-required'
          : response.status === 403
            ? 'forbidden'
            : response.status >= 500
              ? 'network'
              : 'protocol';
      throw new ClientError(kind, `Hermes Dashboard returned HTTP ${response.status}`);
    }
    try {
      return record(await response.json());
    } catch {
      throw new ClientError('protocol', 'Hermes Dashboard returned invalid JSON');
    }
  }
  async status(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const status = await this.request('/api/status', 'GET', undefined, signal);
    if (status.auth_required !== true) {
      throw new ClientError('protocol', 'Phase 0 requires an authenticated, non-loopback Hermes Dashboard');
    }
    return status;
  }
  async providers(signal?: AbortSignal): Promise<Provider[]> {
    const data = await this.request('/api/auth/providers', 'GET', undefined, signal);
    if (!Array.isArray(data.providers)) throw new ClientError('protocol', 'Invalid auth provider list');
    return data.providers.map((item: unknown) => {
      const row = record(item);
      return {
        name: textField(row, 'name'),
        display_name: textField(row, 'display_name'),
        supports_password: row.supports_password === true,
      };
    });
  }
  async me(signal?: AbortSignal): Promise<Identity> {
    const data = await this.request('/api/auth/me', 'GET', undefined, signal);
    return { user_id: textField(data, 'user_id'), provider: textField(data, 'provider') };
  }
  async login(provider: string, username: string, password: string, signal?: AbortSignal): Promise<Identity> {
    const data = await this.request('/auth/password-login', 'POST', { provider, username, password }, signal);
    if (data.ok !== true) throw new ClientError('auth-required', 'Sign-in was not accepted');
    return this.me(signal);
  }
  async credential(signal?: AbortSignal): Promise<WsCredential> {
    const data = await this.request('/api/auth/ws-ticket', 'POST', undefined, signal);
    const ticket = textField(data, 'ticket');
    if (
      !/^[A-Za-z0-9_-]{16,512}$/.test(ticket) ||
      typeof data.ttl_seconds !== 'number' ||
      data.ttl_seconds <= 0
    ) {
      throw new ClientError('protocol', 'Unsupported WebSocket ticket response');
    }
    const url = new URL('/__hermes/api/ws', this.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return { url: url.href, protocols: [WS_PROTOCOL, `hermes-gateway-ticket.${ticket}`] };
  }
}
