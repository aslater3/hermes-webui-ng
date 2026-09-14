import { workspaceWriteRoutes } from './workspace-write.js';
import { writableRoot } from '../workspace/write-policy.js';
import { fileSnapshot } from '../workspace/file-version.js';
import { entryInfo } from '../workspace/file-operations.js';
import { WorkspaceGit } from '../workspace/git.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { basename } from 'node:path';
import type { Config } from '../config.js';
import { json, type Log } from '../proxy/hermes-proxy.js';
import { authoriseWorkspace } from '../workspace/auth.js';
import { FILE_LIMITS, openWorkspacePath, preview, tree, WorkspaceError } from '../workspace/files.js';

/** Cookie-scoped alias is LOCAL, reserved before the Hermes proxy; see ADR-022. */
export const WORKSPACE_ALIAS = '/__hermes/webui-local/';
export function workspaceRoutes(config: Config, log: Log = () => {}) {
  const git = new WorkspaceGit();
  const writes = workspaceWriteRoutes(config, log);
  let inflight = 0;
  const rates = new Map<string, { count: number; until: number }>();
  const handler = (req: IncomingMessage, res: ServerResponse): boolean => {
    const raw = req.url ?? '';
    const scoped = raw.startsWith(WORKSPACE_ALIAS);
    const canonical = (raw.startsWith('/api/webui/files/') || raw.startsWith('/api/webui/git/')) || raw.split('?')[0] === '/api/webui/workspaces';
    if (!scoped && !canonical) return false;
    const route = raw.slice(scoped ? WORKSPACE_ALIAS.length : '/api/webui/'.length).split('?')[0];
    if (writes(req, res, route ?? '')) return true;
    if (!['workspaces', 'files/tree', 'files/read', 'files/download', 'files/info', 'git/repos', 'git/status', 'git/diff'].includes(route ?? '')) {
      json(res, 404, { error: { code: 'WORKSPACE_ROUTE_UNAVAILABLE' } }); return true;
    }
    if (req.method !== 'GET') { json(res, 405, { error: { code: 'WORKSPACE_READ_ONLY' } }); return true; }
    if (raw.length > 8192 || /%(?![a-fA-F0-9]{2})/.test(raw)) { json(res, 400, { error: { code: 'WORKSPACE_INVALID_PATH' } }); return true; }
    const now = Date.now();
    for (const [key, rate] of rates) if (rate.until <= now) rates.delete(key);
    const address = req.socket.remoteAddress ?? 'unknown';
    const rate = rates.get(address) ?? { count: 0, until: now + 60_000 };
    if (inflight >= 4 || ++rate.count > 120 || (!rates.has(address) && rates.size >= 128)) {
      json(res, 429, { error: { code: 'WORKSPACE_BUSY' } }); return true;
    }
    rates.set(address, rate); ++inflight;
    void (async () => {
      try {
        const refreshedCookies = await authoriseWorkspace(req, config);
        if (res.destroyed) return;
        if (refreshedCookies.length) res.setHeader('Set-Cookie', refreshedCookies);
        const params = new URL(raw, config.publicOrigin).searchParams;
        const allowed = route === 'workspaces' ? [] : route === 'git/status' ? ['root', 'repo'] : route === 'git/diff' ? ['root', 'repo', 'path', 'staged'] : ['root', 'path', ...(route === 'files/tree' ? ['offset'] : [])];
        for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new WorkspaceError('WORKSPACE_INVALID_QUERY');
        const roots = config.workspaceRoots ?? [];
        if (route === 'workspaces') {
          json(res, 200, { roots: roots.map(root => ({ id: root.id, label: root.label, writable: writableRoot(config.writePolicy, root) })), git: !!config.gitEnabled && !!roots.length, limits: FILE_LIMITS }); return;
        }
        const root = roots.find(item => item.id === params.get('root'));
        if (!root) throw new WorkspaceError('WORKSPACE_ROOT_UNAVAILABLE', 404);
        const path = params.get('path') ?? '';
        if (route?.startsWith('git/')) {
          if (!config.gitEnabled) throw new WorkspaceError('GIT_DISABLED', 404);
          const staged = params.get('staged') ?? 'false';
          if (!['true', 'false'].includes(staged)) throw new WorkspaceError('WORKSPACE_INVALID_QUERY');
          const action = route.slice(4) as 'repos' | 'status' | 'diff';
          json(res, 200, await git.read(root, action === 'repos' ? path : params.get('repo') ?? '', action, path, staged === 'true')); return;
        }
        if (route === 'files/tree') {
          const offset = params.get('offset') ?? '0';
          if (!/^\d{1,4}$/.test(offset)) throw new WorkspaceError('WORKSPACE_INVALID_PAGE');
          json(res, 200, await tree(root, path, Number(offset))); return;
        }
        if (route === 'files/info') { json(res, 200, await entryInfo(root, path)); return; }
        if (route === 'files/read') {
          const result = await preview(root, path);
          if (writableRoot(config.writePolicy, root) && result.kind === 'text') {
            const handle = await openWorkspacePath(root, path);
            try { const current = await fileSnapshot(handle, root); json(res, 200, { ...result, text: current.text, size: current.content.length, version: current.version }); }
            finally { await handle.close(); }
          } else json(res, 200, result);
          return;
        }
        const handle = await openWorkspacePath(root, path);
        try {
          const stat = await handle.stat();
          if (stat.size > FILE_LIMITS.downloadBytes) throw new WorkspaceError('WORKSPACE_DOWNLOAD_TOO_LARGE', 413);
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "sandbox; default-src 'none'",
            'Content-Disposition': `attachment; filename="workspace-download"; filename*=UTF-8''${encodeURIComponent(basename(path)).replace(/'/g, '%27')}` });
          if (!stat.size) { res.end(); return; }
          // The finite end prevents an append-only producer from creating an unbounded download.
          await pipeline(handle.createReadStream({ autoClose: false, start: 0, end: stat.size - 1 }), res, { signal: AbortSignal.timeout(15_000) });
        } finally { await handle.close(); }
      } catch (error) {
        const failure = error instanceof WorkspaceError ? error : new WorkspaceError('WORKSPACE_UNAVAILABLE', 503);
        if (!res.headersSent && !res.destroyed) json(res, failure.status, { error: { code: failure.code } });
        else if (!res.destroyed) res.destroy();
      } finally { --inflight; }
    })();
    return true;
  };
  return Object.assign(handler, { close: async () => { await writes.close(); await git.close(); } });
}
