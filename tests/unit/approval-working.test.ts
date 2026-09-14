import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeSession } from '../../src/hermes/native-session.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';

test('native approval snapshot overrides working status while remaining a running turn', async t => {
  const state: ConnectionState = { phase: 'ready', generation: 1, attempt: 0 };
  let pending = true;
  const session = new NativeSession({ state, onState: fn => { fn(state); return () => {}; }, onEvent: () => () => {},
    call: async method => {
      if (method === 'session.create') return { session_id: 'live', stored_session_id: 'saved' };
      if (method === 'session.history') return { messages: [] };
      if (method === 'session.activate') return { running: true, status: 'working',
        ...(pending ? { pending_approval: { request_id: 'approval-id', command: 'safe-fixture' } } : {}) };
      if (method === 'approval.respond') { pending = false; return { resolved: 1 }; }
      throw new Error('Unexpected method');
    },
  });
  t.after(() => session.dispose()); await session.create();
  assert.equal(session.state.phase, 'waiting');
  await session.respond('approval:approval-id', 'once');
  assert.equal(session.state.phase, 'running', 'response acknowledgement is not a completion event');
});
