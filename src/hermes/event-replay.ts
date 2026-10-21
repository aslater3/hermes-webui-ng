import type { GatewayEvent } from './protocol.js';

/**
 * Per-session event sequencing for Hermes' bounded replay ring (`session.events.since`).
 *
 * Hermes stamps every session event with a monotonic `seq` and keeps the recent ones; `gateway.ready`
 * carries a `replay_epoch` that changes when the backend restarts (and its numbering with it). A socket
 * drop (an iPhone backgrounding the app, a network blip) loses whatever streamed meanwhile. This class:
 *  - delivers each (session, seq) at most once (a per-session floor), so live and replayed copies never both render;
 *  - holds a session's live events after a reconnect until its replay has been fetched, so missed
 *    events are delivered before newer ones, in seq order;
 *  - reports a gap when the ring no longer covers the missed range or the epoch changed.
 * No event content is retained beyond the hold, and nothing is persisted.
 */
export type ReplayOutcome = 'complete' | 'gap' | 'none';
export interface ReplayPage { events: unknown[]; truncated: boolean; epoch?: string }
interface Hold { floor: number; events: GatewayEvent[]; timer: ReturnType<typeof setTimeout>; stale: boolean }

const HOLD_LIMIT = 4096;

export class EventSequencer {
  private floors = new Map<string, number>();
  private holds = new Map<string, Hold>();
  private epoch: string | undefined;

  constructor(private readonly deliver: (event: GatewayEvent) => void, private readonly holdMs = 15_000) {}

  /** Record the backend's replay epoch. A changed epoch means seq numbering restarted. */
  setEpoch(value: unknown): void {
    const next = typeof value === 'string' && value ? value : undefined;
    if (next === this.epoch) return;
    if (this.epoch !== undefined) {
      this.floors.clear();
      for (const hold of this.holds.values()) hold.stale = true;
    }
    this.epoch = next;
  }

  /** Forget everything (sign-out, explicit close). Held events are dropped, not delivered. */
  reset(): void {
    for (const hold of this.holds.values()) clearTimeout(hold.timer);
    this.holds.clear(); this.floors.clear(); this.epoch = undefined;
  }

  accept(event: GatewayEvent): void {
    const sid = event.session_id, seq = event.seq;
    if (!sid || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) { this.deliver(event); return; }
    if (this.seen(sid, seq)) return;
    const hold = this.holds.get(sid);
    if (hold) {
      if (hold.events.length < HOLD_LIMIT) hold.events.push(event);
      else { this.release(sid); this.accept(event); }
      return;
    }
    this.mark(sid, seq);
    this.deliver(event);
  }

  /** Start holding a session's live events (called when its connection drops). */
  hold(sid: string): void {
    if (this.holds.has(sid) || !this.floors.has(sid)) return;
    const timer = setTimeout(() => this.release(sid), this.holdMs);
    this.holds.set(sid, { floor: this.floors.get(sid)!, events: [], timer, stale: false });
  }

  /** Stop holding without replay: held events are delivered in seq order. */
  release(sid: string): void {
    const hold = this.holds.get(sid);
    if (!hold) return;
    clearTimeout(hold.timer); this.holds.delete(sid);
    for (const event of sorted(hold.events)) this.accept(event);
  }

  /** Fetch everything after the held floor, merge with what arrived live meanwhile, deliver once in order. */
  async replay(sid: string, fetch: (sid: string, lastSeen: number) => Promise<ReplayPage>): Promise<ReplayOutcome> {
    const hold = this.holds.get(sid);
    if (!hold) return 'none';
    if (hold.stale) { this.release(sid); return 'gap'; }
    let page: ReplayPage;
    try { page = await fetch(sid, hold.floor); }
    catch { this.release(sid); return 'gap'; }
    if (this.holds.get(sid) !== hold) return 'gap';
    if (hold.stale || (page.epoch && this.epoch && page.epoch !== this.epoch)) { this.release(sid); return 'gap'; }
    clearTimeout(hold.timer); this.holds.delete(sid);
    const replayed = page.events.flatMap(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const event = raw as Record<string, unknown>;
      return typeof event.type === 'string' && event.session_id === sid && typeof event.seq === 'number'
        ? [event as unknown as GatewayEvent] : [];
    });
    for (const event of sorted([...replayed, ...hold.events])) this.accept(event);
    return page.truncated ? 'gap' : 'complete';
  }

  // One socket delivers a session's events in seq order and replay merges are sorted, so a floor suffices.
  private seen(sid: string, seq: number): boolean { return seq <= (this.floors.get(sid) ?? 0); }
  private mark(sid: string, seq: number): void { this.floors.set(sid, Math.max(this.floors.get(sid) ?? 0, seq)); }
}

const sorted = (events: GatewayEvent[]) => [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
