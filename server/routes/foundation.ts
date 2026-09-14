import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../config.js';
import { json } from '../proxy/hermes-proxy.js';

export const PUBLIC_BUILD = { version: '0.0.1', phase: 5, milestone: '5', protocol: 'hermes-gateway-v1' } as const;
const WEBUI = PUBLIC_BUILD;
/** Only public, non-user-specific metadata may cross these unauthenticated endpoints. */
export function foundationRoutes(config: Config) {
  let cached: { expires: number; value: Promise<unknown> } | undefined;
  async function probe() {
    const response = await fetch(new URL('/api/status', config.upstream), {
      // Deliberately no browser cookies, Authorization, or client forwarding headers.
      headers: { host: config.authMode === 'trusted-local' ? config.upstream.host : config.publicOrigin.host, 'x-forwarded-prefix': '/__hermes' },
      redirect: 'error', signal: AbortSignal.timeout(Math.min(3000, config.requestTimeoutMs)),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { reachable: true, status: 'unavailable', authRequired: null };
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty status');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 262144) throw new Error('Status limit');
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof value !== 'object' || value === null || !('auth_required' in value) ||
      typeof value.auth_required !== 'boolean')
      return { reachable: true, status: 'unsupported', authRequired: null };
    return { reachable: true, status: value.auth_required || config.authMode === 'trusted-local' ? 'healthy' : 'requires-configuration',
      authRequired: value.auth_required };
  }
  function capabilities() {
    if (!cached || cached.expires <= Date.now()) {
      cached = { expires: Date.now() + 5000, value: probe().catch(() => ({
        reachable: false, status: 'unreachable', authRequired: null,
      })) };
    }
    return cached.value;
  }
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const path = req.url ?? '';
    if (!['/api/webui/health', '/api/webui/capabilities', '/api/webui/diagnostics'].includes(path)) return false;
    if (req.method !== 'GET') { json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }); return true; }
    if (path.endsWith('/health')) { json(res, 200, { ok: true, webui: WEBUI }); return true; }
    if (path.endsWith('/diagnostics')) {
      json(res, 200, { schemaVersion: 1, webui: WEBUI,
        policies: { metadataOnly: true, localChatPersistence: false, authCookieScopePreserved: true },
        limits: { maxRequestBytes: config.maxBodyBytes, requestTimeoutMs: config.requestTimeoutMs,
          capabilityCacheMs: 5000, clientDiagnosticEntries: 500 },
      });
      return true;
    }
    void capabilities().then((hermes) => {
      if (!res.destroyed) json(res, 200, { schemaVersion: 1, webui: WEBUI, hermes,
        gateway: { status: 'browser-not-probed' },
        workspace: { available: !!config.workspaceRoots?.length, writable: false, git: !!config.gitEnabled && !!config.workspaceRoots?.length },
        features: { nativeChatDiagnostic: true, diagnostics: true, pwa: true },
      });
    });
    return true;
  };
}
