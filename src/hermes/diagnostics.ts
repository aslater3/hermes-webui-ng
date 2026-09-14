/** Metadata-only, per-browser, bounded memory. Never accept arbitrary strings or payloads. */
const EVENTS = [
  'rest.request', 'rest.response', 'rest.failed', 'auth.login', 'auth.logout',
  'auth.required', 'auth.changed', 'auth.ticket', 'connection.state', 'websocket.open',
  'websocket.close', 'gateway.ready', 'gateway.event', 'rpc.sent', 'rpc.reply',
  'rpc.failed', 'capabilities.probe', 'capabilities.updated', 'visibility.resume', 'other',
] as const;
const PHASES = [
  'disconnected', 'authenticating', 'connecting', 'ready', 'reconnecting',
  'auth-required', 'error', 'checking', 'healthy', 'unreachable', 'offline',
] as const;
const KINDS = ['auth-required', 'forbidden', 'network', 'timeout', 'protocol', 'disconnected', 'rpc'];
const METHODS = [
  'gateway.ping', 'session.create', 'session.resume', 'session.activate',
  'session.history', 'session.interrupt', 'prompt.submit',
  'model.options', 'profiles.list', 'config.get', 'config.set',
];
const ROUTES = ['access', 'status', 'providers', 'identity', 'ticket', 'login', 'logout', 'schema', 'capabilities', 'sessions', 'sessionSearch', 'sessionHistory'];
export interface DiagnosticEntry {
  at: number;
  event: (typeof EVENTS)[number];
  phase?: string;
  kind?: string;
  method?: string;
  route?: string;
  generation?: number;
  attempt?: number;
  status?: number;
  closeCode?: number;
  rpcCode?: number;
  durationMs?: number;
}
function member(value: unknown, values: readonly string[]): value is string {
  return typeof value === 'string' && values.includes(value);
}

export class DiagnosticsRing {
  private entries: DiagnosticEntry[] = [];
  readonly capacity: number;
  constructor(capacity = 500, private readonly now: () => number = Date.now) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500)
      throw new Error('Diagnostic capacity must be 1–500');
    this.capacity = capacity;
  }
  add(input: unknown): void {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return;
    const value = input as Record<string, unknown>;
    const entry: DiagnosticEntry = {
      at: Math.max(0, Math.floor(this.now())),
      event: member(value.event, EVENTS) ? value.event as DiagnosticEntry['event'] : 'other',
    };
    for (const [key, allowed] of [
      ['phase', PHASES], ['kind', KINDS], ['method', METHODS], ['route', ROUTES],
    ] as const) {
      if (member(value[key], allowed)) entry[key] = value[key];
    }
    for (const key of ['generation', 'attempt', 'status', 'closeCode', 'rpcCode', 'durationMs'] as const) {
      const number = value[key];
      if (typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1e9)
        entry[key] = Math.round(number);
    }
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
  }
  snapshot(): DiagnosticEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }
  clear(): void { this.entries = []; }
}
