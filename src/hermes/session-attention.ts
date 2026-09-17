import type { GatewayClient } from './gateway-client.js';
import { ClientError, record, type GatewayEvent } from './protocol.js';
import { sessionId, profileName, type SessionRef } from './session-rest.js';
import {
  mergeRoster, subagentPatch, subagentRosterPatches, subagentTerminal, upsertSubagent,
  type SubagentSnapshot,
} from './subagent-catalog.js';

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
  private children = new Map<string, SubagentSnapshot[]>();
  private childPrunes = new Map<string, ReturnType<typeof setTimeout>>();
  /** Parents that produced a child event before their session row was known; one discovery refresh each. */
  private discovering = new Set<string>();
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
  constructor(private readonly gateway: Gateway, private readonly intervalMs = 5000,
    private readonly subagentPruneMs = 20_000) {
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
  /** Nested child agents for one parent runtime. Only parents this client received events for have children. */
  subagents(parentRuntimeId: string): SubagentSnapshot[] { return this.children.get(parentRuntimeId) ?? []; }
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
    // Subagent lifecycle is parent-scoped application state, not a reason to re-run the session poll.
    if (event.type.startsWith('subagent.')) { this.subagentEvent(event); return; }
    if (!['message.start', 'message.complete', 'session.info', 'session.interrupted', 'error'].includes(event.type) &&
      !/^(approval|clarify|sudo|secret)\.(request|expire)$/.test(event.type)) return;
    ++this.revision;
    if (event.type.endsWith('.request') || event.type === 'message.start') {
      this.items = this.items.map(item => item.runtimeId === event.session_id ? { ...item, status: event.type.endsWith('.request') ? 'waiting' : 'working', review: false } : item);
      this.publish();
    }
    this.schedule(100);
  }
  /**
   * Only a parent this client actually tracks can gain children: an untracked session id must not create a row.
   * A child can start between two polls, so an unknown parent schedules one discovery refresh instead of
   * dropping the frame and waiting for the next 5s tick.
   */
  private subagentEvent(event: GatewayEvent) {
    const parent = event.session_id;
    if (!parent) return;
    if (!this.items.some(item => item.runtimeId === parent)) {
      if (this.discovering.has(parent)) return;
      this.discovering.add(parent);
      this.schedule(100);
      return;
    }
    const patch = subagentPatch(event.payload);
    if (!patch) return;
    this.children.set(parent, upsertSubagent(this.children.get(parent) ?? [], patch));
    // A finished child lingers briefly so the operator sees the terminal state, then leaves the parent alone.
    if (subagentTerminal(patch.status ?? 'unknown')) this.scheduleChildPrune(parent, patch.subagentId);
    this.publish();
  }
  private scheduleChildPrune(parent: string, subagentId: string) {
    const key = `${parent}\u0000${subagentId}`;
    const existing = this.childPrunes.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.childPrunes.delete(key);
      const current = this.children.get(parent);
      if (!current) return;
      const next = current.filter(item => !(item.subagentId === subagentId && subagentTerminal(item.status)));
      if (next.length) this.children.set(parent, next); else this.children.delete(parent);
      this.publish();
    }, this.subagentPruneMs);
    this.childPrunes.set(key, timer);
  }
  private pruneChildParents(): void {
    const live = new Set(this.items.map(item => item.runtimeId));
    for (const parent of [...this.children.keys()]) if (!live.has(parent)) this.children.delete(parent);
    for (const parent of [...this.discovering]) if (live.has(parent)) this.discovering.delete(parent);
  }
  /**
   * Best-effort roster hydration. Hermes only answers for a session this transport owns, so 4001/unsupported
   * and transient failures all stay silent: the live stream already proved which children exist here.
   */
  private async hydrateSubagents(valid: () => boolean): Promise<void> {
    const targets = this.items.filter(item => this.owners.has(item.runtimeId) &&
      ['working', 'starting', 'waiting'].includes(item.status)).slice(0, 4).map(item => item.runtimeId);
    await Promise.all(targets.map(async parent => {
      try {
        const roster = subagentRosterPatches(await this.gateway.call('subagent.list', { session_id: parent }));
        if (!valid()) return;
        this.children.set(parent, mergeRoster(this.children.get(parent) ?? [], roster));
      } catch { /* not owned here, unsupported, or transient: keep what the stream showed */ }
    }));
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
        // Hermes keeps approvals in a separate registry; active_list can still say working.
        // Probe only a bounded set of working runtimes, and retain a boolean, not commands.
        const waiting = await Promise.all(this.items.filter(item => item.status === 'working').slice(0, 12).map(async item => {
          try {
            const pending = record(await this.gateway.call('approval.pending', { session_id: item.runtimeId }));
            return Array.isArray(pending.approvals) && pending.approvals.length > 0 ? item.runtimeId : undefined;
          } catch { return undefined; }
        }));
        if (!valid()) return;
        if (revision !== this.revision) { raced = true; return; }
        this.items = this.items.map(item => waiting.includes(item.runtimeId) ? { ...item, status: 'waiting' } : item);
        this.phase = 'ready';
        this.pruneChildParents();
        await this.hydrateSubagents(valid);
      } catch (error) {
        if (!valid()) return;
        this.phase = error instanceof ClientError && error.rpcCode === -32601 ? 'unsupported' : 'unknown';
        this.items = this.items.map(item => ({ ...item, status: 'unknown' }));
      } finally { if (valid()) this.publish(); }
    })();
    const finished = task.finally(() => { if (this.flight === finished) { this.flight = undefined; this.schedule(raced ? 100 : this.intervalMs); } });
    this.flight = finished; return finished;
  }
  clear() { ++this.epoch; this.flight = undefined; clearTimeout(this.timer); this.enabled = false; this.items = []; this.owners.clear(); this.current = undefined; this.phase = 'empty'; this.childPrunes.forEach(clearTimeout); this.childPrunes.clear(); this.children.clear(); this.discovering.clear(); this.publish(); }
  dispose() { this.disposed = true; this.clear(); this.cleanups.forEach(fn => fn()); this.listeners.clear(); }
}
