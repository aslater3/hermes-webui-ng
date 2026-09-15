import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextPercent, infoUsage, reconcileUsage, sessionUsage } from '../../src/hermes/session-usage.js';

test('usage projection allowlists numeric native fields and discards private/account metadata', () => {
  assert.deepEqual(sessionUsage({ input: 20, output: 8, total: 28, reasoning: 0, calls: 1,
    context_used: 6400, context_max: 128000, context_percent: 5, context_estimated: true, compressions: 0,
    model: 'private-model', credits_lines: ['private-account'], api_key: 'private-key', nested: { token: 'private' } }),
  { input: 20, output: 8, total: 28, reasoning: 0, calls: 1, contextUsed: 6400, contextMax: 128000,
    contextPercent: 5, contextEstimated: true, compressions: 0 });
});

test('missing, zero and invalid counters remain distinct; totals and window sizes are never guessed', () => {
  for (const raw of [null, undefined, [], '20', 20, {}, { context_max: 0 }, { context_estimated: true },
    { input: -1, output: 1.5, total: Infinity, calls: true, context_percent: NaN }])
    assert.equal(sessionUsage(raw), undefined);
  assert.deepEqual(sessionUsage({ input: 0, output: 0, total: 0, calls: 0 }), { input: 0, output: 0, total: 0, calls: 0 });
  assert.deepEqual(sessionUsage({ input: 20, output: 8 }), { input: 20, output: 8 });
  assert.deepEqual(sessionUsage({ total: Number.MAX_SAFE_INTEGER, input: Number.MAX_SAFE_INTEGER + 1, output: '8' }),
    { total: Number.MAX_SAFE_INTEGER });
});

test('legacy prompt/completion aliases never override canonical zero or malformed canonical counts', () => {
  assert.deepEqual(sessionUsage({ prompt: 20, completion: 8 }), { input: 20, output: 8 });
  assert.deepEqual(sessionUsage({ input: 0, prompt: 20, output: -1, completion: 8 }), { input: 0 });
});

test('context percentage uses reported occupancy, not cumulative input, and preserves over-capacity values', () => {
  assert.equal(contextPercent(sessionUsage({ input: 900000, context_used: 100, context_max: 1000 })), 10);
  assert.equal(contextPercent(sessionUsage({ context_used: 100, context_max: 1000, context_percent: 12.5 })), 12.5);
  assert.ok(Math.abs(contextPercent(sessionUsage({ context_used: 1100, context_max: 1000 }))! - 110) < 1e-9);
  assert.equal(contextPercent(sessionUsage({ context_used: 100, context_max: 0 })), undefined);
  assert.equal(contextPercent(sessionUsage({ context_percent: 0 })), 0);
  assert.equal(contextPercent(undefined), undefined);
});

test('usage snapshot wrapper is explicit and malformed/unknown shapes degrade without throwing', () => {
  assert.deepEqual(infoUsage({ usage: { input: 20 } }), { input: 20 });
  for (const raw of [undefined, null, [], { input: 20 }, { usage: [] }, { usage: { input: '20' } }])
    assert.equal(infoUsage(raw), undefined);
});

test('same-runtime reconciliation rejects cleanup zero regressions but allows real context compression', () => {
  const completed = sessionUsage({ input: 300, output: 50, reasoning: 10, total: 350, calls: 2,
    context_used: 6400, context_max: 128000, context_percent: 5, compressions: 0 })!;
  const cleanup = sessionUsage({ input: 0, output: 0, reasoning: 0, total: 0, calls: 0,
    context_used: 0, context_max: 128000, context_percent: 0, compressions: 0 })!;
  assert.deepEqual(reconcileUsage(completed, cleanup), completed,
    'post-turn idle cleanup must not erase completed counters');

  const compressed = sessionUsage({ input: 320, output: 55, reasoning: 10, total: 375, calls: 3,
    context_used: 1800, context_max: 128000, context_percent: 1.4, compressions: 1 })!;
  assert.deepEqual(reconcileUsage(completed, compressed), compressed,
    'a new compression may legitimately reduce context occupancy');
  assert.equal(reconcileUsage(completed, undefined), undefined,
    'an explicitly missing usage projection still clears stale counters');
});
