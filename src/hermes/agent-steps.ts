import type { DisplayMessage } from './history-message.js';
import { safeText } from './safe-text.js';

/** Rows shown before "Show N earlier steps" in a long agent loop. */
export const STEPS_VISIBLE = 6;
const SUMMARY_LIMIT = 80, REASONING_PREVIEW = 100, OUTPUT_LIMIT = 8192, ARGS_LIMIT = 8192;
const FALLBACK_OUTPUT = 'Tool activity recorded by Hermes. Output is not included in this history response.';

export type ToolOutcome = 'ok' | 'failed' | 'unknown';
export interface ToolStep {
  kind: 'tool'; key: string; name: string;
  /** Key argument (command, path, query…) or the gateway preview; redacted and one line. */
  summary: string;
  outcome: ToolOutcome; verdict: string; duration?: string;
  /** Redacted JSON arguments and the redacted output, shown only when the row is expanded. */
  args: string; output: string;
  /** No assistant call matched this result (native history, or a result without its call). */
  orphan: boolean; timestamp?: number;
}
export interface ReasoningStep { kind: 'reasoning'; key: string; preview: string; text: string; truncated: boolean; timestamp?: number; }
export type AgentStep = ToolStep | ReasoningStep;
export type HistoryItem = { kind: 'message'; start: number; message: DisplayMessage } | { kind: 'steps'; start: number; steps: AgentStep[] };

/** Credential-looking JSON members (`"api_key": "..."`) are blanked before any other handling. */
const JSON_SECRET = /("[^"\\]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization|cookie)[^"\\]*"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;
/** Redaction for every agent-step string: JSON members, then the shared key=value / bearer / provider-key rules. */
export function redact(value: string, max: number): string {
  return safeText(value.replace(JSON_SECRET, '$1"[redacted]"'), max);
}
/** First line only, bounded: summaries are one short line in a single row. */
export function oneLine(value: string, max = SUMMARY_LIMIT): string {
  const line = value.split('\n').find(part => part.trim())?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
/** Reasoning preview (same rule as the live cards): markdown stripped, whitespace collapsed, ~100 characters. */
export function reasoningPreview(value: string): string {
  const compact = value.replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim();
  return redact(compact.length > REASONING_PREVIEW ? `${compact.slice(0, REASONING_PREVIEW - 3)}…` : compact, REASONING_PREVIEW + 8);
}

/** Arguments are stored bounded, so a large call (write_file with its content) can be cut off mid-JSON.
 *  Recover the short leading string/number fields a summary needs from the raw text. */
function leadingFields(value: string): Record<string, unknown> | undefined {
  const fields: Record<string, unknown> = {};
  for (const match of value.matchAll(/"([a-z_]{1,24})"\s*:\s*("(?:[^"\\]|\\.){0,2048}"|-?\d+(?:\.\d+)?)/g)) {
    const key = match[1], raw = match[2];
    if (!key || raw === undefined || key in fields) continue;
    try { fields[key] = JSON.parse(raw); } catch { /* skip a field that is itself cut off */ }
  }
  return Object.keys(fields).length ? fields : undefined;
}
function parseObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch { return undefined; }
}
const TERMINAL = /^(terminal|bash|shell|run_command|execute_command)$/i;
const FILE = /^(read_file|write_file|patch|edit_file|create_file)$/i;
const SEARCH = /(search|grep|find|web|fetch|browse|query)/i;
const PATH_KEYS = ['path', 'file_path', 'filename'], SEARCH_KEYS = ['query', 'pattern', 'q', 'url', 'search'];
/** The one argument worth showing in a collapsed row. Unknown tools fall back to their first short string argument. */
export function keyArgument(name: string, args: Record<string, unknown>): string {
  const first = (keys: string[]) => keys.map(key => args[key]).find((value): value is string => typeof value === 'string' && value.trim() !== '');
  // A leading `cd <dir>;` / `cd <dir> &&` is noise in a one-line summary; the full command stays in the details.
  if (TERMINAL.test(name)) return (first(['command']) ?? '').replace(/^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:;|&&)\s*/, '');
  if (FILE.test(name)) {
    const path = first(PATH_KEYS) ?? '';
    const offset = typeof args.offset === 'number' ? args.offset : undefined, limit = typeof args.limit === 'number' ? args.limit : undefined;
    // read_file ranges read as path:start-end; a bare offset/limit still names the window.
    if (path && name === 'read_file' && (offset !== undefined || limit !== undefined)) {
      const start = offset ?? 1;
      return `${path}:${start}${limit !== undefined ? `–${start + limit - 1}` : ''}`;
    }
    return path;
  }
  if (SEARCH.test(name)) return first(SEARCH_KEYS) ?? '';
  const value = Object.values(args).find((item): item is string => typeof item === 'string' && item.trim() !== '' && item.length <= 200);
  return value ?? '';
}
/** Verdict from a stored tool result. Only a parsed result object yields ok/failed; anything else stays unknown. */
export function toolVerdict(output: string | undefined, hasResult: boolean): { outcome: ToolOutcome; verdict: string; duration?: string } {
  // No stored result (native history omits most outputs): say nothing rather than imply something went missing.
  if (!hasResult || output === undefined || output === FALLBACK_OUTPUT || !output.trim()) return { outcome: 'unknown', verdict: '' };
  const result = output.trim().startsWith('{') ? parseObject(output) : undefined;
  if (!result) {
    // A long result is stored cut off, so it no longer parses; its exit code usually still reads plainly.
    const exit = /"exit_code"\s*:\s*(-?\d+)/.exec(output);
    if (exit) { const code = Number(exit[1]); return { outcome: code === 0 ? 'ok' : 'failed', verdict: code === 0 ? `exit ${code}` : `exit ${code} · failed` }; }
    return { outcome: 'unknown', verdict: '' };
  }
  const exit = typeof result.exit_code === 'number' && Number.isFinite(result.exit_code) ? result.exit_code : undefined;
  const hasError = result.error !== undefined && result.error !== null && result.error !== '' && result.error !== false;
  const failed = result.success === false || hasError || (exit !== undefined && exit !== 0);
  const seconds = [result.duration_s, result.duration_seconds, result.duration].find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const duration = seconds !== undefined ? `${Math.round(seconds * 10) / 10}s` : undefined;
  const bytes = typeof result.bytes_written === 'number' && Number.isFinite(result.bytes_written) ? result.bytes_written : undefined;
  if (exit !== undefined) return { outcome: failed ? 'failed' : 'ok', verdict: failed ? `exit ${exit} · failed` : `exit ${exit}`, duration };
  if (failed) return { outcome: 'failed', verdict: hasError ? 'error' : 'failed', duration };
  return { outcome: 'ok', verdict: bytes !== undefined ? `${bytes} bytes written` : 'done', duration };
}
function toolStep(key: string, name: string, argsJson: string | undefined, call: DisplayMessage | undefined, result: DisplayMessage | undefined, timestamp: number | undefined): ToolStep {
  // A native-history row has no paired call but carries the call's own arguments.
  const sourceArgs = argsJson || (!call ? result?.toolArgs : undefined);
  const cleanArgs = sourceArgs ? redact(sourceArgs, ARGS_LIMIT) : '';
  // Pick the key argument from the parsed raw arguments (redacting first can leave invalid JSON);
  // the summary built from it is redacted below, and only redacted arguments are kept for display.
  const object = (sourceArgs ? parseObject(sourceArgs) ?? leadingFields(sourceArgs) : undefined) ?? {};
  const orphan = !call;
  // Native history carries the call's arguments (`args`) and a short preview (`context`) but omits most outputs;
  // the preview is the text of such a row and is not a result.
  const detail = call || result?.toolArgs ? keyArgument(name, object) || (result?.toolContext ?? '') : result?.toolContext ?? '';
  const output = result && result.text !== result.toolContext ? result.text : '';
  const verdict = toolVerdict(output || undefined, !!result);
  return { kind: 'tool', key, name: redact(name, 128), summary: redact(oneLine(detail), SUMMARY_LIMIT + 8),
    outcome: verdict.outcome, verdict: verdict.verdict, duration: verdict.duration, args: cleanArgs, output: redact(output, OUTPUT_LIMIT), orphan,
    timestamp: timestamp ?? result?.timestamp };
}
/**
 * Projects a loaded page of history into rendering items. Assistant envelopes that carry no reply text
 * (reasoning and/or tool calls) and the tool rows that answer them form one agent-steps item per run; a
 * reply with real text is an ordinary message in order. A tool result is absorbed into its call by
 * `tool_call_id`; a result with no matching call stays as its own step.
 */
export function groupHistory(messages: readonly DisplayMessage[]): HistoryItem[] {
  const callIds = new Set<string>();
  for (const message of messages) for (const call of message.toolCalls ?? []) if (call.id) callIds.add(call.id);
  const resultOf = new Map<string, number>();
  messages.forEach((message, index) => {
    const id = message.toolCallId;
    if (message.role === 'tool' && id && callIds.has(id) && !resultOf.has(id)) resultOf.set(id, index);
  });
  const absorbed = new Set<number>(resultOf.values());
  const items: HistoryItem[] = [];
  let steps: AgentStep[] | undefined, start = 0;
  const push = (index: number, step: AgentStep) => { if (!steps) { steps = []; start = index; } steps.push(step); };
  const flush = () => { if (steps?.length) items.push({ kind: 'steps', start, steps }); steps = undefined; };
  const callSteps = (index: number, message: DisplayMessage) => {
    (message.toolCalls ?? []).forEach((call, position) => {
      const resultIndex = call.id ? resultOf.get(call.id) : undefined;
      push(index, toolStep(`${index}-call-${position}`, call.name, call.args, message,
        resultIndex === undefined ? undefined : messages[resultIndex], message.timestamp));
    });
  };
  messages.forEach((message, index) => {
    if (message.role === 'tool') {
      if (absorbed.has(index)) return;
      push(index, toolStep(`${index}-result`, message.toolName ?? 'Tool', undefined, undefined, message, message.timestamp));
      return;
    }
    if (message.role === 'assistant' && !message.text.trim()) {
      if (message.reasoning) {
        const text = message.reasoning;
        push(index, { kind: 'reasoning', key: `${index}-reasoning`, preview: reasoningPreview(text),
          text: redact(text, 32768), truncated: !!message.truncated, timestamp: message.timestamp });
      }
      callSteps(index, message);
      return;
    }
    flush();
    items.push({ kind: 'message', start: index, message });
    // Calls requested alongside a reply render just after it, so the steps stay in order.
    if (message.role === 'assistant' && message.toolCalls?.length) callSteps(index, message);
  });
  flush();
  return items;
}
/** The newest step of the loaded history, for the "Last step" fallback when live activity is empty. */
export function lastStep(items: readonly HistoryItem[]): { label: string; timestamp?: number } | undefined {
  const last = items.at(-1);
  if (last?.kind !== 'steps') return undefined;
  const step = last.steps.at(-1);
  if (!step) return undefined;
  if (step.kind === 'reasoning') return { label: `Reasoning — ${step.preview}`, timestamp: step.timestamp };
  return { label: `${step.name}${step.summary ? ` — ${step.summary}` : ''}`, timestamp: step.timestamp };
}
