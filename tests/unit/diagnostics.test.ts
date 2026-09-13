import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticsRing } from '../../src/hermes/diagnostics.js';

test('diagnostic ring is bounded, copied on read and cleared without persistence', () => {
  const ring = new DiagnosticsRing(3, () => 100);
  for (let generation = 0; generation < 10; generation++)
    ring.add({ event: 'connection.state', phase: 'ready', generation });
  const snapshot = ring.snapshot();
  assert.deepEqual(snapshot.map((entry) => entry.generation), [7, 8, 9]);
  snapshot[0]!.generation = 200;
  assert.equal(ring.snapshot()[0]!.generation, 7);
  ring.clear();
  assert.deepEqual(ring.snapshot(), []);
  assert.throws(() => new DiagnosticsRing(501));
  assert.throws(() => new DiagnosticsRing(0));
});

test('diagnostics discard secret-bearing keys AND arbitrary values in allowed string fields', () => {
  const ring = new DiagnosticsRing();
  ring.add({
    event: 'gateway.ready', phase: 'secret-phase', kind: 'private-key', method: 'prompt.submit password',
    route: '/api/ws?ticket=private-ticket', status: 'secret-status', generation: 2,
    cookie: 'private-cookie', authorization: 'Bearer private-token',
    payload: { secret: 'private-password', skin: { html: '<script>secret</script>' } },
    params: { text: 'private-prompt' }, session_id: 'private-session', error: new Error('private-error'),
  });
  ring.add({ event: 'unknown-private-event', durationMs: Infinity, rpcCode: NaN });
  ring.add(null);
  assert.equal(JSON.stringify(ring.snapshot()).includes('private'), false);
  assert.equal(JSON.stringify(ring.snapshot()).includes('secret'), false);
  assert.deepEqual(Object.keys(ring.snapshot()[0]!).sort(), ['at', 'event', 'generation']);
  assert.equal(ring.snapshot()[1]?.event, 'other');
});

test('known metadata remains useful without message bodies or upstream error strings', () => {
  const ring = new DiagnosticsRing(5, () => 1234);
  ring.add({ event: 'rpc.failed', method: 'session.resume', kind: 'rpc', rpcCode: 4001, durationMs: 12.3 });
  assert.deepEqual(ring.snapshot(), [{
    at: 1234, event: 'rpc.failed', kind: 'rpc', method: 'session.resume', rpcCode: 4001, durationMs: 12,
  }]);
});
