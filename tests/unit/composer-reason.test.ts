import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composerBlockedReason, type ComposerGate } from '../../src/hermes/composer-reason.js';

const base: ComposerGate = { writable: false, openRequests: 0, ready: true, commands: {}, settings: { busy: false, outcome: 'idle' }, loading: false, historical: false, phase: 'idle' };
test('a writable composer has no reason', () => assert.equal(composerBlockedReason({ ...base, writable: true }), ''));
test('each closed state names its cause, in the order writable checks them', () => {
  const cases: [Partial<ComposerGate>, RegExp][] = [
    [{ openRequests: 1 }, /open request/], [{ ready: false }, /connection/],
    [{ commands: { uncertain: true } }, /may have had effects/], [{ commands: { confirmation: {} } }, /confirmation/],
    [{ commands: { busy: true } }, /still running/], [{ commands: { browserPanel: true } }, /command panel/],
    [{ settings: { busy: true, outcome: 'idle' } }, /Applying/], [{ settings: { busy: false, outcome: 'unknown' } }, /not confirmed/],
    [{ settings: { busy: false, outcome: 'idle', confirmation: {} } }, /waiting for your confirmation/],
    [{ loading: true }, /Opening/], [{ historical: true }, /earlier messages/], [{ phase: 'waiting' }, /waiting for input/],
    [{ phase: 'attaching' }, /Reattaching/], [{ phase: 'unknown' }, /not ready \(unknown\)/],
  ];
  for (const [patch, pattern] of cases) assert.match(composerBlockedReason({ ...base, ...patch }), pattern, JSON.stringify(patch));
  // Precedence: an open request outranks everything else.
  assert.match(composerBlockedReason({ ...base, openRequests: 1, ready: false, commands: { busy: true } }), /open request/);
});
