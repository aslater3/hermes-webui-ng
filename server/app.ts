import { workspaceRoutes } from './routes/workspace.js';
import { pwaAsset } from './pwa.js';
import { transportServer } from './tls.js';
import { foundationRoutes } from './routes/foundation.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { Config } from './config.js';
import { PROXY_PREFIX } from './config.js';
import { localPathAllowed, localUpgradePath, localAccess } from './trusted-local.js';
import { allowedRequest, upstreamPath } from './proxy/headers.js';
import { json, proxyHttp, proxyUpgrade, refuseUpgrade, type Log } from './proxy/hermes-proxy.js';

export function createApp(config: Config, log: Log = (event) => console.log(JSON.stringify(event))) {
  const sockets = new Set<Duplex>();
  const foundation = foundationRoutes(config);
  const workspace = workspaceRoutes(config);
  const server = transportServer(config,
    (req, res) => {
      const raw = req.url ?? '/';
      const requestId = randomUUID();
      if (raw === '/healthz' && req.method === 'GET') {
        json(res, 200, { ok: true, version: '0.0.1-phase0' });
        return;
      }
      if (!allowedRequest(req, config)) {
        json(res, 403, { error: { code: 'ORIGIN_REJECTED', requestId } });
        return;
      }
      if (workspace(req, res)) return;
      if (raw === '/api/webui/access' && req.method === 'GET') {
        void localAccess(config).then(data => json(res, 200, data)).catch(() => json(res, 503, { error: { code: 'LOCAL_ACCESS_UNAVAILABLE' } }));
        return;
      }
      if (raw.startsWith(`${PROXY_PREFIX}/`)) {
        const path = upstreamPath(raw);
        if (!path) {
          json(res, 400, { error: { code: 'INVALID_PROXY_PATH', requestId } });
          return;
        }
        if (config.authMode === 'trusted-local' && !localPathAllowed(path, req.method ?? '')) {
          json(res, 403, { error: { code: 'LOCAL_ROUTE_UNAVAILABLE' } }); return;
        }
        proxyHttp(req, res, path, config, requestId, log);
        return;
      }
      if (raw === '/readyz' && req.method === 'GET') {
        if (config.authMode === 'trusted-local') {
          void localAccess(config).then(() => json(res, 200, { webui: 'ready', hermes: { reachable: true, authenticatedMode: false }, gateway: 'browser-not-probed' }))
            .catch(() => json(res, 503, { webui: 'ready', hermes: { reachable: false, authenticatedMode: false }, gateway: 'browser-not-probed' }));
          return;
        }
        void fetch(new URL('/api/status', config.upstream), {
          headers: { host: config.publicOrigin.host },
          signal: AbortSignal.timeout(3000),
          redirect: 'error',
        })
          .then(async (response) => {
            const data: unknown = await response.json();
            const gated =
              typeof data === 'object' &&
              data !== null &&
              'auth_required' in data &&
              data.auth_required === true;
            json(res, response.ok && gated ? 200 : 503, {
              webui: 'ready',
              hermes: { reachable: response.ok, authenticatedMode: gated },
              gateway: 'browser-not-probed',
            });
          })
          .catch(() =>
            json(res, 503, { webui: 'ready', hermes: { reachable: false }, gateway: 'browser-not-probed' }),
          );
        return;
      }
      if (foundation(req, res)) return;
      if (raw.startsWith('/api/')) {
        json(res, 404, { error: { code: 'CAPABILITY_UNAVAILABLE', requestId } });
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method ?? '')) {
        json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } });
        return;
      }
      const path = raw.split('?')[0] ?? '';
      const asset = pwaAsset(path) ?? (path === '/' ? 'index.html' : path === '/diagnostic' ? 'diagnostic.html'
        : /^\/(?:app\.js|styles\.css|hermes\/[a-z-]+\.js|assets\/[A-Za-z0-9_-]+\.(?:js|css|svg))$/.test(path) ? path.slice(1) : undefined);
      if (!asset) { json(res, 404, { error: { code: 'NOT_FOUND' } }); return; }
      void readFile(join(config.staticDir, asset))
        .then((content) => {
          const nonce = asset.endsWith('.html') ? randomBytes(18).toString('base64') : '';
          if (nonce) content = Buffer.from(content.toString('utf8').replace('</head>', `<meta name="webui-style-nonce" content="${nonce}"></head>`));
          const mime = asset.endsWith('.html') ? 'text/html' : asset.endsWith('.css') ? 'text/css' : asset.endsWith('.svg') ? 'image/svg+xml' : asset.endsWith('.png') ? 'image/png' : asset.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/javascript';
          res.writeHead(200, {
            'Content-Type': `${mime}; charset=utf-8`,
            'Cache-Control': asset.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
            'X-WebUI-Static': '1',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
            'Content-Security-Policy': `default-src 'self'; worker-src 'self'; manifest-src 'self'; script-src 'self'; style-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''}; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
          });
          res.end(req.method === 'HEAD' ? undefined : content);
        })
        .catch(() => json(res, 404, { error: { code: 'NOT_FOUND' } }));
    },
  );
  server.on('upgrade', (req, socket, head) => {
    const path = upstreamPath(req.url ?? '');
    if (req.method !== 'GET' || !allowedRequest(req, config, true) || !path || path.split('?')[0] !== '/api/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      refuseUpgrade(socket, 403); return;
    }
    const admittedPath = localUpgradePath(req, path, config);
    if (!admittedPath) { refuseUpgrade(socket, 403); return; }
    proxyUpgrade(req, socket, head, admittedPath, config, randomUUID(), log, sockets);
  });
  return {
    server,
    close: async () => {
      await workspace.close();
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
