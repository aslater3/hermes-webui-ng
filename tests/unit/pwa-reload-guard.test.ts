import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatController } from '../../src/hermes/chat-controller.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';
import type { GatewayEvent } from '../../src/hermes/protocol.js';
class Wire {
  state: ConnectionState = { phase: 'ready', generation: 1, attempt: 0 };
  events = new Set<(e: GatewayEvent) => void>(); waiting = new Set<string>(); count = 0;
  onEvent(fn: (e: GatewayEvent) => void) { this.events.add(fn); return () => { this.events.delete(fn); }; }
  onState(fn: (s: ConnectionState) => void) { fn(this.state); return () => {}; }
  call = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    if (method === 'session.create') return { session_id: `live-${++this.count}`, stored_session_id: `saved-${this.count}` };
    if (method === 'session.history') return { messages: [] };
    if (method === 'session.activate') return { running: this.waiting.has(String(params.session_id)), status: this.waiting.has(String(params.session_id)) ? 'waiting' : 'idle' };
    if (method === 'session.resume') return { session_id: String(params.session_id).replace('saved', 'live'), session_key: params.session_id };
    throw new Error('Unexpected fixture method');
  };
}
test('reload protection includes drafts and requests in unselected conversations without exposing their values', async t => {
  const wire = new Wire();
  const chat = new ChatController({ sessions: async () => ({ rows: [], total: 0, offset: 0, limit: 20 }), searchSessions: async () => [],
    sessionMessages: async ref => ({ ...ref, messages: [], offset: 0, limit: 100, returned: 0 }) }, wire);
  t.after(() => chat.dispose()); chat.setEnabled(true);
  await chat.create(); assert.equal(chat.reloadBlocker(), ''); const ref = { ...chat.selected! };
  chat.setDraft('UNSENT_PRIVATE_DRAFT'); assert.match(chat.reloadBlocker(), /drafts/);
  await chat.create(); assert.match(chat.reloadBlocker(), /drafts/);
  await chat.open(ref); chat.setDraft(''); assert.equal(chat.reloadBlocker(), '');
  const live = chat.native.state.runtimeId!; await chat.create(); wire.waiting.add(live);
  wire.events.forEach(fn => fn({ type: 'sudo.request', session_id: live, payload: { request_id: 'PRIVATE_REQUEST' } }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.notEqual(chat.reloadBlocker(), ''); assert.ok(!chat.reloadBlocker().includes('PRIVATE'));
  chat.clear(); assert.equal(chat.reloadBlocker(), '');
});
