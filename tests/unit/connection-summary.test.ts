import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionSummary } from '../../src/hermes/connection-summary.js';
import { ClientError } from '../../src/hermes/protocol.js';
import type { FoundationState } from '../../src/hermes/connection-store.js';
const base: FoundationState = { rest: 'healthy', auth: 'signed-in', busy: false, offline: false };
test('status copy distinguishes REST, WS, expiry, offline and unconfirmed sign-out without raw errors', () => {
  const gateway = { phase: 'connecting' as const, generation: 1, attempt: 0 };
  assert.match(connectionSummary(base, gateway), /Waiting for the native Gateway/);
  assert.match(connectionSummary({ ...base, offline: true }, gateway), /Offline/);
  assert.match(connectionSummary({ ...base, auth: 'auth-required' }, gateway), /Authentication required/);
  assert.match(connectionSummary({ ...base, auth: 'unconfirmed' }, gateway), /could not be confirmed/);
  assert.match(connectionSummary({ ...base, rest: 'unreachable' }, gateway), /REST is unreachable/);
  const denied = connectionSummary(base, { ...gateway, phase: 'error', error: new ClientError('forbidden', 'private-key') });
  assert.match(denied, /access denied/); assert.equal(denied.includes('private-key'), false);
});
