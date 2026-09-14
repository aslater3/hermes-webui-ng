import type { IncomingHttpHeaders } from 'node:http';
import type { WorkspaceRoot } from './safe-open.js';
import { WorkspaceError } from './safe-open.js';

export interface WritePolicy { enabled: boolean; roots: readonly string[] }
export const WRITE_LIMITS = { fileBytes: 262_144, bodyBytes: 1_600_000, requestMs: 15_000 } as const;
/** This only interprets operator configuration. It never changes permissions or mounts. */
export function writePolicy(env: NodeJS.ProcessEnv, roots: readonly WorkspaceRoot[], publicOrigin: URL): WritePolicy {
  if (env.WORKSPACE_WRITE_ENABLED && !['true', 'false'].includes(env.WORKSPACE_WRITE_ENABLED))
    throw new Error('WORKSPACE_WRITE_ENABLED must be true or false');
  const enabled = env.WORKSPACE_WRITE_ENABLED === 'true';
  const names = (env.WORKSPACE_WRITABLE_ROOTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (names.length > 8 || new Set(names).size !== names.length || names.some(id => !roots.some(root => root.id === id)))
    throw new Error('WORKSPACE_WRITABLE_ROOTS must select distinct configured logical root IDs');
  if (enabled && (!names.length || publicOrigin.protocol !== 'https:'))
    throw new Error('Workspace writes require HTTPS and explicit WORKSPACE_WRITABLE_ROOTS');
  if (!enabled && names.length) throw new Error('Writable roots require explicit WORKSPACE_WRITE_ENABLED=true');
  return { enabled, roots: names };
}
/** Defence in depth in addition to live Hermes admission. No new password/token store. */
export function assertWriteRequest(headers: IncomingHttpHeaders, publicOrigin: URL): void {
  if (publicOrigin.protocol !== 'https:' || headers.host !== publicOrigin.host || headers.origin !== publicOrigin.origin)
    throw new WorkspaceError('WORKSPACE_WRITE_ORIGIN_REJECTED', 403);
  if (headers['sec-fetch-site'] !== undefined && headers['sec-fetch-site'] !== 'same-origin')
    throw new WorkspaceError('WORKSPACE_WRITE_ORIGIN_REJECTED', 403);
  if (headers.referer !== undefined) {
    try { if (new URL(headers.referer).origin !== publicOrigin.origin) throw new Error(); }
    catch { throw new WorkspaceError('WORKSPACE_WRITE_ORIGIN_REJECTED', 403); }
  }
  if (headers['x-webui-request'] !== 'workspace-write') throw new WorkspaceError('WORKSPACE_WRITE_GUARD_REQUIRED', 403);
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers['content-type'] ?? '') ||
      headers['content-encoding'] !== undefined && headers['content-encoding'] !== 'identity')
    throw new WorkspaceError('WORKSPACE_WRITE_CONTENT_TYPE', 415);
}
export function writableRoot(policy: WritePolicy | undefined, root: WorkspaceRoot): boolean {
  return policy?.enabled === true && policy.roots.includes(root.id);
}
