import { ClientError } from './protocol.js';
export const WS_PROTOCOL = 'hermes-gateway-v1';
export interface WsCredential { url: string; protocols: string[] }
export interface TicketSource {
  origin: string;
  ticket(signal?: AbortSignal): Promise<{ ticket: string; ttl_seconds: number }>;
}
/** No cache: one credential mint per admission, including every reconnect. */
export class WsAuthClient {
  constructor(private readonly source: TicketSource) {}
  async credential(signal?: AbortSignal): Promise<WsCredential> {
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
