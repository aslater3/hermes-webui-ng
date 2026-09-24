/** Wire contract inspected at NousResearch/hermes-agent b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a. */
export type ErrorKind =
  'auth-required' | 'forbidden' | 'network' | 'timeout' | 'protocol' | 'disconnected' | 'rpc';
export class ClientError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly rpcCode?: number,
  ) {
    super(message);
    this.name = 'ClientError';
  }
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout';
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ClientError('protocol', 'Hermes returned an invalid object');
  }
  return value as Record<string, unknown>;
}
export function textField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string' || !field)
    throw new ClientError('protocol', 'Hermes omitted a required field');
  return field;
}
export interface GatewayEvent {
  type: string;
  session_id?: string;
  payload?: unknown;
  seq?: number;
}
export type Frame =
  | { kind: 'event'; event: GatewayEvent }
  | { kind: 'request'; id: string | number; method: string; params: unknown }
  | { kind: 'reply'; id: string | number; result?: unknown; error?: { code: number } };

/** Largest frame the renderer accepts. A reply above this is refused rather than parsed. */
export const MAX_FRAME_CHARS = 4_194_304;

/**
 * Reply id of a frame that is too large to parse, read from a bounded header slice.
 *
 * Without it an oversized reply is indistinguishable from a malformed one, and the only
 * remaining failure scope is the whole connection — which the UI reports as the Gateway being
 * gone for every conversation in the tab. Attributing the frame to its own RPC keeps the
 * damage to the one call that was waiting on it.
 */
export function oversizedReplyId(raw: unknown): string | number | undefined {
  if (typeof raw !== 'string' || raw.length <= MAX_FRAME_CHARS) return undefined;
  const header = /"id"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+)/.exec(raw.slice(0, 256));
  if (!header) return undefined;
  const token = header[1]!;
  if (!token.startsWith('"')) return Number(token);
  try {
    const id: unknown = JSON.parse(token);
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

export function parseFrames(raw: unknown): Frame[] {
  if (typeof raw !== 'string' || raw.length > MAX_FRAME_CHARS) {
    throw new ClientError('protocol', 'Unsupported or oversized Gateway frame');
  }
  try {
    return raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line): Frame => {
        const frame = record(JSON.parse(line));
        if (frame.jsonrpc !== '2.0') throw new Error();
        if (frame.method !== undefined && frame.method !== 'event') {
          if (typeof frame.method !== 'string' || !frame.method || frame.method.length > 128 ||
              (typeof frame.id !== 'string' && typeof frame.id !== 'number') || 'result' in frame || 'error' in frame) throw new Error();
          return { kind: 'request', id: frame.id, method: frame.method, params: frame.params };
        }
        if (frame.method === 'event') {
          const event = record(frame.params);
          textField(event, 'type');
          if (event.session_id !== undefined && typeof event.session_id !== 'string') throw new Error();
          return { kind: 'event', event: event as unknown as GatewayEvent };
        }
        if (typeof frame.id !== 'string' && typeof frame.id !== 'number') throw new Error();
        if ('result' in frame === 'error' in frame) throw new Error();
        if ('error' in frame) {
          const error = record(frame.error);
          if (typeof error.code !== 'number' || !Number.isInteger(error.code)) throw new Error();
          return { kind: 'reply', id: frame.id, error: { code: error.code } };
        }
        return { kind: 'reply', id: frame.id, result: frame.result };
      });
  } catch {
    // Neither malformed payloads nor upstream error strings belong in diagnostics.
    throw new ClientError('protocol', 'Invalid Gateway JSON-RPC frame');
  }
}
