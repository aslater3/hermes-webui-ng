import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeSession } from '../../src/hermes/native-session.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';

test('native snapshots distinguish starting/lazy agents from constructed idle agents', async () => {
  let phase: 'starting' | 'lazy' | 'built' = 'starting';
  const rpc = {
    state: { phase: 'ready', generation: 1, attempt: 0 } as ConnectionState,
    onEvent: () => () => {}, onState: () => () => {},
    call: async (method: string) => {
      if (method === 'session.create') return { session_id: 'runtime', stored_session_id: 'stored', info: { model: 'test-model', lazy: true } };
      if (method === 'session.history') return { messages: [] };
      if (method === 'session.activate') return { running: false, status: phase === 'starting' ? 'starting' : 'idle',
        info: { model: 'test-model', ...(phase === 'lazy' ? { lazy: true } : {}), ...(phase === 'built' ? { provider: 'custom' } : {}) } };
      throw new Error('Unexpected test RPC');
    },
  };
  const session = new NativeSession(rpc);
  try {
    await session.create(); assert.equal(session.state.agentStarting, true);
    phase = 'lazy'; await session.refresh(); assert.equal(session.state.agentStarting, true);
    phase = 'built'; await session.refresh(); assert.equal(session.state.agentStarting, false);
    assert.equal(session.state.phase, 'idle');
  } finally { session.dispose(); }
});
