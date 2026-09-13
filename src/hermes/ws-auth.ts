import { ClientError } from './protocol.js';
export const WS_PROTOCOL = 'hermes-gateway-v1';
export interface WsCredential { url: string; protocols: string[] }
export interface TicketSource {
  origin: string;
  readonly admissionMode?: 'dashboard' | 'trusted-local';
  verifyLocalAccess?(signal?: AbortSignal): Promise<void>;
  ticket(signal?: AbortSignal): Promise<{ ticket: string; ttl_seconds: number }>;
}
/** Gated admissions mint once; explicit local admissions revalidate the server-side bridge. */
export class WsAuthClient {
  constructor(private readonly source: TicketSource, private readonly beforeMint?: (signal?: AbortSignal) => Promise<void>) {}
  async credential(signal?: AbortSignal): Promise<WsCredential> {
    if (signal?.aborted) throw new ClientError('disconnected', 'Credential attempt superseded');
    await this.beforeMint?.(signal);
    if (signal?.aborted) throw new ClientError('disconnected', 'Credential attempt superseded');
    if (this.source.admissionMode === 'trusted-local') {
      if (!this.source.verifyLocalAccess) throw new ClientError('protocol', 'No local access verifier');
      await this.source.verifyLocalAccess(signal);
      if (signal?.aborted) throw new ClientError('disconnected', 'Credential attempt superseded');
      const url = new URL('/__hermes/api/ws', this.source.origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ClientError('protocol', 'Invalid WebUI origin');
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return { url: url.href, protocols: [WS_PROTOCOL] };
    }
    const data = await this.source.ticket(signal);
    if (signal?.aborted) throw new ClientError('disconnected', 'Credential attempt superseded');
    if (!/^[A-Za-z0-9_-]{16,512}$/.test(data.ticket) || !Number.isFinite(data.ttl_seconds) || data.ttl_seconds <= 0)
      throw new ClientError('protocol', 'Unsupported WebSocket ticket response');
    const url = new URL('/__hermes/api/ws', this.source.origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new ClientError('protocol', 'Invalid WebUI origin');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return { url: url.href, protocols: [WS_PROTOCOL, `hermes-gateway-ticket.${data.ticket}`] };
  }
}
