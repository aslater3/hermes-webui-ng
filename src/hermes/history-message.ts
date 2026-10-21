import { record, textField } from './protocol.js';

export const HISTORY_TEXT_LIMIT = 131072;
/** One assistant tool call as Hermes stored it (`tool_calls[]`). `args` is the bounded JSON argument string. */
export interface ToolCallRef { id: string; name: string; args: string; }
export interface DisplayMessage {
  role: string;
  text: string;
  truncated?: boolean;
  rowId?: number;
  toolName?: string;
  reasoning?: string;
  /** Assistant envelopes: the tool calls they requested, paired later by `id` with tool result rows. */
  toolCalls?: ToolCallRef[];
  /** Tool rows: the call this result answers (`tool_call_id`). */
  toolCallId?: string;
  /** Tool rows (native projection): the gateway's short call preview (`context`). */
  toolContext?: string;
  /** Tool rows (native projection): the call's full arguments, as Hermes ships them alongside `context`. */
  toolArgs?: string;
  /** Unix seconds when Hermes stored the row; display-only, used for "N s ago" wording. */
  timestamp?: number;
}
const MAX_TOOL_CALLS = 32, TOOL_ARGS_LIMIT = 8192;
/** Arguments are capped for display; put the fields a summary needs first so a large payload (write_file
 *  content) cannot push the path past the cap. Unparseable input is returned unchanged. */
function summaryFirst(args: string): string {
  if (args.length <= TOOL_ARGS_LIMIT) return args;
  try {
    const parsed: unknown = JSON.parse(args);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return args;
    const source = parsed as Record<string, unknown>, ordered: Record<string, unknown> = {};
    for (const key of SUMMARY_ARG_KEYS) if (key in source) ordered[key] = source[key];
    for (const [key, value] of Object.entries(source)) if (!(key in ordered)) ordered[key] = value;
    return JSON.stringify(ordered);
  } catch { return args; }
}
/** Native tool-row argument fields a one-line step summary may show (agent-steps.ts keyArgument). */
const SUMMARY_ARG_KEYS = ['command', 'cmd', 'path', 'file_path', 'filename', 'offset', 'limit', 'query', 'pattern', 'q', 'url', 'search'] as const;
const TEXT = new Set(['text', 'input_text', 'output_text', 'summary_text', 'reasoning_text']);
const MEDIA = new Set(['image', 'image_url', 'input_image', 'audio', 'input_audio', 'file', 'input_file']);
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
/** Display known text parts only. Never stringify payloads, binary media or encrypted reasoning. */
export function contentText(input: unknown, limit = HISTORY_TEXT_LIMIT): { text: string; truncated: boolean } {
  const chunks: string[] = [];
  let remaining = limit, visited = 0, truncated = false;
  const append = (text: string) => {
    if (text.length > remaining) truncated = true;
    chunks.push(text.slice(0, remaining)); remaining = Math.max(0, remaining - text.length);
  };
  const walk = (value: unknown, depth: number): void => {
    if (++visited > 2048 || depth > 8) { truncated = true; return; }
    if (remaining === 0) { truncated = true; return; }
    if (typeof value === 'string') { append(value); return; }
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 2048); i++) {
        if (!remaining || visited > 2048) { truncated = true; break; }
        walk(value[i], depth + 1);
      }
      if (value.length > 2048) truncated = true;
      return;
    }
    const part = object(value);
    if (!part) return;
    const type = typeof part.type === 'string' ? part.type : '';
    if (TEXT.has(type) || (!type && typeof part.text === 'string')) {
      const text = part.text ?? part.content;
      if (typeof text === 'string') append(text);
    } else if (type === 'message') {
      walk(part.content, depth + 1);
    } else if (type === 'reasoning') {
      // Responses-style reasoning exposes public summaries separately from encrypted_content.
      walk(part.summary, depth + 1);
    } else if (MEDIA.has(type)) {
      append(type.includes('image') ? '\n[Image attachment]\n' : type.includes('audio') ? '\n[Audio attachment]\n' : '\n[File attachment]\n');
    } else if (type) append('\n[Unsupported content block]\n');
  };
  walk(input, 0);
  return { text: chunks.join(''), truncated };
}
function short(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.slice(0, limit) : undefined;
}
/** Native history has tool summaries without text; REST history has content/parts. */
export function displayMessage(input: unknown, source: 'native' | 'rest'): DisplayMessage | null {
  const data = record(input), role = textField(data, 'role').slice(0, 32);
  if (data.display_kind === 'hidden') return null;
  const body = contentText(source === 'native' ? data.text ?? data.content : data.content ?? data.text);
  const row = source === 'native' ? data.row_id : data.id;
  const timestamp = typeof data.timestamp === 'number' && Number.isFinite(data.timestamp) && data.timestamp > 0 ? data.timestamp : undefined;
  const result: DisplayMessage = { role, text: body.text,
    ...(body.truncated ? { truncated: true } : {}),
    ...(typeof row === 'number' && Number.isSafeInteger(row) && row >= 0 ? { rowId: row } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
  };
  if (role === 'tool') {
    result.toolName = short(data.name ?? data.tool_name, 128) ?? 'Tool';
    const callId = short(data.tool_call_id, 256);
    if (callId) result.toolCallId = callId;
    const context = short(data.context, 2048);
    if (context) result.toolContext = context;
    // Native `session.history` sends the call's `args` (most outputs are omitted). Keep only the fields a step
    // summary uses, never the arbitrary payload (file contents, credentials in other keys).
    if (data.args && typeof data.args === 'object' && !Array.isArray(data.args)) {
      const source = data.args as Record<string, unknown>, kept: Record<string, unknown> = {};
      for (const key of SUMMARY_ARG_KEYS) {
        const value = source[key];
        if ((typeof value === 'string' && value.length <= 2048) || (typeof value === 'number' && Number.isFinite(value))) kept[key] = value;
      }
      if (Object.keys(kept).length) result.toolArgs = JSON.stringify(kept);
    }
    // Gateway deliberately omits tool result bodies. Do not invent a completion/output verdict.
    if (!result.text.trim()) result.text = context ?? 'Tool activity recorded by Hermes. Output is not included in this history response.';
    return result;
  }
  if (role === 'assistant') {
    if (!result.text.trim()) {
      const sidecar = contentText(data.codex_message_items);
      result.text = sidecar.text;
      if (sidecar.truncated) result.truncated = true;
    }
    for (const value of [data.reasoning_content, data.reasoning, data.codex_reasoning_items]) {
      const detail = contentText(value, 32768);
      if (detail.text.trim()) { result.reasoning = detail.text; if (detail.truncated) result.truncated = true; break; }
    }
    if (Array.isArray(data.tool_calls) && data.tool_calls.length) {
      // Calls with no name are dropped (they cannot be shown or paired) before the cap. Arguments stay a bounded JSON string.
      const calls: ToolCallRef[] = [];
      for (const call of data.tool_calls) {
        const item = object(call), fn = object(item?.function);
        const name = short(fn?.name, 128);
        if (!name) continue;
        if (calls.length === MAX_TOOL_CALLS) { result.truncated = true; break; }
        const raw = fn?.arguments;
        const args = typeof raw === 'string' ? raw : raw !== undefined && raw !== null ? JSON.stringify(raw) ?? '' : '';
        calls.push({ id: short(item?.id, 256) ?? '', name, args: summaryFirst(args).slice(0, TOOL_ARGS_LIMIT) });
      }
      if (calls.length) result.toolCalls = calls;
    }
  }
  // Empty assistant envelopes are not messages. Tool requests alone are steps (see agent-steps.ts), not text.
  return result.text.trim() || result.reasoning || result.toolCalls?.length ? result : null;
}
