import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../config.js';
import { json, type Log } from '../proxy/hermes-proxy.js';
import { authoriseWorkspace } from '../workspace/auth.js';
import { WorkspaceWriter } from '../workspace/atomic-save.js';
import { WorkspaceFiles, currentWrite, mutationPath, expectedVersion } from '../workspace/file-operations.js';
import { WorkspaceError } from '../workspace/safe-open.js';
import { assertWriteRequest, writableRoot, WRITE_LIMITS } from '../workspace/write-policy.js';
import { WriteAudit, type WriteAuditEvent } from '../workspace/write-audit.js';

const METHODS: Record<string, string> = { 'files/write': 'PUT', 'files/mkdir': 'POST', 'files/rename': 'POST', 'files/delete': 'DELETE', 'files/upload': 'POST' };
/** Bounded streaming with no decompression, persistence, automatic replay or multipart ambiguity. */
async function* body(req: IncomingMessage, signal: AbortSignal, max: number): AsyncGenerator<Uint8Array> {
  let bytes = 0;
  const abort = () => { if (!req.complete) req.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      currentWrite(signal); bytes += (chunk as Buffer).length;
      if (bytes > max) throw new WorkspaceError('WORKSPACE_UPLOAD_TOO_LARGE', 413);
      yield chunk as Buffer;
    }
    currentWrite(signal);
  } finally { signal.removeEventListener('abort', abort); }
}
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)))
    throw new WorkspaceError('WORKSPACE_INVALID_SAVE');
  return value as Record<string, unknown>;
}
export function workspaceWriteRoutes(config: Config, log: Log) {
  const writer = new WorkspaceWriter(), files = new WorkspaceFiles(config.writePolicy);
  const lifetime = new AbortController(), audit = new WriteAudit(log);
  let inflight = 0;
  const rates = new Map<string, { count: number; until: number }>();
  const active = new Set<Promise<void>>();
  const handler = (req: IncomingMessage, res: ServerResponse, route: string): boolean => {
    const method = METHODS[route]; if (!method) return false;
    // Preserve Phase 5's unavailable route when disabled, and never opt in from a request.
    if (!config.writePolicy?.enabled) { json(res, req.method === 'GET' ? 404 : 403, { error: { code: 'WORKSPACE_READ_ONLY' } }); return true; }
    if (req.method !== method) { json(res, 405, { error: { code: 'WORKSPACE_METHOD_NOT_ALLOWED' } }); return true; }
    const now = Date.now(), address = req.socket.remoteAddress ?? 'unknown';
    for (const [key, rate] of rates) if (rate.until <= now) rates.delete(key);
    const rate = rates.get(address) ?? { count: 0, until: now + 60_000 };
    if (inflight >= 4 || ++rate.count > 60 || (!rates.has(address) && rates.size >= 128)) {
      json(res, 429, { error: { code: 'WORKSPACE_BUSY' } }); return true;
    }
    rates.set(address, rate); ++inflight;
    const cancelled = new AbortController();
    const signal = AbortSignal.any([cancelled.signal, lifetime.signal, AbortSignal.timeout(WRITE_LIMITS.requestMs)]);
    const cancel = () => cancelled.abort(); req.once('aborted', cancel); res.once('close', cancel);
    const operation = route.slice(6) === 'write' ? 'save' : route.slice(6) as WriteAuditEvent['operation'];
    const finish = audit.begin(req.headers.cookie, operation);
    let rootId: string | undefined, path: string | undefined;
    const task = (async () => {
      try {
        const raw = req.url ?? '';
        if (raw.length > 8192 || /%(?![a-fA-F0-9]{2})/.test(raw)) throw new WorkspaceError('WORKSPACE_INVALID_QUERY');
        const upload = route === 'files/upload';
        assertWriteRequest(req.headers, config.publicOrigin, upload);
        const admission = async () => {
          currentWrite(signal);
          const cookies = await authoriseWorkspace(req, config);
          currentWrite(signal);
          if (cookies.length && !res.headersSent) res.setHeader('Set-Cookie', cookies);
        };
        await admission();
        const params = new URL(raw, config.publicOrigin).searchParams;
        let data: Record<string, unknown>;
        if (upload) {
          for (const key of params.keys()) if (!['root', 'path'].includes(key) || params.getAll(key).length !== 1) throw new WorkspaceError('WORKSPACE_INVALID_QUERY');
          data = { root: params.get('root'), path: params.get('path') };
        } else {
          if (params.size) throw new WorkspaceError('WORKSPACE_INVALID_QUERY');
          const chunks: Uint8Array[] = [];
          for await (const chunk of body(req, signal, WRITE_LIMITS.bodyBytes)) chunks.push(chunk);
          try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as Record<string, unknown>; }
          catch { throw new WorkspaceError('WORKSPACE_INVALID_JSON'); }
          const keys = route === 'files/write' ? ['root', 'path', 'text', 'expectedVersion'] : route === 'files/mkdir' ? ['root', 'path', 'confirm'] : route === 'files/rename' ? ['root', 'path', 'target', 'expectedVersion', 'confirm'] : ['root', 'path', 'expectedVersion', 'confirm'];
          fields(data, keys);
          if (route !== 'files/write' && data.confirm !== true) throw new WorkspaceError('WORKSPACE_CONFIRMATION_REQUIRED', 428);
        }
        if (typeof data.root !== 'string') throw new WorkspaceError('WORKSPACE_INVALID_SAVE');
        rootId = data.root; path = mutationPath(data.path).join('/');
        const root = config.workspaceRoots?.find(root => root.id === rootId);
        if (!root || !writableRoot(config.writePolicy, root)) throw new WorkspaceError('WORKSPACE_READ_ONLY', 403);
        const checks = { signal, beforeCommit: admission };
        let result: unknown;
        if (upload) result = await files.create(root, path, body(req, signal, 10_485_760), 10_485_760, checks);
        else if (route === 'files/write') result = await writer.save(root, config.writePolicy, data, checks);
        else if (route === 'files/mkdir') result = await files.directory(root, path, checks);
        else if (route === 'files/rename') result = await files.rename(root, path, mutationPath(data.target).join('/'), expectedVersion(data.expectedVersion), checks);
        else result = await files.remove(root, path, expectedVersion(data.expectedVersion), checks);
        const outcome = (result as { outcome: string }).outcome;
        finish(200, outcome === 'unchanged' ? 'unchanged' : 'saved', rootId, path);
        if (!res.destroyed) json(res, 200, result);
      } catch (error) {
        const failure = error instanceof WorkspaceError ? error : new WorkspaceError('WORKSPACE_OPERATION_UNAVAILABLE', 503);
        finish(failure.status, failure.code.endsWith('UNCONFIRMED') ? 'unconfirmed' : failure.status === 409 ? 'conflict' : 'rejected', rootId, path);
        if (!res.headersSent && !res.destroyed) { if (!req.complete) res.setHeader('Connection', 'close'); json(res, failure.status, { error: { code: failure.code } }); }
      } finally { --inflight; req.removeListener('aborted', cancel); res.removeListener('close', cancel); }
    })();
    active.add(task); void task.finally(() => active.delete(task)); return true;
  };
  return Object.assign(handler, { close: async () => { lifetime.abort(); await writer.close(); await Promise.all(active); } });
}
