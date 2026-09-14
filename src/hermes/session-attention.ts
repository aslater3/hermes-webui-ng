import type { GatewayClient } from './gateway-client.js';
import { ClientError, record, type GatewayEvent } from './protocol.js';
import { sessionId, profileName, type SessionRef } from './session-rest.js';

type Gateway = Pick<GatewayClient, 'call' | 'onEvent' | 'onState' | 'state'>;
export type AttentionStatus = 'idle' | 'working' | 'waiting' | 'starting' | 'unknown';
export interface AttentionItem { runtimeId: string; storedId: string; title: string; status: AttentionStatus; review: boolean; owner?: SessionRef }
const LIMIT = 100;
const same = (a: SessionRef, b: SessionRef) => a.id === b.id && (a.profile || 'default') === (b.profile || 'default');
/** Metadata only. active_list has no profile: never infer ownership from a durable ID alone. */
export class SessionAttention {
  items: AttentionItem[] = [];
  phase: 'empty' | 'ready' | 'unknown' | 'unsupported' = 'empty';
  private owners = new Map<string, SessionRef>();
  private current?: string;
  private enabled = false;
  private visible = true;
  private epoch = 0;
  private revision = 0;
  private flight?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private listeners = new Set<() => void>();
  private cleanups: (() => void)[];
  constructor(private readonly gateway: Gateway, private readonly intervalMs = 5000) {
    this.cleanups = [gateway.onState(state => {
      ++this.epoch; this.flight = undefined; clearTimeout(this.timer);
      this.phase = state.phase === 'ready' ? 'empty' : 'unknown';
      this.items = this.items.map(item => ({ ...item, status: 'unknown' })); this.publish();
      if (state.phase === 'ready') this.schedule(0);
    }), gateway.onEvent(event => this.event(event))];
  }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private publish() { if (!this.disposed) this.listeners.forEach(fn => fn()); }
  bind(runtimeId: string, ref: SessionRef): void {
    const owner = { id: sessionId(ref.id), profile: profileName(ref.profile) };
    sessionId(runtimeId);
    this.owners.delete(runtimeId); this.owners.set(runtimeId, owner);
    while (this.owners.size > LIMIT) this.owners.delete(this.owners.keys().next().value!);
    this.items = this.items.map(item => item.runtimeId === runtimeId ? { ...item, owner } : item);
  }
  select(runtimeId?: string) {
    this.current = runtimeId;
    this.items = this.items.map(item => item.runtimeId === runtimeId ? { ...item, review: false } : item);
  }
  forSession(ref: SessionRef): AttentionItem | undefined { return this.items.find(item => item.owner && same(item.owner, ref)); }
  setEnabled(value: boolean) {
    if (value === this.enabled) return;
    this.enabled = value;
    if (!value) { ++this.epoch; this.flight = undefined; clearTimeout(this.timer); this.items = this.items.map(item => ({ ...item, status: 'unknown' })); this.publish(); }
    else this.schedule(0);
  }
  setVisible(value: boolean) { this.visible = value; clearTimeout(this.timer); if (value) this.schedule(0); }
  private schedule(ms = this.intervalMs) {
    clearTimeout(this.timer);
    if (this.enabled && this.visible && !this.disposed && this.gateway.state.phase === 'ready' && this.phase !== 'unsupported') {
      this.timer = setTimeout(() => { void this.refresh(); }, ms);
    }
  }
  private event(event: GatewayEvent) {
    if (!this.enabled || !event.session_id || this.gateway.state.phase !== 'ready') return;
    if (!['message.start', 'message.complete', 'session.info', 'session.interrupted', 'error'].includes(event.type) &&
      !/^(approval|clarify|sudo|secret)\.(request|expire)$/.test(event.type)) return;
    ++this.revision;
    if (event.type.endsWith('.request') || event.type === 'message.start') {
      this.items = this.items.map(item => item.runtimeId === event.session_id ? { ...item, status: event.type.endsWith('.request') ? 'waiting' : 'working', review: false } : item);
      this.publish();
    }
    this.schedule(100);
  }
  refresh(): Promise<void> {
    if (this.flight) return this.flight;
    if (!this.enabled || !this.visible || this.disposed || this.gateway.state.phase !== 'ready') return Promise.resolve();
    const epoch = this.epoch, generation = this.gateway.state.generation, revision = this.revision;
    const valid = () => !this.disposed && this.enabled && epoch === this.epoch && generation === this.gateway.state.generation;
    let raced = false;
    const task = (async () => {
      try {
        const result = record(await this.gateway.call('session.active_list', {}));
        if (!valid()) return;
        if (revision !== this.revision) { raced = true; return; }
        if (!Array.isArray(result.sessions) || result.sessions.length > 10000) throw new ClientError('protocol', 'Invalid active-session inventory');
        const previous = new Map(this.items.map(item => [item.runtimeId, item]));
        const seen = new Set<string>();
        const ranked = result.sessions.map(raw => record(raw)).sort((a, b) => {
          const known = Number(this.owners.has(String(b.id))) - Number(this.owners.has(String(a.id)));
          const active = (row: Record<string, unknown>) => ['working', 'waiting', 'starting'].includes(String(row.status)) ? 1 : 0;
          const time = (row: Record<string, unknown>) => typeof row.last_active === 'number' && Number.isFinite(row.last_active) ? row.last_active : 0;
          return known || active(b) - active(a) || time(b) - time(a);
        });
        this.items = ranked.slice(0, LIMIT).map(raw => {
          const row = record(raw), runtimeId = sessionId(String(row.id ?? '')), storedId = sessionId(String(row.session_key ?? ''));
          if (seen.has(runtimeId)) throw new ClientError('protocol', 'Duplicate live session identifier'); seen.add(runtimeId);
          const status: AttentionStatus = ['idle', 'working', 'waiting', 'starting'].includes(String(row.status)) ? row.status as AttentionStatus : 'unknown';
          const old = previous.get(runtimeId), owner = this.owners.get(runtimeId);
          return { runtimeId, storedId, title: typeof row.title === 'string' ? row.title.slice(0, 160) : '', status,
            owner: owner?.id === storedId ? owner : undefined,
            review: runtimeId !== this.current && (old?.review === true || (status === 'idle' && !!old && ['working', 'waiting'].includes(old.status))) };
        });
        this.phase = 'ready';
      } catch (error) {
        if (!valid()) return;
        this.phase = error instanceof ClientError && error.rpcCode === -32601 ? 'unsupported' : 'unknown';
        this.items = this.items.map(item => ({ ...item, status: 'unknown' }));
      } finally { if (valid()) this.publish(); }
    })();
    const finished = task.finally(() => { if (this.flight === finished) { this.flight = undefined; this.schedule(raced ? 100 : this.intervalMs); } });
    this.flight = finished; return finished;
  }
  clear() { ++this.epoch; this.flight = undefined; clearTimeout(this.timer); this.enabled = false; this.items = []; this.owners.clear(); this.current = undefined; this.phase = 'empty'; this.publish(); }
  dispose() { this.disposed = true; this.clear(); this.cleanups.forEach(fn => fn()); this.listeners.clear(); }
}
