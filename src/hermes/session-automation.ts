import { record, type GatewayEvent } from './protocol.js';

/** One line Hermes' goal/loop machinery reported for the attached session (``status.update``). */
export interface AutomationNotice { id: number; kind: 'goal' | 'loop' | 'command'; text: string }

/** Allowlisted view of the session's /goal, from ``session.control.read`` / ``session.control.update``. */
export interface GoalSummary {
  title: string;
  status: 'active' | 'paused' | 'done';
  turnsUsed: number;
  maxTurns: number;
  awaitingInput: boolean;
  pausedReason?: string;
  lastVerdict?: string;
  lastReason?: string;
  waiting?: string;
}

export const NOTICE_LIMIT = 4;
const TEXT_LIMIT = 2048;

function clip(value: unknown, limit = TEXT_LIMIT): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined;
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** ``status.update {kind: goal|loop, text}`` → notice body; anything else is not ours to render. */
export function automationNoticeText(event: GatewayEvent): { kind: 'goal' | 'loop'; text: string } | undefined {
  if (event.type !== 'status.update') return undefined;
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? record(event.payload) : {};
  const kind = payload.kind, text = clip(payload.text);
  return (kind === 'goal' || kind === 'loop') && text ? { kind, text } : undefined;
}

/** The goal part of a control snapshot. ``null`` means "no goal"; ``undefined`` means "not a snapshot". */
export function goalSummary(control: unknown): GoalSummary | null | undefined {
  if (!control || typeof control !== 'object' || Array.isArray(control)) return undefined;
  const raw = record(control).goal;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const goal = record(raw);
  const status = goal.status, title = clip(goal.title, 4096);
  if (!title || (status !== 'active' && status !== 'paused' && status !== 'done')) return null;
  const barrier = goal.wait_barrier && typeof goal.wait_barrier === 'object' ? record(goal.wait_barrier) : undefined;
  return {
    title, status, turnsUsed: count(goal.turns_used), maxTurns: count(goal.max_turns),
    awaitingInput: status === 'paused' && goal.awaiting_input === true,
    pausedReason: clip(goal.paused_reason), lastVerdict: clip(goal.last_verdict, 32), lastReason: clip(goal.last_reason),
    waiting: barrier ? clip(barrier.reason) ?? 'background work' : undefined,
  };
}

/** One-line status for the goal strip. */
export function goalLine(goal: GoalSummary): string {
  const turns = goal.maxTurns ? ` · ${goal.turnsUsed}/${goal.maxTurns} turns` : '';
  if (goal.status === 'done') return `Goal done${turns}`;
  if (goal.awaitingInput) return `Goal waiting for your reply${turns}`;
  if (goal.status === 'paused') return `Goal paused${turns}`;
  if (goal.waiting) return `Goal parked — ${goal.waiting}${turns}`;
  return `Goal active${turns}`;
}
