import { ClientError, record } from './protocol.js';

/** Wire outcomes from native slash.exec / command.dispatch, not executable browser code. */
export type CommandResult =
  | { kind: 'output'; output: string; warning?: string; truncated: boolean; pending: boolean }
  | { kind: 'send'; message: string; display?: string; notice?: string }
  | { kind: 'prefill'; message: string; notice?: string }
  | { kind: 'alias'; target: string }
  | { kind: 'task'; id: string; event: 'background.complete' | 'btw.complete' };
export const COMMAND_RESULT_LIMITS = { output: 32768, generatedPrompt: 1048576, draft: 32768, alias: 32768, notice: 2048 } as const;

function text(raw: unknown, max: number): string {
  if (typeof raw !== 'string' || raw.length > max || raw.includes('\0'))
    throw new ClientError('protocol', 'Hermes returned an invalid or oversized command result. Nothing was forwarded.');
  return raw;
}
function optional(raw: unknown): string | undefined {
  return raw === undefined ? undefined : text(raw, COMMAND_RESULT_LIMITS.notice);
}
/** Do not truncate model-facing input or alias targets: truncation changes the requested operation. */
export function commandResult(raw: unknown): CommandResult {
  const data = record(raw);
  switch (data.type) {
    case undefined: case 'exec': case 'plugin': {
      if ('message' in data || 'target' in data || (data.status !== undefined && data.status !== 'pending'))
        throw new ClientError('protocol', 'Hermes returned an ambiguous command result. Nothing was forwarded.');
      const output = text(data.output, 4_000_000);
      return { kind: 'output', output: output.slice(0, COMMAND_RESULT_LIMITS.output),
        truncated: output.length > COMMAND_RESULT_LIMITS.output, pending: data.status === 'pending',
        ...(data.warning !== undefined ? { warning: optional(data.warning) } : {}) };
    }
    case 'send': case 'skill': {
      if ('target' in data || 'output' in data || 'status' in data)
        throw new ClientError('protocol', 'Hermes returned an ambiguous command prompt. Nothing was forwarded.');
      const message = text(data.message, COMMAND_RESULT_LIMITS.generatedPrompt);
      if (!message.trim()) throw new ClientError('protocol', 'Hermes returned an empty command prompt. Nothing was sent.');
      return { kind: 'send', message, ...(data.display !== undefined ? { display: optional(data.display) } : {}),
        ...(data.notice !== undefined ? { notice: optional(data.notice) } : {}) };
    }
    case 'prefill': {
      if ('target' in data || 'output' in data || 'status' in data)
        throw new ClientError('protocol', 'Hermes returned an ambiguous edit result. Nothing was forwarded.');
      return { kind: 'prefill', message: text(data.message, COMMAND_RESULT_LIMITS.draft),
        ...(data.notice !== undefined ? { notice: optional(data.notice) } : {}) };
    }
    case 'alias': {
      if ('message' in data || 'output' in data || 'status' in data)
        throw new ClientError('protocol', 'Hermes returned an ambiguous alias. Nothing was forwarded.');
      const target = text(data.target, COMMAND_RESULT_LIMITS.alias).trim();
      if (!target) throw new ClientError('protocol', 'Hermes returned an empty alias. Nothing was forwarded.');
      return { kind: 'alias', target };
    }
    default: throw new ClientError('protocol', 'This Hermes command response is not supported. Nothing was forwarded or replayed.');
  }
}

/** A native read must never turn into a prompt, alias or mutation just because a response changed shape. */
export function readOnlyCommandResult(raw: unknown): Extract<CommandResult, { kind: 'output' }> {
  const result = commandResult(raw);
  if (result.kind !== 'output' || result.pending)
    throw new ClientError('protocol', 'Hermes returned effects for a read-only command. Nothing was forwarded.');
  return result;
}
