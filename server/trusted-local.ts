import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import type { Config } from './config.js';

const PROTOCOL = 'hermes-gateway-v1';
export function isPrivateHost(host: string): boolean {
  if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return true;
  if (/^\[f[cd][0-9a-f:]+\]$/i.test(host)) return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31);
}
export function configureAccess(config: Config, env: NodeJS.ProcessEnv): void {
  const mode = env.HERMES_AUTH_MODE ?? 'dashboard';
  if (mode !== 'dashboard' && mode !== 'trusted-local') throw new Error('Invalid HERMES_AUTH_MODE');
  config.authMode = mode;
  const token = env.HERMES_DASHBOARD_SESSION_TOKEN;
  if (mode === 'dashboard') {
    if (token) throw new Error('A local session token requires explicit trusted-local mode');
    return;
  }
  if (!['127.0.0.1', '[::1]'].includes(config.upstream.hostname))
    throw new Error('Trusted-local mode requires a literal loopback upstream address');
  if (!isPrivateHost(config.publicOrigin.hostname))
    throw new Error('Trusted-local mode requires a private IP or loopback public origin');
  if (!token || !/^[A-Za-z0-9_.~-]{16,512}$/.test(token))
    throw new Error('Trusted-local mode requires an operator-supplied session token');
  // Prevent accidental config serialisation from exporting this server-only credential.
  Object.defineProperty(config, 'sessionToken', { value: token, enumerable: false });
}
export function localRequestHeaders(headers: OutgoingHttpHeaders, config: Config, upgrade: boolean): void {
  if (config.authMode !== 'trusted-local') return;
  delete headers.cookie; delete headers.authorization; delete headers.referer;
  delete headers['x-hermes-session-token']; delete headers['sec-websocket-protocol'];
  headers.host = config.upstream.host;
  headers.origin = config.upstream.origin;
  headers['x-forwarded-host'] = config.upstream.host;
  headers['x-forwarded-proto'] = config.upstream.protocol.slice(0, -1);
  if (!upgrade) headers['x-hermes-session-token'] = config.sessionToken;
}
/** Deliberately no Dashboard HTML, config export, files or REST mutations in this mode. */
export function localPathAllowed(path: string, method: string): boolean {
  if (!['GET', 'HEAD'].includes(method)) return false;
  const url = new URL(path, 'http://local');
  for (const key of url.searchParams.keys()) if (['token', 'ticket', 'internal'].includes(key.toLowerCase())) return false;
  return ['/api/status', '/api/sessions', '/api/sessions/search', '/api/profiles', '/api/model/options', '/openapi.json'].includes(url.pathname) ||
    /^\/api\/sessions\/[^/]+\/messages$/.test(url.pathname);
}
export function localUpgradePath(req: IncomingMessage, path: string, config: Config): string | undefined {
  if (config.authMode !== 'trusted-local') return path;
  if (path !== '/api/ws' || req.headers['sec-websocket-protocol']?.trim() !== PROTOCOL) return undefined;
  // This credential exists only on the loopback hop, never in the browser URL.
  return `/api/ws?${new URLSearchParams({ token: config.sessionToken! })}`;
}
export function localHandshake(headers: OutgoingHttpHeaders, config: Config): boolean {
  if (config.authMode !== 'trusted-local') return true;
  // No protocol was offered upstream. Do not launder an unexpected negotiated protocol.
  if (headers['sec-websocket-protocol']) return false;
  headers['sec-websocket-protocol'] = PROTOCOL;
  delete headers['set-cookie'];
  return true;
}
async function smallJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader(); if (!reader) throw new Error();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.length; if (bytes > 262144) throw new Error(); chunks.push(value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } finally { await reader.cancel().catch(() => {}); }
}
/** No cookie identity is fabricated. Readiness proves both mode and operator-token validity. */
export async function localAccess(config: Config): Promise<{ mode: string; authenticated: false; ready: boolean }> {
  if (config.authMode !== 'trusted-local') return { mode: 'dashboard', authenticated: false, ready: false };
  const signal = AbortSignal.timeout(Math.min(3000, config.requestTimeoutMs));
  const headers = { host: config.upstream.host, 'x-hermes-session-token': config.sessionToken! };
  const options: RequestInit = { headers, signal, redirect: 'error' };
  const status = await fetch(new URL('/api/status', config.upstream), options);
  if (!status.ok || (await smallJson(status)).auth_required !== false) throw new Error('Local mode mismatch');
  const protectedResponse = await fetch(new URL('/api/sessions?limit=1', config.upstream), options);
  const valid = protectedResponse.ok && protectedResponse.headers.get('content-type')?.includes('application/json');
  await protectedResponse.body?.cancel();
  if (!valid) throw new Error('Local upstream credential rejected');
  return { mode: 'trusted-local', authenticated: false, ready: true };
}
