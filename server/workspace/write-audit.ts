import { createHmac, randomBytes, randomUUID } from 'node:crypto';

export interface WriteAuditEvent {
  event: 'workspace.write'; requestId: string; operation: 'save' | 'mkdir' | 'rename' | 'delete' | 'upload'; status: number; durationMs: number;
  outcome: 'saved' | 'unchanged' | 'conflict' | 'rejected' | 'unconfirmed';
  root?: string; pathTag?: string; actorTag?: string; bytes?: number;
}
/** Fixed metadata only. Process-private salted tags do not disclose filenames, cookies or contents. */
export class WriteAudit {
  private readonly key = randomBytes(32);
  constructor(private readonly log: (event: WriteAuditEvent) => void) {}
  begin(cookie: string | undefined, operation: WriteAuditEvent['operation'] = 'save') {
    const started = performance.now(), requestId = randomUUID();
    const tag = (type: string, value: string) => createHmac('sha256', this.key).update(type).update('\0').update(value).digest('hex').slice(0, 24);
    const actorTag = cookie ? tag('actor', cookie) : undefined;
    let finished = false;
    return (status: number, outcome: WriteAuditEvent['outcome'], root?: string, path?: string, bytes?: number) => {
      if (finished) return; finished = true;
      const event: WriteAuditEvent = { event: 'workspace.write', requestId, operation, status,
        outcome, durationMs: Math.max(0, Math.round(performance.now() - started)),
        ...(root && /^workspace(?:-[2-8])?$/.test(root) ? { root } : {}),
        ...(path ? { pathTag: tag('path', (root ?? '') + '/' + path) } : {}), ...(actorTag ? { actorTag } : {}),
        ...(typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 262144 ? { bytes } : {}),
      };
      // A failing log sink cannot turn a committed save into an automatic retry.
      try { this.log(event); } catch { /* Transport handling remains authoritative. */ }
    };
  }
}
