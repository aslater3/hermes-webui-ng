/** Allowlisted, disposable projection of Hermes session.info / session.usage counters. */
export interface SessionUsage {
  input?: number;
  output?: number;
  reasoning?: number;
  total?: number;
  calls?: number;
  contextUsed?: number;
  contextMax?: number;
  contextPercent?: number;
  contextEstimated?: boolean;
  compressions?: number;
}

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Missing/malformed counters are unknown, not zero. Never retain arbitrary metadata or credits text. */
export function sessionUsage(raw: unknown): SessionUsage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const data = raw as Record<string, unknown>;
  const usage: SessionUsage = {};
  const fields = {
    input: 'input', output: 'output', reasoning: 'reasoning', total: 'total', calls: 'calls',
    contextUsed: 'context_used', contextMax: 'context_max', compressions: 'compressions',
  } as const;
  for (const [key, source] of Object.entries(fields)) {
    const value = count(data[source]);
    if (value !== undefined && (key !== 'contextMax' || value > 0))
      usage[key as keyof typeof fields] = value;
  }
  // Legacy aliases are used only when the canonical counter is absent, not when it is zero/invalid.
  if (!('input' in data) && count(data.prompt) !== undefined) usage.input = count(data.prompt);
  if (!('output' in data) && count(data.completion) !== undefined) usage.output = count(data.completion);
  if (typeof data.context_percent === 'number' && Number.isFinite(data.context_percent) &&
      data.context_percent >= 0 && data.context_percent <= Number.MAX_SAFE_INTEGER)
    usage.contextPercent = data.context_percent;
  if (!Object.keys(usage).length) return undefined;
  if (typeof data.context_estimated === 'boolean') usage.contextEstimated = data.context_estimated;
  return usage;
}

/** A snapshot's info wrapper is distinct from the nested usage event payload. */
export function infoUsage(info: unknown): SessionUsage | undefined {
  return info && typeof info === 'object' && !Array.isArray(info)
    ? sessionUsage((info as Record<string, unknown>).usage) : undefined;
}

const cumulativeFields = ['input', 'output', 'reasoning', 'total', 'calls', 'compressions'] as const;

/**
 * Hermes can briefly publish an idle cleanup snapshot whose counters are zero even after the
 * completed-turn usage event carried the real totals. Within one runtime cumulative counters
 * cannot legitimately move backwards. Context occupancy may shrink, but an exact zero is treated
 * as the same cleanup regression unless Hermes also reports a new compression.
 */
export function reconcileUsage(previous?: SessionUsage, next?: SessionUsage): SessionUsage | undefined {
  if (!previous || !next) return next;
  const usage: SessionUsage = { ...next };
  for (const field of cumulativeFields) {
    const before = previous[field], after = next[field];
    if (before !== undefined && after !== undefined && after < before) usage[field] = before;
  }
  const compressed = (next.compressions ?? previous.compressions ?? 0) > (previous.compressions ?? 0);
  if (!compressed && (previous.contextUsed ?? 0) > 0 && next.contextUsed === 0) {
    usage.contextUsed = previous.contextUsed;
    if ((next.contextPercent ?? 0) === 0 && previous.contextPercent !== undefined)
      usage.contextPercent = previous.contextPercent;
  }
  return usage;
}

export function contextPercent(usage?: SessionUsage): number | undefined {
  if (usage?.contextPercent !== undefined) return usage.contextPercent;
  if (usage?.contextUsed !== undefined && usage.contextMax !== undefined)
    return usage.contextUsed / usage.contextMax * 100;
  return undefined;
}
