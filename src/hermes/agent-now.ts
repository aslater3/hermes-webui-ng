import { keyArgument, lastStep, reasoningPreview, type HistoryItem } from './agent-steps.js';
import type { ActivityState } from './agent-activity.js';

export interface NowAction {
  kind: 'tool' | 'thinking' | 'writing' | 'last';
  /** Announced text: changes only when the step changes, never with the elapsed timer or reasoning deltas. */
  label: string;
  /** Visual-only extra (reasoning preview), kept out of the live region. */
  detail?: string;
  /** Epoch ms of tool.start, for the ticking elapsed time. */
  startedAt?: number;
  /** Epoch seconds of the latest saved step, for "N s ago". */
  timestamp?: number;
}
function toolArgs(input: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(input);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}
/**
 * The current action of a running turn, from live activity first. When the page attached mid-turn
 * and live activity is empty, the newest saved step stands in ("Last step: …"). Idle turns have none.
 */
export function currentAction(input: { running: boolean; activity: ActivityState; streaming: string; history: readonly HistoryItem[] }): NowAction | undefined {
  if (!input.running) return undefined;
  const { activity, streaming } = input;
  const running = activity.tools.filter(tool => tool.state === 'running').at(-1);
  if (running) {
    const detail = keyArgument(running.name, toolArgs(running.input));
    return { kind: 'tool', label: `Running ${running.name}${detail ? `: ${detail.split('\n')[0]!.slice(0, 80)}` : ''}`, startedAt: running.startedAt };
  }
  const last = activity.timeline.at(-1);
  if (streaming || last?.kind === 'text') return { kind: 'writing', label: 'Writing reply…' };
  if (!activity.timeline.length && !activity.reasoning && !activity.thinking) {
    const step = lastStep(input.history);
    if (step) return { kind: 'last', label: `Last step: ${step.label}`, timestamp: step.timestamp };
  }
  if (last?.kind === 'reasoning') return { kind: 'thinking', label: 'Thinking…', detail: reasoningPreview(last.text) };
  return { kind: 'thinking', label: 'Thinking…' };
}
