import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventSequencer } from '../../src/hermes/event-replay.js';
import type { GatewayEvent } from '../../src/hermes/protocol.js';

const ev = (seq: number, text = `t${seq}`, sid = 'live'): GatewayEvent => ({ type: 'reasoning.delta', session_id: sid, seq, payload: { text } });
function harness(holdMs = 15_000) {
  const out: GatewayEvent[] = [];
  const s = new EventSequencer(event => out.push(event), holdMs);
  s.setEpoch('e1');
  return { s, out, seqs: () => out.map(e => e.seq) };
}

test('events without a session or seq pass straight through; a repeated seq is delivered once', () => {
  const { s, out, seqs } = harness();
  s.accept({ type: 'gateway.ping' });
  s.accept(ev(1)); s.accept(ev(2)); s.accept(ev(2)); s.accept(ev(1));
  assert.equal(out[0]?.type, 'gateway.ping');
  assert.deepEqual(seqs().slice(1), [1, 2]);
});

test('a held session replays the missed range first, then what arrived live, once and in order', async () => {
  const { s, seqs } = harness();
  s.accept(ev(1)); s.accept(ev(2));
  s.hold('live');
  s.accept(ev(6)); s.accept(ev(7)); // live after reconnect, before the replay
  let asked = -1;
  const outcome = await s.replay('live', async (_sid, last) => { asked = last; return { events: [ev(3), ev(4), ev(5), ev(6)], truncated: false, epoch: 'e1' }; });
  assert.equal(asked, 2);
  assert.equal(outcome, 'complete');
  assert.deepEqual(seqs(), [1, 2, 3, 4, 5, 6, 7]);
  s.accept(ev(7)); s.accept(ev(8));
  assert.deepEqual(seqs(), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('a truncated ring is reported as a gap but still delivers what it has', async () => {
  const { s, seqs } = harness();
  s.accept(ev(1)); s.hold('live');
  assert.equal(await s.replay('live', async () => ({ events: [ev(40), ev(41)], truncated: true, epoch: 'e1' })), 'gap');
  assert.deepEqual(seqs(), [1, 40, 41]);
});

test('a backend restart (new epoch) makes the held floor meaningless: gap, held events released, no fetch', async () => {
  const { s, seqs } = harness();
  s.accept(ev(9)); s.hold('live');
  s.setEpoch('e2');
  s.accept(ev(1, 'after restart'));
  let fetched = false;
  assert.equal(await s.replay('live', async () => { fetched = true; return { events: [], truncated: false }; }), 'gap');
  assert.equal(fetched, false);
  assert.deepEqual(seqs(), [9, 1]);
});

test('a failed fetch releases the hold and reports a gap', async () => {
  const { s, seqs } = harness();
  s.accept(ev(1)); s.hold('live'); s.accept(ev(3));
  assert.equal(await s.replay('live', async () => { throw new Error('socket'); }), 'gap');
  assert.deepEqual(seqs(), [1, 3]);
});

test('an unclaimed hold is released after its timeout so live events are never stranded', async () => {
  const { s, seqs } = harness(10);
  s.accept(ev(1)); s.hold('live'); s.accept(ev(2));
  assert.deepEqual(seqs(), [1]);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(seqs(), [1, 2]);
});

test('a session never seen before has nothing to replay; other sessions are not held', async () => {
  const { s, seqs } = harness();
  s.hold('unknown');
  assert.equal(await s.replay('unknown', async () => ({ events: [ev(1, 'x', 'unknown')], truncated: false })), 'none');
  s.accept(ev(1)); s.hold('live');
  s.accept(ev(5, 'other', 'other-session'));
  assert.deepEqual(seqs(), [1, 5]);
  s.reset();
});
