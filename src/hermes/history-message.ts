import { record, textField } from './protocol.js';

export const HISTORY_TEXT_LIMIT = 131072;
export interface DisplayMessage {
  role: string;
  text: string;
  truncated?: boolean;
  rowId?: number;
  toolName?: string;
  reasoning?: string;
}
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
  const result: DisplayMessage = { role, text: body.text,
    ...(body.truncated ? { truncated: true } : {}),
    ...(typeof row === 'number' && Number.isSafeInteger(row) && row >= 0 ? { rowId: row } : {}),
  };
  if (role === 'tool') {
    result.toolName = short(data.name ?? data.tool_name, 128) ?? 'Tool';
    // Gateway deliberately omits tool result bodies. Do not invent a completion/output verdict.
    if (!result.text.trim()) result.text = short(data.context, 8192) ?? 'Tool activity recorded by Hermes. Output is not included in this history response.';
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
    if (!result.text.trim() && !result.reasoning && Array.isArray(data.tool_calls) && data.tool_calls.length) {
      const names = data.tool_calls.slice(0, 32).flatMap(call => {
        const fn = object(object(call)?.function);
        const name = short(fn?.name, 128); return name ? [name] : [];
      });
      result.text = names.length ? `Requested tools: ${names.join(', ')}` : 'Requested tool activity';
    }
  }
  // Empty assistant envelopes are not messages. No generic placeholder for them.
  return result.text.trim() || result.reasoning ? result : null;
}
