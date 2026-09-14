import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticsRing } from '../../src/hermes/diagnostics.js';
test('interaction diagnostics report only fixed methods, not credentials, commands, questions or answers', () => {
  const ring = new DiagnosticsRing();
  for (const method of ['session.active_list', 'approval.pending', 'approval.respond', 'clarify.respond', 'sudo.respond', 'secret.respond']) {
    ring.add({ event: 'rpc.sent', method, params: { password: 'PRIVATE', command: 'PRIVATE', answer: 'PRIVATE' }, value: 'PRIVATE' });
  }
  assert.ok(ring.snapshot().every(entry => entry.method)); assert.equal(ring.snapshot().length, 6);
  assert.ok(!JSON.stringify(ring.snapshot()).includes('PRIVATE'));
});
