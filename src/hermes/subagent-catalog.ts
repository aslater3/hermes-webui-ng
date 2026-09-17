import { ClientError, record } from './protocol.js';

/**
 * Native `subagent.list` / `subagent.*` payload projection.
 *
 * Hermes reports live child agents as partial snapshots: the roster carries a fixed field set and the
 * streamed `subagent.*` events carry only what changed. Nothing here is inferred from a title, a path or
 * local process discovery — a child without an explicit identifier is dropped rather than guessed, because
 * a guessed identity could nest the wrong child under the wrong parent.
 */
export type SubagentStatus = 'starting' | 'working' | 'waiting' | 'completed' | 'failed' | 'unknown';
export interface SubagentSnapshot {
  subagentId: string;
  parentId?: string;
  depth: number;
  goal: string;
  model?: string;
  startedAt?: number;
  status: SubagentStatus;
  toolCount?: number;
  lastTool?: string;
  acceptingSteer: boolean;
}
/** Partial view of a child: an event patch keeps whatever the event did not restate. */
export interface SubagentPatch {
  subagentId: string;
  parentId?: string;
  depth?: number;
  goal?: string;
  model?: string;
  startedAt?: number;
  durationSeconds?: number;
  status?: SubagentStatus;
  toolCount?: number;
  lastTool?: string;
  acceptingSteer?: boolean;
}

/** Bounded fan-out: Hermes caps its own roster, and a hostile peer must not make us render thousands of rows. */
export const SUBAGENT_LIMIT = 24;
const ROSTER_LIMIT = SUBAGENT_LIMIT * 8;
const TEXT_LIMIT = 160;
const NAME_LIMIT = 80;

/** Older emitters use their own status words; unknown words stay unknown rather than becoming "running". */
const STATUS_ALIASES: Record<string, SubagentStatus> = {
  starting: 'starting', queued: 'starting', pending: 'starting',
  working: 'working', running: 'working', streaming: 'working', active: 'working',
  waiting: 'waiting', blocked: 'waiting',
  completed: 'completed', complete: 'completed', done: 'completed', finished: 'completed', success: 'completed',
  failed: 'failed', error: 'failed', cancelled: 'failed', aborted: 'failed', timeout: 'failed',
};

function text(value: unknown, limit = TEXT_LIMIT): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}
function identifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(trimmed) && trimmed !== '.' && trimmed !== '..' ? trimmed : undefined;
}
function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function statusOf(value: unknown): SubagentStatus | undefined {
  return typeof value === 'string' ? STATUS_ALIASES[value.toLowerCase()] ?? 'unknown' : undefined;
}
function safeRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** `undefined` when the payload carries no usable identity: the child is dropped, never attributed by guess. */
export function subagentPatch(input: unknown): SubagentPatch | undefined {
  const data = safeRecord(input);
  const subagentId = identifier(data.subagent_id ?? data.id);
  if (!subagentId) return undefined;
  return {
    subagentId, parentId: identifier(data.parent_id), depth: integer(data.depth),
    goal: text(data.goal ?? data.title) || undefined,
    model: text(data.model, NAME_LIMIT) || undefined,
    startedAt: finite(data.started_at), durationSeconds: finite(data.duration_seconds),
    status: statusOf(data.status), toolCount: integer(data.tool_count),
    // The roster names `last_tool`; streamed progress names `tool_name`. Last started tool, not in-flight state.
    lastTool: text(data.last_tool ?? data.tool_name, NAME_LIMIT) || undefined,
    acceptingSteer: typeof data.accepting_steer === 'boolean' ? data.accepting_steer : undefined,
  };
}

/** A terminal child is final for this attachment: no later frame or snapshot reopens it. */
export function mergeSubagent(current: SubagentSnapshot | undefined, patch: SubagentPatch, nowMs = Date.now()): SubagentSnapshot {
  const derived = patch.durationSeconds === undefined ? undefined : Math.max(0, nowMs / 1000 - patch.durationSeconds);
  const previous = current?.status;
  const stated = patch.status ?? previous ?? 'unknown';
  return {
    subagentId: patch.subagentId,
    parentId: patch.parentId ?? current?.parentId,
    depth: patch.depth ?? current?.depth ?? 0,
    goal: patch.goal || current?.goal || '',
    model: patch.model ?? current?.model,
    startedAt: patch.startedAt ?? current?.startedAt ?? derived,
    status: previous !== undefined && subagentTerminal(previous) && !subagentTerminal(stated) ? previous : stated,
    toolCount: patch.toolCount ?? current?.toolCount,
    lastTool: patch.lastTool ?? current?.lastTool,
    acceptingSteer: patch.acceptingSteer ?? current?.acceptingSteer ?? false,
  };
}

export function subagentTerminal(status: SubagentStatus): boolean {
  return status === 'completed' || status === 'failed';
}

function ordered(items: readonly SubagentSnapshot[]): SubagentSnapshot[] {
  return [...items].sort((a, b) => (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER) ||
    a.subagentId.localeCompare(b.subagentId)).slice(0, SUBAGENT_LIMIT);
}

/**
 * Validate a `subagent.list` envelope into patches, so hydration only ever restates fields Hermes actually
 * sent. A completed snapshot would turn every omitted field into a default and erase live truth.
 * A malformed roster is a protocol error, not an empty list.
 */
export function subagentRosterPatches(input: unknown): SubagentPatch[] {
  const data = record(input);
  if (!Array.isArray(data.subagents) || data.subagents.length > ROSTER_LIMIT)
    throw new ClientError('protocol', 'Invalid Hermes subagent roster');
  const seen = new Set<string>(); const out: SubagentPatch[] = [];
  for (const raw of data.subagents) {
    const patch = subagentPatch(raw);
    if (!patch || seen.has(patch.subagentId)) continue;
    seen.add(patch.subagentId); out.push(patch);
  }
  return out;
}

export function subagentRoster(input: unknown): SubagentSnapshot[] {
  return ordered(subagentRosterPatches(input).map(item => mergeSubagent(undefined, item)));
}

/**
 * Hydration is additive: a roster read adds and updates children but never removes one, because the roster can
 * legitimately omit a child whose turn belongs to another transport. Retirement is a separate, bounded decision
 * (`reconcileHydration`).
 */
export function mergeRoster(current: readonly SubagentSnapshot[], roster: readonly SubagentPatch[]): SubagentSnapshot[] {
  const known = new Map(current.map(item => [item.subagentId, item]));
  const reported = new Set(roster.map(item => item.subagentId));
  return ordered([
    ...roster.map(item => mergeSubagent(known.get(item.subagentId), item)),
    ...current.filter(item => !reported.has(item.subagentId)),
  ]);
}

/** Consecutive successful roster reads that omit a live child before it is treated as ended. */
export const SUBAGENT_OMISSION_LIMIT = 3;

/**
 * Fold one roster read over the children we hold.
 *
 * A live child the roster omits is not immediately wrong — the roster may simply be scoped to another
 * transport — so `misses` counts consecutive omissions and only a bounded run retires it. A terminal child is
 * never retired here: its own retention window owns that, so the completion stays observable.
 */
export function reconcileHydration(
  current: readonly SubagentSnapshot[], roster: readonly SubagentPatch[], misses: Map<string, number>,
): SubagentSnapshot[] {
  const reported = new Set(roster.map(item => item.subagentId));
  const survivors: SubagentSnapshot[] = [];
  for (const child of current) {
    if (subagentTerminal(child.status) || reported.has(child.subagentId)) { misses.delete(child.subagentId); survivors.push(child); continue; }
    const count = (misses.get(child.subagentId) ?? 0) + 1;
    if (count >= SUBAGENT_OMISSION_LIMIT) { misses.delete(child.subagentId); continue; }
    misses.set(child.subagentId, count); survivors.push(child);
  }
  return mergeRoster(survivors, roster);
}

export function subagentElapsedSeconds(item: SubagentSnapshot, nowMs = Date.now()): number | undefined {
  return item.startedAt === undefined ? undefined : Math.max(0, Math.floor(nowMs / 1000 - item.startedAt));
}

/** Upsert one streamed child in place. Per-token `subagent.text` frames never reach here (Hermes skips them on the parent). */
export function upsertSubagent(current: readonly SubagentSnapshot[], patch: SubagentPatch, nowMs = Date.now()): SubagentSnapshot[] {
  const merged = mergeSubagent(current.find(item => item.subagentId === patch.subagentId), patch, nowMs);
  return ordered([...current.filter(item => item.subagentId !== patch.subagentId), merged]);
}

/** Fixed display language: no upstream text becomes status copy. */
export function subagentStatusLabel(status: SubagentStatus): string {
  return { starting: 'Starting', working: 'Running', waiting: 'Needs your input',
    completed: 'Completed', failed: 'Failed', unknown: 'Unknown' }[status];
}

export function subagentElapsedLabel(seconds: number | undefined): string {
  if (seconds === undefined) return '';
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function subagentSummary(item: SubagentSnapshot, nowMs = Date.now()): string {
  const elapsed = subagentElapsedLabel(subagentElapsedSeconds(item, nowMs));
  return [
    `${subagentStatusLabel(item.status)}${elapsed ? ` ${elapsed}` : ''}`,
    item.model,
    item.lastTool ? `last tool: ${item.lastTool}` : '',
    item.toolCount === undefined || item.toolCount === 0 ? '' : `${item.toolCount} tools`,
  ].filter(Boolean).join(' · ');
}
