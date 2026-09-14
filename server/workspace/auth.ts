import type { IncomingMessage } from 'node:http';
import type { Config } from '../config.js';
import { localAccess } from '../trusted-local.js';
import { WorkspaceError } from './files.js';

async function smallJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new WorkspaceError('WORKSPACE_AUTH_UNAVAILABLE', 503);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.length;
      if (bytes > 65_536) throw new Error();
      chunks.push(next.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } finally { await reader.cancel().catch(() => {}); }
}
/** Probe every read: no separate login, cookie stash, positive auth cache or claimed user header. */
export async function authoriseWorkspace(req: Pick<IncomingMessage, 'headers'>, config: Config): Promise<string[]> {
  try {
    if (config.authMode === 'trusted-local') { await localAccess(config); return []; }
    const cookie = req.headers.cookie;
    if (!cookie || cookie.length > 8192) throw new WorkspaceError('WORKSPACE_AUTH_REQUIRED', 401);
    const headers = { cookie, 'x-forwarded-prefix': '/__hermes',
      'x-forwarded-host': config.publicOrigin.host, 'x-forwarded-proto': config.publicOrigin.protocol.slice(0, -1) };
    const signal = AbortSignal.timeout(Math.min(3000, config.requestTimeoutMs));
    const status = await fetch(new URL('/api/status', config.upstream), { headers, signal, redirect: 'error' });
    if (!status.ok) { await status.body?.cancel(); throw new Error(); }
    if ((await smallJson(status)).auth_required !== true) throw new WorkspaceError('WORKSPACE_AUTH_REQUIRED', 401);
    const response = await fetch(new URL('/api/auth/me', config.upstream), { headers, signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      throw new WorkspaceError(response.status === 401 ? 'WORKSPACE_AUTH_REQUIRED' : response.status === 403 ? 'WORKSPACE_FORBIDDEN' : 'WORKSPACE_AUTH_UNAVAILABLE', [401, 403].includes(response.status) ? response.status : 503);
    }
    const identity = await smallJson(response);
    if (typeof identity.user_id !== 'string' || !identity.user_id || typeof identity.provider !== 'string' || !identity.provider)
      throw new WorkspaceError('WORKSPACE_AUTH_REQUIRED', 401);
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 16 || cookies.join('').length > 16384) throw new WorkspaceError('WORKSPACE_AUTH_UNAVAILABLE', 503);
    return cookies;
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError('WORKSPACE_AUTH_UNAVAILABLE', 503);
  }
}
