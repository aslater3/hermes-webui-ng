import type { DisplayMessage } from './history-message.js';
import { keyArgument, oneLine, reasoningPreview, redact, toolSeconds, toolStep, toolVerdict, type ToolStep } from './agent-steps.js';

import type { ActivityState, ToolActivity } from './agent-activity.js';

const previewOf = (text: string) => reasoningPreview(text);
const norm = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * One CLI-style timeline per assistant turn, built from saved history and the live activity of the running turn.
 * Pure projection: no DOM, no clock. Live durations come from timestamps the activity model already records.
 */

const SUMMARY_LIMIT = 80, OUTPUT_LIMIT = 8192, ARGS_LIMIT = 8192, REASONING_LIMIT = 32768;

export type CallStatus = 'running' | 'ok' | 'failed' | 'unknown';
export interface ToolCall {
  /** Stable React key: the Hermes tool_call_id when known, so a live call keeps its row when history replaces it. */
  key: string;
  callId?: string;
  name: string;
  /** One line: the key argument (command, path, query), redacted. */
  summary: string;
  /** Redacted, bounded JSON arguments (full text shown when expanded). */
  args: string;
  /** Redacted, bounded output. Empty when Hermes did not store or send one. */
  output: string;
  status: CallStatus;
  /** Short verdict text such as "exit 1 · failed"; empty when no verdict can be read. */
  verdict: string;
  /** Elapsed seconds from the tool result, when reported. */
  seconds?: number;
  /** Epoch ms when this client first saw the call start (live only). */
  startedAt?: number;
  /** No assistant call matched this result. */
  orphan: boolean;
}
export interface ThoughtItem { kind: 'thought'; key: string; text: string; preview: string; truncated: boolean; seconds?: number; running: boolean; startedAt?: number; }
export interface NarrationItem { kind: 'narration'; key: string; text: string; truncated: boolean; running: boolean; }
export interface ReplyItem { kind: 'reply'; key: string; text: string; truncated: boolean; running: boolean; }
export interface ToolGroupItem { kind: 'tools'; key: string; calls: ToolCall[]; status: CallStatus; seconds?: number; running: boolean; startedAt?: number; }
export type TimelineItem = ThoughtItem | NarrationItem | ReplyItem | ToolGroupItem;

/** Internal flat atoms; grouping into rows happens after merging so calls can join across the saved/live boundary. */
type Atom =
  | { kind: 'thought'; key: string; text: string; truncated: boolean; seconds?: number; running: boolean; startedAt?: number; live: boolean }
  | { kind: 'text'; key: string; text: string; truncated: boolean; running: boolean; live: boolean }
  | { kind: 'call'; key: string; call: ToolCall; live: boolean };

export interface LiveTurn {
  activity: ActivityState;
  /** Whether the live reply is being streamed right now (the turn is still running). */
  running: boolean;
  /** Text segments are rendered in the timeline only when they hold the whole streamed reply. */
  interleaved: boolean;
}
export interface MessageSegment { kind: 'message'; key: string; start: number; message: DisplayMessage; }
export interface TurnSegment { kind: 'turn'; key: string; start: number; items: TimelineItem[]; current: boolean; }
export type ConversationSegment = MessageSegment | TurnSegment;

/** A saved turn: its atoms in order, kept so a live turn can merge with them before grouping. */
interface SavedTurn { kind: 'turn'; start: number; atoms: Atom[]; }

/** Saved tool step to a call atom. Native history omits most outputs, so `unknown` means "nothing recorded", not failure. */
function savedCall(step: ToolStep, key: string, callId: string | undefined, seconds: number | undefined): Atom {
  const status: CallStatus = step.outcome === 'ok' ? 'ok' : step.outcome === 'failed' ? 'failed' : 'unknown';
  const call: ToolCall = { key, callId, name: step.name, summary: step.summary, args: step.args, output: step.output,
    status, verdict: step.verdict, seconds, orphan: step.orphan };
  return { kind: 'call', key, call, live: false };
}

/** Build the saved segments for a loaded page of history. A turn is the run of assistant and tool rows between user messages. */
function projectSaved(messages: readonly DisplayMessage[]): (MessageSegment | SavedTurn)[] {
  const callIds = new Set<string>();
  for (const message of messages) for (const call of message.toolCalls ?? []) if (call.id) callIds.add(call.id);
  const resultOf = new Map<string, number>();
  messages.forEach((message, index) => {
    const id = message.toolCallId;
    if (message.role === 'tool' && id && callIds.has(id) && !resultOf.has(id)) resultOf.set(id, index);
  });
  const absorbed = new Set<number>(resultOf.values());
  const out: (MessageSegment | SavedTurn)[] = [];
  let turn: SavedTurn | undefined;
  // Thinking time: from the previous stored row (the prompt or the last tool result) to this envelope.
  let previous: number | undefined;
  const open = (start: number): SavedTurn => { if (!turn) { turn = { kind: 'turn', start, atoms: [] }; out.push(turn); } return turn; };
  messages.forEach((message, index) => {
    const before = previous;
    if (message.timestamp !== undefined) previous = message.timestamp;
    if (message.role === 'tool') {
      if (absorbed.has(index)) return;
      const step = toolStep(`${index}-result`, message.toolName ?? 'Tool', undefined, undefined, message, message.timestamp);
      open(index).atoms.push(savedCall(step, `call:orphan-${index}`, message.toolCallId, toolSeconds(step.output)));
      return;
    }
    if (message.role !== 'assistant') {
      turn = undefined;
      out.push({ kind: 'message', key: `message:${index}`, start: index, message });
      return;
    }
    const target = open(index);
    if (message.reasoning) {
      const seconds = before !== undefined && message.timestamp !== undefined && message.timestamp >= before ? message.timestamp - before : undefined;
      target.atoms.push({ kind: 'thought', key: `saved:${index}:thought`, text: redact(message.reasoning, REASONING_LIMIT),
        truncated: !!message.truncated, seconds, running: false, live: false });
    }
    if (message.text.trim()) {
      target.atoms.push({ kind: 'text', key: `saved:${index}:text`, text: message.text, truncated: !!message.truncated, running: false, live: false });
    }
    (message.toolCalls ?? []).forEach((call, position) => {
      const resultIndex = call.id ? resultOf.get(call.id) : undefined;
      const result = resultIndex === undefined ? undefined : messages[resultIndex];
      const step = toolStep(`${index}-call-${position}`, call.name, call.args, message, result, message.timestamp);
      const key = call.id ? `call:${call.id}` : `call:pos-${index}-${position}`;
      const fromStamps = result?.timestamp !== undefined && message.timestamp !== undefined && result.timestamp >= message.timestamp ? result.timestamp - message.timestamp : undefined;
      target.atoms.push(savedCall(step, key, call.id || undefined, result ? toolSeconds(step.output) ?? fromStamps : undefined));
    });
  });
  return out;
}

/** Live timeline entries (already chronological) to atoms. Input entries are cards, not timeline rows. */
function liveAtoms(live: LiveTurn): Atom[] {
  const { activity, running } = live;
  const tools = new Map<string, ToolActivity>(activity.tools.map(tool => [tool.id, tool]));
  const entries = activity.timeline;
  // Start time of the first entry after `index` that is not reasoning: the thought ends there.
  const endAt = (index: number): number | undefined => {
    for (const entry of entries.slice(index + 1)) {
      if (entry.kind === 'reasoning' || entry.kind === 'input') continue;
      if (entry.kind === 'text') return entry.at;
      return tools.get(entry.id)?.startedAt;
    }
    return undefined;
  };
  const atoms: Atom[] = [];
  if (!entries.some(entry => entry.kind === 'reasoning') && activity.reasoning) {
    atoms.push({ kind: 'thought', key: 'live:reasoning-fallback', text: redact(activity.reasoning, REASONING_LIMIT), truncated: activity.truncated,
      running: false, live: true });
  }
  entries.forEach((entry, index) => {
    const last = index === entries.length - 1;
    if (entry.kind === 'reasoning') {
      const end = endAt(index);
      const seconds = end !== undefined && entry.at !== undefined && end >= entry.at ? (end - entry.at) / 1000 : undefined;
      atoms.push({ kind: 'thought', key: `live:${entry.id}`, text: redact(entry.text, REASONING_LIMIT), truncated: entry.truncated,
        seconds, running: running && last, startedAt: entry.at, live: true });
    } else if (entry.kind === 'text') {
      if (!live.interleaved) return;
      atoms.push({ kind: 'text', key: `live:${entry.id}`, text: entry.text.trimEnd(), truncated: entry.truncated, running: running && last, live: true });
    } else if (entry.kind === 'tool') {
      const tool = tools.get(entry.id);
      if (tool) atoms.push({ kind: 'call', key: `call:${tool.id}`, call: liveCall(tool), live: true });
    }
  });
  return atoms;
}

function liveCall(tool: ToolActivity): ToolCall {
  const object = parseArgs(tool.input);
  const detail = keyArgument(tool.name, object) || tool.context;
  const verdict = toolVerdict(tool.output || undefined, tool.state !== 'unknown');
  let status: CallStatus = tool.state === 'running' ? 'running' : tool.state === 'error' ? 'failed' : tool.state === 'complete' ? 'ok' : 'unknown';
  if (status === 'ok' && verdict.outcome === 'failed') status = 'failed';
  const seconds = tool.duration !== undefined && tool.duration >= 0 ? tool.duration : verdict.duration !== undefined ? Number.parseFloat(verdict.duration) : undefined;
  return { key: `call:${tool.id}`, callId: tool.id, name: tool.name, summary: redact(oneLine(detail, SUMMARY_LIMIT), SUMMARY_LIMIT + 8),
    args: redact(tool.input, ARGS_LIMIT), output: redact(tool.output, OUTPUT_LIMIT), status,
    verdict: status === 'failed' && !verdict.verdict ? 'error' : verdict.verdict, seconds: Number.isFinite(seconds) ? seconds : undefined,
    startedAt: tool.state === 'running' ? tool.startedAt : undefined, orphan: false };
}
function parseArgs(input: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(input);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

/**
 * Merge the live turn into its saved turn so a step is shown once.
 *  1. The last call present in both is the anchor: live steps at or before it are already in history.
 *  2. Live calls whose tool_call_id history already holds are dropped (the saved row wins, same key).
 *  3. Live text and thoughts after the anchor are dropped when saved text after the anchor contains them;
 *     a matched live step hands its key to the saved one, so the row keeps its DOM node.
 */
export function mergeAtoms(saved: readonly Atom[], live: readonly Atom[]): Atom[] {
  const savedCall = new Map<string, number>();
  saved.forEach((atom, index) => { if (atom.kind === 'call' && atom.call.callId) savedCall.set(atom.call.callId, index); });
  let anchorLive = -1, anchorSaved = -1;
  live.forEach((atom, index) => {
    if (atom.kind === 'call' && atom.call.callId && savedCall.has(atom.call.callId)) { anchorLive = index; anchorSaved = savedCall.get(atom.call.callId)!; }
  });
  const result = saved.map(atom => ({ ...atom }) as Atom);
  // A shared call keeps the duration the live event measured when the stored result carries none.
  for (const atom of live) {
    if (atom.kind !== 'call' || !atom.call.callId || atom.call.seconds === undefined) continue;
    const index = savedCall.get(atom.call.callId);
    const target = index === undefined ? undefined : result[index];
    if (target?.kind === 'call' && target.call.seconds === undefined) target.call = { ...target.call, seconds: atom.call.seconds };
  }
  const tail = result.filter((_, index) => index > anchorSaved);
  const claimed = new Set<Atom>();
  // A saved step with the same text takes the live key (the row keeps its DOM node) and is claimed once.
  const twinIn = (pool: Atom[], atom: Atom): Atom | undefined => pool.find(item => !claimed.has(item) && item.kind !== 'call' && item.kind === atom.kind && norm(item.text).includes(norm(atom.text)));
  const kept: Atom[] = [];
  live.forEach((atom, index) => {
    if (atom.kind === 'call') {
      if (!(atom.call.callId && savedCall.has(atom.call.callId))) kept.push(atom);
      return;
    }
    if (!norm(atom.text)) return;
    // Before the anchor the history already holds the step: keep its key, drop the live copy.
    if (index < anchorLive) { const twin = twinIn(result, atom); if (twin) { claimed.add(twin); twin.key = atom.key; keepTiming(twin, atom); } return; }
    const twin = twinIn(tail, atom);
    if (twin) { claimed.add(twin); twin.key = atom.key; keepTiming(twin, atom); return; }
    kept.push(atom);
  });
  return [...result, ...kept];
}

/** A saved thought without stored timestamps keeps the duration the live copy measured. */
function keepTiming(saved: Atom, live: Atom): void {
  if (saved.kind === 'thought' && live.kind === 'thought' && saved.seconds === undefined) saved.seconds = live.seconds;
}

/** Atoms to rows: consecutive calls form one group; a text is the reply only when no call follows it. */
function regroup(atoms: readonly Atom[]): TimelineItem[] {
  const kinds = atoms.map(atom => atom.kind);
  const lastText = kinds.lastIndexOf('text'), lastCall = kinds.lastIndexOf('call');
  const items: TimelineItem[] = [];
  let group: ToolGroupItem | undefined;
  atoms.forEach((atom, index) => {
    if (atom.kind === 'call') {
      if (!group) { group = { kind: 'tools', key: `group:${atom.key}`, calls: [], status: 'ok', running: false }; items.push(group); }
      group.calls.push(atom.call);
      return;
    }
    group = undefined;
    if (atom.kind === 'thought') items.push({ kind: 'thought', key: atom.key, text: atom.text, preview: previewOf(atom.text), truncated: atom.truncated,
      seconds: atom.seconds, running: atom.running, startedAt: atom.startedAt });
    else if (index === lastText && lastCall < index) items.push({ kind: 'reply', key: atom.key, text: atom.text, truncated: atom.truncated, running: atom.running });
    else items.push({ kind: 'narration', key: atom.key, text: atom.text, truncated: atom.truncated, running: atom.running });
  });
  for (const item of items) if (item.kind === 'tools') finishGroup(item);
  return items;
}
function finishGroup(group: ToolGroupItem): void {
  const calls = group.calls;
  group.running = calls.some(call => call.status === 'running');
  group.status = group.running ? 'running' : calls.some(call => call.status === 'failed') ? 'failed' : calls.every(call => call.status === 'ok') ? 'ok' : 'unknown';
  const seconds = calls.map(call => call.seconds);
  group.seconds = seconds.every((value): value is number => value !== undefined) ? seconds.reduce((sum, value) => sum + value, 0) : undefined;
  group.startedAt = calls.find(call => call.status === 'running')?.startedAt;
}

/** Turn items for one turn. Saved only when `live` is undefined; otherwise the merged saved and live steps. */
function turnItems(saved: readonly Atom[], live: LiveTurn | undefined): TimelineItem[] {
  const atoms = live ? mergeAtoms(saved, liveAtoms(live)) : [...saved];
  return regroup(atoms);
}

/**
 * Conversation segments in order: each loaded message, and each turn of assistant and tool rows between them.
 * The last turn is the current one. When a live turn is supplied it is merged there, or appended as a new turn
 * when the history ends at the user's message. Turn keys are stable across the live-to-saved handover.
 */
export function conversationSegments(messages: readonly DisplayMessage[], live?: LiveTurn): ConversationSegment[] {
  const projected = projectSaved(messages);
  const lastIndex = projected.length - 1;
  const segments: ConversationSegment[] = projected.map((segment, index) => {
    if (segment.kind === 'message') return segment;
    const current = index === lastIndex;
    return { kind: 'turn', key: current ? 'turn:current' : `turn:${segment.start}`, start: segment.start,
      items: current && live ? turnItems(segment.atoms, live) : regroup(segment.atoms), current };
  });
  const tail = segments.at(-1);
  if (live && tail?.kind === 'turn') return segments;
  if (live) {
    const items = turnItems([], live);
    if (items.length) segments.push({ kind: 'turn', key: 'turn:current', start: messages.length, items, current: true });
    return segments;
  }
  // Without live activity the last saved turn still counts as current, so its key does not change when a turn starts.
  if (tail?.kind === 'turn') tail.current = true;
  return segments;
}

/** Duration label for a finished or running step: "3s", "<1s", "0:42" when long, "5.0s" for tool calls. */
export function thoughtLabel(seconds: number | undefined): string {
  if (seconds === undefined) return '';
  if (seconds < 1) return '<1s';
  return seconds < 60 ? `${Math.round(seconds)}s` : clock(seconds);
}
export function toolLabel(seconds: number | undefined): string {
  if (seconds === undefined) return '';
  return seconds < 60 ? `${seconds.toFixed(1)}s` : clock(seconds);
}
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** What a person wants to read from a stored result: a command's text output (plus any error), a file's content,
 *  otherwise the result pretty-printed. Non-JSON output is shown as it is. Input is already redacted and bounded. */
export function readableOutput(name: string, output: string): string {
  const trimmed = output.trim();
  if (!trimmed.startsWith('{')) return output;
  let value: unknown;
  try { value = JSON.parse(trimmed); } catch { return output; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  const result = value as Record<string, unknown>, text = (key: string) => typeof result[key] === 'string' ? result[key] as string : '';
  const error = text('error') || text('stderr');
  if (typeof result.output === 'string') return [result.output, error ? `[error] ${error}` : ''].filter(Boolean).join('\n');
  if (typeof result.content === 'string') return [result.content, error ? `[error] ${error}` : ''].filter(Boolean).join('\n');
  return JSON.stringify(result, null, 2);
}
